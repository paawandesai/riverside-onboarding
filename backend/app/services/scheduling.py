import secrets
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Booking, Slot
from app.security import audit


class SlotUnavailable(Exception):
    pass


class SlotNotFound(Exception):
    pass


class BookingInProgress(Exception):
    """The same user changed their booking in another request at the same moment."""


def nearest_open(db: Session, slot_id: int, count: int = 3) -> list[Slot]:
    """The open slots of the same visit type closest in time to a slot that was just taken."""
    slot = db.get(Slot, slot_id)
    if slot is None:
        return []
    candidates = open_slots(db, slot.visit_type, limit=200)
    return sorted(candidates, key=lambda s: abs((s.starts_at - slot.starts_at).total_seconds()))[:count]


def open_slots(db: Session, visit_type: str | None, limit: int = 200) -> list[Slot]:
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
    audit(db, "booking_rescheduled" if existing is not None else "booking_created", user_id, user_id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_active_booking_per_user" in str(exc.orig):
            raise BookingInProgress() from exc
        raise SlotUnavailable() from exc
    return booking


def cancel(db: Session, user_id: str, booking_id: str) -> bool:
    booking = db.get(Booking, booking_id)
    if booking is None or booking.user_id != user_id or booking.status != "booked":
        return False
    booking.status, booking.cancelled_at = "cancelled", datetime.now(UTC)
    audit(db, "booking_cancelled", user_id, user_id)
    db.commit()
    return True


def seed_slots(db: Session, days: int = 14, start: datetime | None = None) -> int:
    """Make sure weekday slots exist for the next `days` days; returns how many were added.

    Slots are 9:00-16:30 in the clinic's own time zone (CLINIC_TIMEZONE), stored in UTC. Running it
    again only fills gaps, so the purge job can call it daily to keep a rolling two weeks open.
    """
    zone = ZoneInfo(get_settings().clinic_timezone)
    first_day = (start or datetime.now(UTC)).astimezone(zone).date() + timedelta(days=1)
    window_start = datetime.combine(first_day, time(0), zone)
    existing = set(
        db.scalars(select(Slot.starts_at).where(Slot.starts_at >= window_start, Slot.starts_at < window_start + timedelta(days=days + 1)))
    )
    existing = {e.astimezone(UTC) for e in existing}
    created = 0
    for day in range(days):
        current = first_day + timedelta(days=day)
        if current.weekday() >= 5:
            continue
        for i in range(16):
            local = datetime.combine(current, time(9), zone) + timedelta(minutes=30 * i)
            starts = local.astimezone(UTC)
            if starts in existing:
                continue
            visit_type = "telehealth" if i % 3 == 2 else "in_person"
            clinician = "Clinician A (fictional)" if i % 2 == 0 else "Clinician B (fictional)"
            db.add(Slot(starts_at=starts, visit_type=visit_type, clinician_label=clinician))
            created += 1
    db.commit()
    return created
