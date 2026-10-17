import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, LargeBinary, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # HMAC of the normalized email, for lookup without storing it in the clear.
    email_lookup: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email_enc: Mapped[bytes] = mapped_column(LargeBinary)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user")
    adult_attested: Mapped[bool] = mapped_column(Boolean, default=False)
    # Bumped on sign-out; session tokens carry it, so older tokens stop working.
    session_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Made-up patients the demo seeds so the staff view has something to show; they can't sign in
    # and are left out of analytics.
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RevokedSession(Base):
    """Session ids signed out before they expire. Rows older than the session lifetime are purged."""

    __tablename__ = "revoked_sessions"

    sid: Mapped[str] = mapped_column(String(32), primary_key=True)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class Consent(Base):
    __tablename__ = "consents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(16))
    # Separate, optional consent to read an ID photo. Declining it never blocks intake.
    photo_scan: Mapped[bool] = mapped_column(default=False, server_default="false")
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class IntakeRecord(Base):
    __tablename__ = "intake_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    # Identity fields, encrypted at the field level (Fernet) on top of disk encryption.
    full_name_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    dob_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    address_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # Per-field provenance ("ocr_confirmed", "ocr_edited", "manual"), no values.
    field_sources: Mapped[dict] = mapped_column(JSON, default=dict)
    identity_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Assessment answers (health information), encrypted as one JSON blob.
    assessment_enc: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    assessment_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Slot(Base):
    __tablename__ = "slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    visit_type: Mapped[str] = mapped_column(String(16))  # "in_person" | "telehealth"
    clinician_label: Mapped[str] = mapped_column(String(64))


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        # One active booking per slot: the database, not app code, rejects double-booking.
        Index("uq_active_booking_per_slot", "slot_id", unique=True, postgresql_where=text("status = 'booked'")),
        Index("uq_active_booking_per_user", "user_id", unique=True, postgresql_where=text("status = 'booked'")),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slot_id: Mapped[int] = mapped_column(ForeignKey("slots.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="booked")  # booked | cancelled
    confirmation_code: Mapped[str] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    """Who did what to whose record. Ids and action names only, never values."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    subject_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(48))


class FunnelEvent(Base):
    """First-party analytics: step + event + anonymous session id. No user id, no values."""

    __tablename__ = "funnel_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    anon_session_id: Mapped[str] = mapped_column(String(36), index=True)
    step_id: Mapped[str] = mapped_column(String(32))
    event: Mapped[str] = mapped_column(String(32))
