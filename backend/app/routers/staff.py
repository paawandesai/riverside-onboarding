"""Read-only views for clinic staff: the upcoming schedule, one patient's intake, and analytics.

Staff accounts come from scripts/create_staff.py, or on the public demo from the seed step's
--demo-staff login. Every read is audit-logged with the staff member as actor.
"""

from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Booking, FunnelEvent, IntakeRecord, Slot, User
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
    sample: bool = False


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
    sample: bool = False
    assessment: AssessmentOut | None
    assessment_summary: str | None
    booking: ScheduleItemOut | None


def _schedule_item(booking: Booking, slot: Slot, record: IntakeRecord | None, sample: bool = False) -> ScheduleItemOut:
    return ScheduleItemOut(
        sample=sample,
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
        select(Booking, Slot, IntakeRecord, User.synthetic)
        .join(Slot, Slot.id == Booking.slot_id)
        .join(User, User.id == Booking.user_id)
        .outerjoin(IntakeRecord, IntakeRecord.user_id == Booking.user_id)
        .where(Booking.status == "booked", Slot.starts_at >= datetime.now(UTC))
        .order_by(Slot.starts_at)
        .limit(200)
    ).all()
    # One row per patient shown, so "who has seen patient X's details" can always be answered.
    for booking, *_ in rows:
        audit(db, "staff_listed_schedule", staff.id, booking.user_id)
    db.commit()
    return [_schedule_item(b, s, r, sample) for b, s, r, sample in rows]


@router.get("/intakes/{user_id}", response_model=StaffIntakeOut)
def intake(user_id: str, staff: User = Depends(require_staff), db: Session = Depends(get_db)) -> StaffIntakeOut:
    """One patient's confirmed details and visit answers."""
    record = db.scalar(select(IntakeRecord).where(IntakeRecord.user_id == user_id))
    audit(db, "staff_viewed_intake", staff.id, user_id)
    db.commit()
    if record is None:
        raise HTTPException(status_code=404, detail="No intake record.")
    assessment = decrypt_json(record.assessment_enc)
    sample = bool(db.scalar(select(User.synthetic).where(User.id == user_id)))
    booked = db.execute(
        select(Booking, Slot).join(Slot, Slot.id == Booking.slot_id).where(Booking.user_id == user_id, Booking.status == "booked")
    ).first()
    return StaffIntakeOut(
        patient_id=user_id,
        full_name=decrypt_str(record.full_name_enc),
        dob=decrypt_str(record.dob_enc),
        address=decrypt_str(record.address_enc),
        field_sources=record.field_sources or {},
        sample=sample,
        assessment=AssessmentOut(**assessment) if assessment else None,
        assessment_summary=assessment_summary(assessment) if assessment else None,
        booking=_schedule_item(booked[0], booked[1], record, sample) if booked else None,
    )


# The patient flow in order. Steps outside it (privacy, staff pages) are not part of the funnel.
FUNNEL_STEPS = ["start", "account", "consent", "chat", "details", "confirm", "book", "done"]
# Time on a step is the gap to the session's next page view; longer gaps are a closed tab, not work.
MAX_STEP_SECONDS = 30 * 60
OCR_FIELDS = ["full_name", "dob", "address"]


class FunnelStepOut(BaseModel):
    step: str
    sessions: int
    share_of_start: float | None  # sessions here / sessions that viewed the first step
    drop_off: float | None  # share of the previous step's sessions that never reached this one
    median_seconds: float | None  # time from viewing this step to the next page view
    timed_sessions: int


class OcrFieldOut(BaseModel):
    field: str
    confirmed: int  # read from the photo and kept as read
    corrected: int  # read from the photo, then edited by the patient
    typed: int  # entered by hand (no photo, or the photo had nothing usable)
    correction_rate: float | None  # corrected / (confirmed + corrected)


class AnalyticsOut(BaseModel):
    since: datetime
    sessions: int
    funnel: list[FunnelStepOut]
    support_shown: dict[str, int]
    ocr: list[OcrFieldOut]
    ocr_records: int


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


@router.get("/analytics", response_model=AnalyticsOut)
def analytics(
    days: int = Query(default=7, ge=1, le=30), staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> AnalyticsOut:
    """Funnel drop-off, time per step and OCR correction rates. Counts only, no patient data.

    Funnel events carry an anonymous session id, a step and an event name. OCR rates come from
    the per-field provenance on intake records (no values), leaving out the made-up sample patients.
    """
    since = datetime.now(UTC) - timedelta(days=days)
    audit(db, "staff_viewed_analytics", staff.id, None)
    db.commit()

    events = db.execute(
        select(FunnelEvent.anon_session_id, FunnelEvent.step_id, FunnelEvent.event, FunnelEvent.at)
        .where(FunnelEvent.at >= since)
        .order_by(FunnelEvent.anon_session_id, FunnelEvent.at)
        .limit(200_000)
    ).all()
    reached: dict[str, set[str]] = {step: set() for step in FUNNEL_STEPS}
    durations: dict[str, list[float]] = {step: [] for step in FUNNEL_STEPS}
    support: dict[str, int] = {}
    views_by_session: dict[str, list[tuple[str, datetime]]] = {}
    for session_id, step, event, at in events:
        if event == "viewed":
            views_by_session.setdefault(session_id, []).append((step, at))
            if step in reached:
                reached[step].add(session_id)
        elif event.startswith("support_"):
            support[event.removeprefix("support_")] = support.get(event.removeprefix("support_"), 0) + 1
    for views in views_by_session.values():
        for (step, at), (_, next_at) in zip(views, views[1:], strict=False):
            gap = (next_at - at).total_seconds()
            if step in durations and 0 <= gap <= MAX_STEP_SECONDS:
                durations[step].append(gap)

    started = len(reached[FUNNEL_STEPS[0]])
    funnel = []
    for i, step in enumerate(FUNNEL_STEPS):
        count = len(reached[step])
        previous = len(reached[FUNNEL_STEPS[i - 1]]) if i else None
        funnel.append(
            FunnelStepOut(
                step=step,
                sessions=count,
                share_of_start=_rate(count, started),
                drop_off=None if previous is None else _rate(max(previous - count, 0), previous),
                median_seconds=round(median(durations[step]), 1) if durations[step] else None,
                timed_sessions=len(durations[step]),
            )
        )

    sources = db.scalars(
        select(IntakeRecord.field_sources)
        .join(User, User.id == IntakeRecord.user_id)
        .where(User.synthetic.is_(False), IntakeRecord.identity_confirmed_at.is_not(None), IntakeRecord.updated_at >= since)
    ).all()
    ocr = []
    for field in OCR_FIELDS:
        values = [(s or {}).get(field) for s in sources]
        confirmed, corrected = values.count("ocr_confirmed"), values.count("ocr_edited")
        ocr.append(
            OcrFieldOut(
                field=field,
                confirmed=confirmed,
                corrected=corrected,
                typed=values.count("manual"),
                correction_rate=_rate(corrected, confirmed + corrected),
            )
        )
    return AnalyticsOut(
        since=since,
        sessions=len(views_by_session),
        funnel=funnel,
        support_shown=dict(sorted(support.items())),
        ocr=ocr,
        ocr_records=len(sources),
    )
