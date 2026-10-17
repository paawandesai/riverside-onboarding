"""Scheduled purge for the public demo: delete data older than DEMO_RETENTION_HOURS.

Runs hourly as a scheduled job (see infra/terraform):
* accounts created more than DEMO_RETENTION_HOURS ago are deleted with all their data;
* the shared demo account is kept, and its data is cleared only once nobody has touched it for
  DEMO_RETENTION_HOURS, so a reviewer partway through the flow doesn't lose it;
* the staff login and the made-up sample patients are kept;
* anonymous funnel events older than ANALYTICS_RETENTION_DAYS are deleted;
* appointment slots are topped up so the next two weeks always have open times, and sample
  patients whose visit has passed get a new one (when DEMO_SAMPLE_PATIENTS is set).
The audit log (ids and action names only) is kept.
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select

from app.config import get_settings
from app.db import get_db
from app.models import Booking, Consent, FunnelEvent, IntakeRecord, RevokedSession, User
from app.security import SESSION_MAX_AGE_SECONDS, email_lookup_key
from app.services.demo import seed_sample_patients
from app.services.privacy import delete_account, purge_user_data
from app.services.scheduling import prune_off_hours_slots, seed_slots


def last_activity(db, user_id: str) -> datetime | None:
    times = [
        db.scalar(select(func.max(IntakeRecord.updated_at)).where(IntakeRecord.user_id == user_id)),
        db.scalar(select(func.max(Booking.created_at)).where(Booking.user_id == user_id)),
        db.scalar(select(func.max(Booking.cancelled_at)).where(Booking.user_id == user_id)),
        db.scalar(select(func.max(Consent.granted_at)).where(Consent.user_id == user_id, Consent.revoked_at.is_(None))),
    ]
    times = [t for t in times if t is not None]
    return max(times) if times else None


def main() -> None:
    settings = get_settings()
    cutoff = datetime.now(UTC) - timedelta(hours=settings.demo_retention_hours)
    demo_email = os.environ.get("DEMO_USER_EMAIL")
    keep = email_lookup_key(demo_email) if demo_email else None
    db = next(get_db())
    deleted = cleared = 0
    for user in db.scalars(select(User).where(User.role == "user", User.synthetic.is_(False))).all():
        if user.email_lookup == keep:
            latest = last_activity(db, user.id)
            if latest is not None and latest < cutoff:
                purge_user_data(db, user.id, None, "scheduled_demo_purge")
                cleared += 1
        elif user.created_at < cutoff:
            delete_account(db, user.id)
            deleted += 1
    events_cutoff = datetime.now(UTC) - timedelta(days=settings.analytics_retention_days)
    events = db.execute(delete(FunnelEvent).where(FunnelEvent.at < events_cutoff)).rowcount
    # A revoked session id only matters until the token would have expired anyway.
    session_cutoff = datetime.now(UTC) - timedelta(seconds=SESSION_MAX_AGE_SECONDS)
    db.execute(delete(RevokedSession).where(RevokedSession.revoked_at < session_cutoff))
    db.commit()
    pruned = prune_off_hours_slots(db)
    added = seed_slots(db, days=14)
    rebooked = seed_sample_patients(db) if os.environ.get("DEMO_SAMPLE_PATIENTS") else 0
    print(
        f"deleted {deleted} accounts, cleared the demo account {cleared}x, removed {events} events, "
        f"removed {pruned} off-hours slots, added {added} slots, rebooked {rebooked} sample visits"
    )


if __name__ == "__main__":
    main()
