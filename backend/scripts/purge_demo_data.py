"""Scheduled purge for the public demo: delete user data older than DEMO_RETENTION_HOURS.

Runs as a scheduled job (see infra/terraform). Keeps the demo user account itself and the
audit log (ids and action names only).
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.security import email_lookup_key
from app.services.privacy import delete_account, purge_user_data

if __name__ == "__main__":
    settings = get_settings()
    cutoff = datetime.now(UTC) - timedelta(hours=settings.demo_retention_hours)
    demo_email = os.environ.get("DEMO_USER_EMAIL")
    keep = email_lookup_key(demo_email) if demo_email else None
    db = next(get_db())
    purged = 0
    for user in db.scalars(select(User).where(User.created_at < cutoff, User.role == "user")):
        if user.email_lookup == keep:
            purge_user_data(db, user.id, None, "scheduled_demo_purge")
        else:
            delete_account(db, user.id)
        purged += 1
    db.commit()
    print(f"purged {purged} accounts older than {settings.demo_retention_hours}h")
