"""Seed appointment slots and an optional demo user (user role only).

Usage: python -m scripts.seed [--demo-user]   (reads DEMO_USER_EMAIL / DEMO_USER_PASSWORD from env)
"""

import argparse
import os

from sqlalchemy import func, select

from app.db import get_db
from app.models import Slot, User
from app.security import email_lookup_key, encrypt_str, hash_password
from app.services.scheduling import seed_slots


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo-user", action="store_true")
    args = parser.parse_args()
    db = next(get_db())
    if db.scalar(select(func.count()).select_from(Slot)) == 0:
        print(f"created {seed_slots(db)} slots")
    else:
        print("slots already seeded")
    if args.demo_user:
        email, password = os.environ.get("DEMO_USER_EMAIL"), os.environ.get("DEMO_USER_PASSWORD")
        if not email or not password:
            raise SystemExit("Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD to create the demo user.")
        if db.scalar(select(User).where(User.email_lookup == email_lookup_key(email))) is None:
            db.add(
                User(
                    email_lookup=email_lookup_key(email),
                    email_enc=encrypt_str(email.lower()),
                    password_hash=hash_password(password),
                    role="user",
                    adult_attested=True,
                )
            )
            db.commit()
            print("created demo user (role=user)")


if __name__ == "__main__":
    main()
