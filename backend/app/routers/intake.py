import asyncio
import logging
import re
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.formparsers import MultiPartParser

from app.config import get_settings
from app.db import get_db
from app.logging_config import log_event
from app.models import Booking, IntakeRecord, User
from app.ratelimit import check
from app.security import current_user, decrypt_json, decrypt_str, encrypt_json, encrypt_str
from app.services import health_state, ocr
from app.services.chat import assessment_summary
from app.services.privacy import active_consent
from app.services.uploads import UploadRejected, validate_and_clean

logger = logging.getLogger("app.intake")
router = APIRouter(prefix="/api", tags=["intake"])

FIELD_SOURCES = {"ocr_confirmed", "ocr_edited", "manual"}
# Decoding and OCR take a few hundred MB at peak; two at a time per worker keeps a replica inside its memory.
_OCR_SLOTS = asyncio.Semaphore(2)
# Keep uploaded parts in memory (up to the largest allowed upload) so a photo never lands in a temp file.
# The body-size middleware refuses anything larger before parsing starts.
MultiPartParser.spool_max_size = 21 * 1024 * 1024
_MANUAL_ENTRY = "We couldn't read photos right now. Please type your details instead."


def require_consent(user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
    if active_consent(db, user.id) is None:
        raise HTTPException(status_code=403, detail="Please review and accept the consent notice first.")
    return user


def require_photo_consent(user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
    consent = active_consent(db, user.id)
    if consent is None or not consent.photo_scan:
        raise HTTPException(status_code=403, detail="Turn on ID scanning on the consent step to use a photo, or type your details instead.")
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
    status: Literal["found", "low_confidence", "missing"]


class ExtractOut(BaseModel):
    fields: dict[str, ExtractedField]
    needs_review: list[str]
    missing: list[str]
    message: str
    image_retained: bool = False


_UPLOAD_DOC = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {"type": "object", "required": ["file"], "properties": {"file": {"type": "string", "format": "binary"}}}
            }
        },
    }
}


async def _read_photo(request: Request, max_bytes: int) -> bytes:
    """Read the uploaded photo into memory, only after the caller is authenticated and has consented.

    The body-size middleware has already refused anything over the limit, and the parser keeps parts
    of that size in memory, so the photo is never written to a temporary file.
    """
    try:
        form = await request.form(max_files=1, max_fields=2, max_part_size=max_bytes + 1)
    except Exception:  # noqa: BLE001 - malformed multipart bodies get the same friendly answer
        raise HTTPException(status_code=422, detail="Please choose a photo of your ID.") from None
    try:
        upload = form.get("file")
        if upload is None or isinstance(upload, str):
            raise HTTPException(status_code=422, detail="Please choose a photo of your ID.")
        return await upload.read(max_bytes + 1)
    finally:
        await form.close()


@router.post("/documents/extract", response_model=ExtractOut, openapi_extra=_UPLOAD_DOC)
async def extract_document(request: Request, user: User = Depends(require_photo_consent)) -> ExtractOut:
    """Read name, DOB and address from an ID photo. The image is processed in memory and discarded."""
    check("upload", user.id, 10, 60)
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await _read_photo(request, max_bytes)
    async with _OCR_SLOTS:
        try:
            # CPU-bound work runs off the event loop so one upload can't stall other requests.
            clean = await run_in_threadpool(validate_and_clean, data, max_bytes)
        except UploadRejected as exc:
            log_event(logger, "upload_rejected", component="ocr", outcome="rejected", user_id=user.id)
            raise HTTPException(status_code=422, detail=str(exc)) from None
        finally:
            del data

        try:
            result = await run_in_threadpool(ocr.extract_fields, clean.image)
            health_state.record_success("ocr")
        except Exception as exc:  # noqa: BLE001 - OCR trouble of any kind (engine missing, out of memory) means "type it"
            health_state.record_failure("ocr")
            log_event(
                logger, "ocr_unavailable", logging.ERROR, component="ocr", outcome="error", user_id=user.id, error_type=type(exc).__name__
            )
            raise HTTPException(status_code=503, detail=_MANUAL_ENTRY) from None
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


class ProgressOut(BaseModel):
    consent: bool
    photo_scan: bool
    assessment_done: bool
    identity_done: bool
    booked: bool


@router.get("/progress", response_model=ProgressOut)
def progress(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ProgressOut:
    """Which steps are done, so a returning patient resumes where they left off. Flags only, no data."""
    consent = active_consent(db, user.id)
    record = db.scalar(select(IntakeRecord).where(IntakeRecord.user_id == user.id))
    booked = db.scalar(select(Booking.id).where(Booking.user_id == user.id, Booking.status == "booked")) is not None
    return ProgressOut(
        consent=consent is not None,
        photo_scan=bool(consent and consent.photo_scan),
        assessment_done=bool(record and record.assessment_confirmed_at),
        identity_done=bool(record and record.identity_confirmed_at),
        booked=booked,
    )


@router.get("/intake", response_model=IntakeOut)
def get_intake(user: User = Depends(current_user), db: Session = Depends(get_db)) -> IntakeOut:
    record = db.scalar(select(IntakeRecord).where(IntakeRecord.user_id == user.id))
    if record is None:
        raise HTTPException(status_code=404, detail="No intake record.")
    return _out(record)
