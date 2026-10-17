"""Accounts the public demo needs: the shared patient and staff logins, and made-up patients.

The made-up patients give the staff view a schedule to show. Their names and details are invented,
they can't sign in (random password nobody knows), and analytics leave them out.
"""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Booking, Consent, IntakeRecord, Slot, User
from app.security import decrypt_str, email_lookup_key, encrypt_json, encrypt_str, end_sessions, hash_password, verify_password
from app.services.privacy import CONSENT_VERSION
from app.services.scheduling import open_slots

# Invented people. Addresses use street names that don't exist in the towns given.
SAMPLE_PATIENTS = [
    {
        "full_name": "Rowan Ellery",
        "dob": "1984-03-12",
        "address": "14 Larkspur Way, Maple Grove, MN 55369",
        "field_sources": {"full_name": "ocr_confirmed", "dob": "ocr_confirmed", "address": "ocr_edited"},
        "assessment": {
            "reason_for_visit": "Lower back pain after moving house",
            "symptom_duration": "About a week",
            "visit_type_preference": "in_person",
            "accessibility_needs": None,
        },
    },
    {
        "full_name": "Priya Castellan",
        "dob": "1991-07-28",
        "address": "302 Quillon Ave Apt 4, Maple Grove, MN 55311",
        "field_sources": {"full_name": "manual", "dob": "manual", "address": "manual"},
        "assessment": {
            "reason_for_visit": "Follow-up on blood pressure readings",
            "symptom_duration": "Ongoing",
            "visit_type_preference": "telehealth",
            "accessibility_needs": None,
        },
    },
    {
        "full_name": "Tomas Wexford",
        "dob": "1958-11-02",
        "address": "77 Brindlewood Ct, Osseo, MN 55369",
        "field_sources": {"full_name": "ocr_confirmed", "dob": "ocr_edited", "address": "ocr_confirmed"},
        "assessment": {
            "reason_for_visit": "Persistent cough",
            "symptom_duration": "Three weeks",
            "visit_type_preference": "in_person",
            "accessibility_needs": "Uses a walker; ground-floor room please",
        },
    },
    {
        "full_name": "Maribel Okonkwo-Dale",
        "dob": "1976-01-19",
        "address": "9 Fennimore Loop, Plymouth, MN 55447",
        "field_sources": {"full_name": "ocr_confirmed", "dob": "ocr_confirmed", "address": "ocr_confirmed"},
        "assessment": {
            "reason_for_visit": "Annual check-up",
            "symptom_duration": None,
            "visit_type_preference": "no_preference",
            "accessibility_needs": None,
        },
    },
    {
        "full_name": "Desmond Hallowell",
        "dob": "2001-05-30",
        "address": "1120 Tamsin Rd, Maple Grove, MN 55369",
        "field_sources": {"full_name": "manual", "dob": "manual", "address": "manual"},
        "assessment": {
            "reason_for_visit": "Feeling low and not sleeping well",
            "symptom_duration": "A couple of months",
            "visit_type_preference": "telehealth",
            "accessibility_needs": "Prefers text reminders",
        },
    },
    {
        "full_name": "Agnes Thorvald",
        "dob": "1949-09-08",
        "address": "4 Wrenfield Pl, Champlin, MN 55316",
        "field_sources": {"full_name": "ocr_edited", "dob": "ocr_confirmed", "address": "ocr_confirmed"},
        "assessment": {
            "reason_for_visit": "Dizziness when standing up",
            "symptom_duration": "A few days",
            "visit_type_preference": "in_person",
            "accessibility_needs": "Needs a Spanish interpreter",
        },
    },
]


def is_shared_login(user: User) -> bool:
    """The shared demo patient or staff login, which every reviewer uses and nobody may delete."""
    settings = get_settings()
    shared = {email_lookup_key(e) for e in (settings.demo_user_email, settings.demo_staff_email) if e}
    return user.email_lookup in shared


def upsert_account(db: Session, email: str, password: str, role: str) -> str:
    """Create a login, or update its password (and sign out its sessions) when it changed."""
    existing = db.scalar(select(User).where(User.email_lookup == email_lookup_key(email)))
    if existing is None:
        db.add(
            User(
                email_lookup=email_lookup_key(email),
                email_enc=encrypt_str(email.lower()),
                password_hash=hash_password(password),
                role=role,
                adult_attested=True,
            )
        )
        db.commit()
        return "created"
    changed = False
    if existing.role != role:
        existing.role, changed = role, True
    if not verify_password(existing.password_hash, password):
        existing.password_hash, changed = hash_password(password), True
    if changed:
        end_sessions(existing)  # anyone signed in with the old password or role is signed out
        db.commit()
        return "updated"
    return "unchanged"


def seed_sample_patients(db: Session) -> int:
    """Make sure each made-up patient exists with an upcoming visit. Returns visits (re)booked."""
    now = datetime.now(UTC)
    existing = {email: user for email, user in _sample_users(db)}
    booked = 0
    free = open_slots(db, None, limit=200)
    # Spread visits over the coming days rather than filling the first morning.
    step = max(1, len(free) // len(SAMPLE_PATIENTS))
    picks = free[step // 2 :: step]
    for i, sample in enumerate(SAMPLE_PATIENTS):
        email = f"sample-patient-{i + 1}@example.org"
        user = existing.get(email) or _create_sample(db, email, sample, now)
        upcoming = db.scalar(
            select(Booking)
            .join(Slot, Slot.id == Booking.slot_id)
            .where(Booking.user_id == user.id, Booking.status == "booked", Slot.starts_at > now)
        )
        if upcoming is not None or not picks:
            continue
        for old in db.scalars(select(Booking).where(Booking.user_id == user.id, Booking.status == "booked")):
            old.status, old.cancelled_at = "cancelled", now
        db.flush()
        db.add(Booking(slot_id=picks.pop(0).id, user_id=user.id, confirmation_code=secrets.token_hex(4).upper()))
        booked += 1
    db.commit()
    return booked


def _sample_users(db: Session):
    for user in db.scalars(select(User).where(User.synthetic.is_(True))):
        yield decrypt_str(user.email_enc), user


def _create_sample(db: Session, email: str, sample: dict, now: datetime) -> User:
    user = User(
        email_lookup=email_lookup_key(email),
        email_enc=encrypt_str(email),
        password_hash=hash_password(secrets.token_urlsafe(32)),
        role="user",
        adult_attested=True,
        synthetic=True,
    )
    db.add(user)
    db.flush()
    db.add(Consent(user_id=user.id, version=CONSENT_VERSION, photo_scan=True))
    confirmed = now - timedelta(hours=1)
    db.add(
        IntakeRecord(
            user_id=user.id,
            full_name_enc=encrypt_str(sample["full_name"]),
            dob_enc=encrypt_str(sample["dob"]),
            address_enc=encrypt_str(sample["address"]),
            field_sources=sample["field_sources"],
            identity_confirmed_at=confirmed,
            assessment_enc=encrypt_json(sample["assessment"]),
            assessment_confirmed_at=confirmed,
        )
    )
    db.flush()
    return user
