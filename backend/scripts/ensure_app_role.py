"""Create or update the least-privilege database role the app connects as.

Runs as the database administrator (DATABASE_URL) right after migrations, in a separate init
container, so the app itself never holds admin credentials:

    APP_DATABASE_URL=postgresql+pg8000://onboarding_app:<password>@host/db python -m scripts.ensure_app_role

The role can read and write rows in the app's tables and nothing else: it cannot create, alter or
drop tables, can only add to the audit log (not change or delete it), can't touch alembic_version,
and has no other database rights. The password is sent as a SCRAM verifier, so the
server never sees it in clear text (not even in a statement log).
"""

import base64
import os
import re

from scramp import ScramMechanism
from sqlalchemy import make_url

from app.db import get_engine

_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def scram_verifier(password: str, iterations: int = 4096) -> str:
    salt, stored_key, server_key, iterations = ScramMechanism("SCRAM-SHA-256").make_auth_info(password, iteration_count=iterations)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


def statements(role: str, password: str, database: str) -> list[str]:
    if not _NAME.match(role) or not _NAME.match(database):
        raise SystemExit("APP_DATABASE_URL must use a plain lower-case role and database name.")
    verifier = scram_verifier(password).replace("'", "''")
    # Role statements can't take bind parameters; names are checked above and the verifier is base64.
    return [
        f"""DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                CREATE ROLE {role} LOGIN NOINHERIT PASSWORD '{verifier}';
              ELSE
                ALTER ROLE {role} WITH LOGIN NOINHERIT PASSWORD '{verifier}';
              END IF;
            END $$""",  # noqa: S608
        # CONNECT and schema USAGE come from PUBLIC; on Postgres 15+ PUBLIC can't create in the schema.
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}",
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}",
        # Tables added by later migrations (created by the admin) get the same rights.
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {role}",
        # The audit trail is append-only for the app, and the migration bookkeeping isn't its business.
        f"REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM {role}",
        f"""DO $$ BEGIN
              IF to_regclass('public.alembic_version') IS NOT NULL THEN
                EXECUTE 'REVOKE ALL ON alembic_version FROM {role}';
              END IF;
            END $$""",
    ]


def main() -> None:
    app_url = make_url(os.environ["APP_DATABASE_URL"])
    if not app_url.username or not app_url.password or not app_url.database:
        raise SystemExit("APP_DATABASE_URL needs a user, password and database.")
    with get_engine().begin() as conn:
        for sql in statements(app_url.username, app_url.password, app_url.database):
            conn.exec_driver_sql(sql)  # no bind parsing: the verifier contains colons
    print(f"database role {app_url.username} is ready (row access only)")


if __name__ == "__main__":
    main()
