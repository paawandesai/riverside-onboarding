from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import Booking, Consent, IntakeRecord, User
from app.security import audit

CONSENT_VERSION = "2026-10-v1"

CONSENT_TEXT = {
    "version": CONSENT_VERSION,
    "summary": "Before you upload an ID photo or answer intake questions, please read how we use your information.",
    "points": [
        "We collect your name, date of birth, address, and your answers about why you'd like a visit. We use them only to set up your account and book your appointment.",
        "If you upload a photo of your ID, we read it on our own servers to fill in the form, then discard the photo. We never store it and never send it to an AI provider.",
        "Your chat messages about your visit are sent to Anthropic's Claude API to help guide sign-up. Your name, date of birth, address and ID photo are not sent. Anthropic keeps API data for up to 30 days by default, and up to 2 years if its safety systems flag a message. Deleting your data here does not delete copies Anthropic already holds.",
        "A member of our care team reviews your answers. The assistant's summary is not a diagnosis and doesn't decide your care.",
        "You can withdraw consent or delete your data at any time from the Privacy page. We then stop processing and delete your information from our systems.",
        "This is a demo with synthetic data only. Do not enter real personal or health information.",
    ],
}


def active_consent(db: Session, user_id: str) -> Consent | None:
    return db.scalar(select(Consent).where(Consent.user_id == user_id, Consent.revoked_at.is_(None)).order_by(Consent.granted_at.desc()))


def purge_user_data(db: Session, user_id: str, actor_user_id: str, reason: str) -> None:
    """Delete identity fields, assessment answers and bookings. Audit records keep ids only."""
    db.execute(delete(IntakeRecord).where(IntakeRecord.user_id == user_id))
    db.execute(delete(Booking).where(Booking.user_id == user_id))
    db.execute(update(Consent).where(Consent.user_id == user_id, Consent.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
    audit(db, reason, actor_user_id, user_id)


def delete_account(db: Session, user_id: str) -> None:
    purge_user_data(db, user_id, user_id, "account_deleted")
    db.execute(delete(Consent).where(Consent.user_id == user_id))
    db.execute(delete(User).where(User.id == user_id))
