import logging
import re
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.logging_config import log_event
from app.models import IntakeRecord, User
from app.security import current_user, decrypt_json, decrypt_str, encrypt_json, encrypt_str
from app.services import health_state, ocr
from app.services.chat import assessment_summary
from app.services.privacy import active_consent
from app.services.uploads import UploadRejected, validate_and_clean

logger = logging.getLogger("app.intake")
router = APIRouter(prefix="/api", tags=["intake"])

FIELD_SOURCES = {"ocr_confirmed", "ocr_edited", "manual"}


def require_consent(user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
    if active_consent(db, user.id) is None:
        raise HTTPException(status_code=403, detail="Please review and accept the consent notice first.")
    return user


def _record(db: Session, user_id: str) -> IntakeRecord:
    record = db.scalar(select(IntakeRecord).where(IntakeRecord.user_id == user_id))
    if record is None:
        record = IntakeRecord(user_id=user_id, field_sources={})
        db.add(record)
    return record


class ExtractedField(BaseModel):
    value: str | None
    confidence: float | None
    status: str


class ExtractOut(BaseModel):
    fields: dict[str, ExtractedField]
    needs_review: list[str]
    missing: list[str]
    message: str
    image_retained: bool = False


@router.post("/documents/extract", response_model=ExtractOut)
async def extract_document(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_consent),
) -> ExtractOut:
    """Read name, DOB and address from an ID photo. The image is processed in memory and discarded."""
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    try:
        clean = validate_and_clean(data, max_bytes)
    except UploadRejected as exc:
        log_event(logger, "upload_rejected", component="ocr", outcome="rejected", user_id=user.id)
        raise HTTPException(status_code=422, detail=str(exc)) from None
    finally:
        del data

    try:
        result = ocr.extract_fields(clean.image)
        health_state.record_success("ocr")
    except ocr.OcrUnavailable:
        health_state.record_failure("ocr")
        log_event(logger, "ocr_unavailable", logging.ERROR, component="ocr", outcome="error", user_id=user.id)
        raise HTTPException(status_code=503, detail="We couldn't read photos right now. Please type your details instead.") from None
    finally:
        clean.image.close()

    found = [k for k, f in result.fields.items() if f.value]
    missing = [k for k, f in result.fields.items() if not f.value]
    review = [k for k, f in result.fields.items() if f.status == "low_confidence"]
    log_event(
        logger,
        "ocr_extracted",
        component="ocr",
        duration_ms=result.duration_ms,
        fields_found=found,
        fields_missing=missing,
        user_id=user.id,
    )
    if not found:
        message = "We couldn't read any details from that photo. You can try another photo or type them in."
    elif missing or review:
        message = "We filled in what we could read. Please check the highlighted fields and complete any blanks."
    else:
        message = "Please check that these details are correct before saving."
    return ExtractOut(
        fields={k: ExtractedField(**vars(f)) for k, f in result.fields.items()},
        needs_review=review,
        missing=missing,
        message=message,
    )


class IdentityIn(BaseModel):
    full_name: str = Field(min_length=3, max_length=120)
    dob: date
    address: str = Field(min_length=8, max_length=240)
    sources: dict[str, str] = Field(default_factory=dict)

    @field_validator("full_name", "address")
    @classmethod
    def _plain_text(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v).strip()
        if re.search(r"[<>{}]", v):
            raise ValueError("Please use letters, numbers and basic punctuation only.")
        return v

    @field_validator("dob")
    @classmethod
    def _adult(cls, v: date) -> date:
        today = date.today()
        age = today.year - v.year - ((today.month, today.day) < (v.month, v.day))
        if age < 18:
            raise ValueError("This service is for adults (18+) only.")
        if age > 120:
            raise ValueError("Please check the date of birth.")
        return v

    @field_validator("sources")
    @classmethod
    def _sources(cls, v: dict[str, str]) -> dict[str, str]:
        return {k: s for k, s in v.items() if k in ocr.FIELDS and s in FIELD_SOURCES}


class AssessmentIn(BaseModel):
    reason_for_visit: str | None = Field(default=None, max_length=300)
    symptom_duration: str | None = Field(default=None, max_length=300)
    visit_type_preference: str | None = Field(default=None, pattern="^(in_person|telehealth|no_preference)$")
    accessibility_needs: str | None = Field(default=None, max_length=300)


class IntakeOut(BaseModel):
    full_name: str | None
    dob: str | None
    address: str | None
    field_sources: dict
    identity_confirmed: bool
    assessment: dict | None
    assessment_summary: str | None
    assessment_confirmed: bool


def _out(record: IntakeRecord) -> IntakeOut:
    assessment = decrypt_json(record.assessment_enc)
    return IntakeOut(
        full_name=decrypt_str(record.full_name_enc),
        dob=decrypt_str(record.dob_enc),
        address=decrypt_str(record.address_enc),
        field_sources=record.field_sources or {},
        identity_confirmed=record.identity_confirmed_at is not None,
        assessment=assessment,
        assessment_summary=assessment_summary(assessment) if assessment else None,
        assessment_confirmed=record.assessment_confirmed_at is not None,
    )


@router.put("/intake/identity", response_model=IntakeOut)
def save_identity(body: IdentityIn, user: User = Depends(require_consent), db: Session = Depends(get_db)) -> IntakeOut:
    record = _record(db, user.id)
    record.full_name_enc = encrypt_str(body.full_name)
    record.dob_enc = encrypt_str(body.dob.isoformat())
    record.address_enc = encrypt_str(body.address)
    record.field_sources = {f: body.sources.get(f, "manual") for f in ocr.FIELDS}
    record.identity_confirmed_at = datetime.now(UTC)
    db.commit()
    return _out(record)


@router.put("/intake/assessment", response_model=IntakeOut)
def save_assessment(body: AssessmentIn, user: User = Depends(require_consent), db: Session = Depends(get_db)) -> IntakeOut:
    record = _record(db, user.id)
    record.assessment_enc = encrypt_json(body.model_dump())
    record.assessment_confirmed_at = datetime.now(UTC)
    db.commit()
    return _out(record)


@router.get("/intake", response_model=IntakeOut)
def get_intake(user: User = Depends(current_user), db: Session = Depends(get_db)) -> IntakeOut:
    record = db.scalar(select(IntakeRecord).where(IntakeRecord.user_id == user.id))
    if record is None:
        raise HTTPException(status_code=404, detail="No intake record.")
    return _out(record)
