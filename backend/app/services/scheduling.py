import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Booking, Slot


class SlotUnavailable(Exception):
    pass


class SlotNotFound(Exception):
    pass


def open_slots(db: Session, visit_type: str | None, limit: int = 40) -> list[Slot]:
    now = datetime.now(UTC)
    taken = select(Booking.slot_id).where(Booking.status == "booked")
    query = select(Slot).where(Slot.starts_at > now, Slot.id.not_in(taken)).order_by(Slot.starts_at).limit(limit)
    if visit_type:
        query = query.where(Slot.visit_type == visit_type)
    return list(db.scalars(query))


def book(db: Session, user_id: str, slot_id: int) -> Booking:
    """Book a slot. A user's existing booking is replaced in the same transaction (reschedule).

    Double-booking is rejected by the partial unique index on (slot_id) WHERE status='booked',
    so two concurrent requests for the same slot cannot both succeed.
    """
    slot = db.get(Slot, slot_id)
    if slot is None or slot.starts_at <= datetime.now(UTC):
        raise SlotNotFound()
    existing = db.scalar(select(Booking).where(Booking.user_id == user_id, Booking.status == "booked"))
    if existing is not None:
        if existing.slot_id == slot_id:
            return existing
        existing.status, existing.cancelled_at = "cancelled", datetime.now(UTC)
        db.flush()
    booking = Booking(slot_id=slot_id, user_id=user_id, confirmation_code=secrets.token_hex(4).upper())
    db.add(booking)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise SlotUnavailable() from exc
    return booking


def cancel(db: Session, user_id: str, booking_id: str) -> bool:
    booking = db.get(Booking, booking_id)
    if booking is None or booking.user_id != user_id or booking.status != "booked":
        return False
    booking.status, booking.cancelled_at = "cancelled", datetime.now(UTC)
    db.commit()
    return True


def seed_slots(db: Session, days: int = 14, start: datetime | None = None) -> int:
    """Weekday slots 9:00-16:30 (clinic local time shown as UTC for the demo), alternating visit types."""
    start = (start or datetime.now(UTC)).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    created = 0
    for day in range(days):
        current = start + timedelta(days=day)
        if current.weekday() >= 5:
            continue
        for i in range(16):
            starts = current + timedelta(hours=9, minutes=30 * i)
            visit_type = "telehealth" if i % 3 == 2 else "in_person"
            clinician = "Clinician A (fictional)" if i % 2 == 0 else "Clinician B (fictional)"
            db.add(Slot(starts_at=starts, visit_type=visit_type, clinician_label=clinician))
            created += 1
    db.commit()
    return created
