"""Seed appointment slots and, on the public demo, its shared logins and made-up patients.

Usage: python -m scripts.seed [--demo-user] [--demo-staff] [--sample-patients]
  --demo-user        patient login from DEMO_USER_EMAIL / DEMO_USER_PASSWORD (role user)
  --demo-staff       staff login from DEMO_STAFF_EMAIL / DEMO_STAFF_PASSWORD (role staff)
  --sample-patients  invented patients with upcoming visits, so the staff view has a schedule
Changing a password in the environment and re-running updates it and signs that login out.
"""

import argparse
import os

from app.db import get_db
from app.services.demo import seed_sample_patients, upsert_account
from app.services.scheduling import seed_slots


def _login(prefix: str) -> tuple[str, str]:
    email, password = os.environ.get(f"{prefix}_EMAIL"), os.environ.get(f"{prefix}_PASSWORD")
    if not email or not password:
        raise SystemExit(f"Set {prefix}_EMAIL and {prefix}_PASSWORD.")
    return email, password


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo-user", action="store_true")
    parser.add_argument("--demo-staff", action="store_true")
    parser.add_argument("--sample-patients", action="store_true")
    args = parser.parse_args()
    db = next(get_db())
    # Tops up a rolling two weeks; existing slots (and their bookings) are left alone.
    print(f"added {seed_slots(db)} slots")
    if args.demo_user:
        print(f"demo user (role=user): {upsert_account(db, *_login('DEMO_USER'), role='user')}")
    if args.demo_staff:
        print(f"demo staff (role=staff): {upsert_account(db, *_login('DEMO_STAFF'), role='staff')}")
    if args.sample_patients:
        print(f"booked {seed_sample_patients(db)} sample patient visits")


if __name__ == "__main__":
    main()
