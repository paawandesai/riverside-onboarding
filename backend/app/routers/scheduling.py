import logging
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.logging_config import log_event
from app.models import Booking, Slot, User
from app.routers.intake import require_consent
from app.security import current_user
from app.services import scheduling

logger = logging.getLogger("app.scheduling")
router = APIRouter(prefix="/api", tags=["scheduling"])


class SlotOut(BaseModel):
    id: int
    starts_at: datetime
    duration_minutes: int
    visit_type: str
    clinician_label: str


class BookingOut(BaseModel):
    id: str
    status: str
    confirmation_code: str
    slot: SlotOut


class BookIn(BaseModel):
    slot_id: int = Field(ge=1, le=2**31 - 1)


def _slot_out(slot: Slot) -> SlotOut:
    return SlotOut.model_validate(slot, from_attributes=True)


@router.get("/slots", response_model=list[SlotOut])
def list_slots(
    visit_type: str | None = Query(default=None, pattern="^(in_person|telehealth)$"),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
) -> list[SlotOut]:
    return [_slot_out(s) for s in scheduling.open_slots(db, visit_type)]


class ConflictOut(BaseModel):
    detail: str
    alternatives: list[SlotOut]


@router.post("/bookings", response_model=BookingOut, status_code=201, responses={409: {"model": ConflictOut}})
def create_booking(body: BookIn, user: User = Depends(require_consent), db: Session = Depends(get_db)) -> BookingOut | JSONResponse:
    started = time.perf_counter()
    try:
        booking = scheduling.book(db, user.id, body.slot_id)
    except scheduling.SlotNotFound:
        raise HTTPException(status_code=404, detail="That time isn't available.") from None
    except scheduling.BookingInProgress:
        raise HTTPException(status_code=409, detail="Your booking was just changed in another window. Please reload to see it.") from None
    except scheduling.SlotUnavailable:
        log_event(logger, "booking_conflict", component="scheduling", outcome="conflict", user_id=user.id)
        # Offer the closest open times so the patient doesn't have to start over.
        alternatives = [_slot_out(s) for s in scheduling.nearest_open(db, body.slot_id)]
        conflict = ConflictOut(detail="Someone just booked that time. The closest open times are below.", alternatives=alternatives)
        return JSONResponse(status_code=409, content=conflict.model_dump(mode="json"))
    log_event(
        logger,
        "booking_created",
        component="scheduling",
        outcome="booked",
        duration_ms=int((time.perf_counter() - started) * 1000),
        user_id=user.id,
    )
    return BookingOut(
        id=booking.id, status=booking.status, confirmation_code=booking.confirmation_code, slot=_slot_out(db.get(Slot, booking.slot_id))
    )


@router.get("/bookings/mine", response_model=list[BookingOut])
def my_bookings(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[BookingOut]:
    rows = db.execute(
        select(Booking, Slot).join(Slot, Slot.id == Booking.slot_id).where(Booking.user_id == user.id, Booking.status == "booked")
    ).all()
    return [BookingOut(id=b.id, status=b.status, confirmation_code=b.confirmation_code, slot=_slot_out(s)) for b, s in rows]


@router.post("/bookings/{booking_id}/cancel", status_code=204)
def cancel_booking(booking_id: str, user: User = Depends(require_consent), db: Session = Depends(get_db)) -> None:
    if not scheduling.cancel(db, user.id, booking_id):
        raise HTTPException(status_code=404, detail="Booking not found.")
