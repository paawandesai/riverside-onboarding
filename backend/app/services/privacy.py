from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import Booking, Consent, IntakeRecord, User
from app.security import audit

CONSENT_VERSION = "2026-10-v2"

# Layered notice: short points first, the full notice behind "Read the full privacy notice".
CONSENT_TEXT = {
    "version": CONSENT_VERSION,
    "summary": "How we use your information",
    "points": [
        "We ask for your name, date of birth, address and why you're visiting. Only what we need to book you.",
        "What you type in the chat is processed by Anthropic's Claude. Anthropic keeps it up to 30 days, or up to 2 years if their safety systems flag it.",
        "ID photos are read on our own servers, never sent to an AI service, and discarded straight away. We never store them.",
        "Our care team reviews your answers. The assistant doesn't diagnose or decide your care.",
        "You can withdraw and delete your information at any time from the menu.",
    ],
    "photo_scan": "Let me scan my ID. Optional. Saves typing. You can say no and type instead.",
    "details": [
        "We use your name, date of birth, address and visit answers only to set up your account and book your appointment.",
        "Chat messages are sent to Anthropic's Claude API to help guide sign-up. Your name, date of birth, address, email and ID photo are not sent. "
        "Anthropic keeps API data for up to 30 days by default, and up to 2 years if its safety systems flag a message. "
        "Deleting your data here does not delete copies Anthropic already holds.",
        "If you choose to scan your ID, the photo is processed in memory on our servers to fill in the form and then discarded. It is never stored and never sent to any AI provider.",
        "Your details are encrypted in our database. Our logs never contain your name, date of birth, address, email, messages or photos.",
        "Withdrawing consent stops processing and deletes your details, answers and booking from our systems. You can also delete your whole account.",
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
