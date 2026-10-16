"""Create a staff account from the command line (never via the public API).

Usage: STAFF_EMAIL=... STAFF_PASSWORD=... python -m scripts.create_staff
Do not run this against the public demo deployment: it has no admin or staff accounts.
"""

import os

from app.db import get_db
from app.models import User
from app.security import email_lookup_key, encrypt_str, hash_password

if __name__ == "__main__":
    email, password = os.environ["STAFF_EMAIL"], os.environ["STAFF_PASSWORD"]
    db = next(get_db())
    db.add(
        User(
            email_lookup=email_lookup_key(email),
            email_enc=encrypt_str(email.lower()),
            password_hash=hash_password(password),
            role="staff",
            adult_attested=True,
        )
    )
    db.commit()
    print("created staff user")
