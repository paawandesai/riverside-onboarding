"""Read-only views for clinic staff: the upcoming schedule and one patient's intake.

Staff accounts exist only where someone ran scripts/create_staff.py; the public demo has none.
Every read is audit-logged with the staff member as actor.
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Booking, IntakeRecord, Slot, User
from app.routers.scheduling import SlotOut
from app.security import audit, decrypt_json, decrypt_str, require_staff
from app.services.chat import assessment_summary

router = APIRouter(prefix="/api/staff", tags=["staff"])

FieldSource = Literal["ocr_confirmed", "ocr_edited", "manual"]


class ScheduleItemOut(BaseModel):
    patient_id: str
    full_name: str | None
    confirmation_code: str
    slot: SlotOut
    identity_confirmed: bool
    assessment_confirmed: bool


class AssessmentOut(BaseModel):
    reason_for_visit: str | None = None
    symptom_duration: str | None = None
    visit_type_preference: str | None = None
    accessibility_needs: str | None = None


class StaffIntakeOut(BaseModel):
    patient_id: str
    full_name: str | None
    dob: str | None
    address: str | None
    field_sources: dict[str, FieldSource]
    assessment: AssessmentOut | None
    assessment_summary: str | None
    booking: ScheduleItemOut | None


def _schedule_item(booking: Booking, slot: Slot, record: IntakeRecord | None) -> ScheduleItemOut:
    return ScheduleItemOut(
        patient_id=booking.user_id,
        full_name=decrypt_str(record.full_name_enc) if record else None,
        confirmation_code=booking.confirmation_code,
        slot=SlotOut.model_validate(slot, from_attributes=True),
        identity_confirmed=bool(record and record.identity_confirmed_at),
        assessment_confirmed=bool(record and record.assessment_confirmed_at),
    )


@router.get("/schedule", response_model=list[ScheduleItemOut])
def schedule(staff: User = Depends(require_staff), db: Session = Depends(get_db)) -> list[ScheduleItemOut]:
    """Upcoming booked visits, soonest first."""
    rows = db.execute(
        select(Booking, Slot, IntakeRecord)
        .join(Slot, Slot.id == Booking.slot_id)
        .outerjoin(IntakeRecord, IntakeRecord.user_id == Booking.user_id)
        .where(Booking.status == "booked", Slot.starts_at >= datetime.now(UTC))
        .order_by(Slot.starts_at)
        .limit(200)
    ).all()
    audit(db, "staff_listed_schedule", staff.id, None)
    db.commit()
    return [_schedule_item(b, s, r) for b, s, r in rows]


@router.get("/intakes/{user_id}", response_model=StaffIntakeOut)
def intake(user_id: str, staff: User = Depends(require_staff), db: Session = Depends(get_db)) -> StaffIntakeOut:
    """One patient's confirmed details and visit answers."""
    record = db.scalar(select(IntakeRecord).where(IntakeRecord.user_id == user_id))
    audit(db, "staff_viewed_intake", staff.id, user_id)
    db.commit()
    if record is None:
        raise HTTPException(status_code=404, detail="No intake record.")
    assessment = decrypt_json(record.assessment_enc)
    booked = db.execute(
        select(Booking, Slot).join(Slot, Slot.id == Booking.slot_id).where(Booking.user_id == user_id, Booking.status == "booked")
    ).first()
    return StaffIntakeOut(
        patient_id=user_id,
        full_name=decrypt_str(record.full_name_enc),
        dob=decrypt_str(record.dob_enc),
        address=decrypt_str(record.address_enc),
        field_sources=record.field_sources or {},
        assessment=AssessmentOut(**assessment) if assessment else None,
        assessment_summary=assessment_summary(assessment) if assessment else None,
        booking=_schedule_item(booked[0], booked[1], record) if booked else None,
    )
