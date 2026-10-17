import os
import secrets

from cryptography.fernet import Fernet
from dotenv import dotenv_values

# Test configuration must be in place before the app (and its cached settings) import.
os.environ.setdefault("APP_ENV", "test")
# Fresh random secrets per test run, so no key material lives in the repo.
os.environ.setdefault("SESSION_SECRET", secrets.token_urlsafe(48))
os.environ.setdefault("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("EMAIL_HMAC_KEY", secrets.token_urlsafe(48))
# Tests sign up many accounts from one address; the limiter has its own tests that switch it on.
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")
os.environ.setdefault("INVITE_CODES", "test-invite")
# TEST_DATABASE_URL (from the environment, then the repo-root .env) wins over DATABASE_URL, so a
# shell or .env set up for the dev server still runs tests against the test database.
_dotenv = {
    **dotenv_values(os.path.join(os.path.dirname(__file__), "..", "..", ".env")),
    **dotenv_values(os.path.join(os.path.dirname(__file__), "..", ".env")),
}
os.environ["DATABASE_URL"] = (
    os.environ.get("TEST_DATABASE_URL")
    or _dotenv.get("TEST_DATABASE_URL")
    or os.environ.get("DATABASE_URL", "postgresql+pg8000://onboarding:localdev@localhost:5432/onboarding_test")
)
# The suite drops and recreates every table, so refuse any database not named for tests.
if not os.environ["DATABASE_URL"].split("?")[0].rsplit("/", 1)[-1].endswith("_test"):
    raise SystemExit("Tests drop every table: point TEST_DATABASE_URL at a database whose name ends in _test.")
os.environ["ANTHROPIC_API_KEY"] = ""  # tests never call the real provider
os.environ["ANTHROPIC_RIVERSIDE_API_KEY"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import Base, get_db, get_engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.scheduling import seed_slots  # noqa: E402

# The SPA sends this on every mutating call; the CSRF guard rejects requests without it.
API_HEADERS = {"X-Requested-With": "onboarding-app"}

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "..", "fixtures")


@pytest.fixture(scope="session", autouse=True)
def _schema():
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def _clean_tables():
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE users, consents, intake_records, bookings, slots, audit_log, funnel_events, revoked_sessions RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest.fixture
def db():
    session = next(get_db())
    yield session
    session.close()


@pytest.fixture
def slots(db):
    seed_slots(db, days=7)


@pytest.fixture
def client():
    with TestClient(app, headers=API_HEADERS) as c:
        yield c


def make_client(email: str, consent: bool = True, photo_scan: bool = False) -> TestClient:
    c = TestClient(app, headers=API_HEADERS)
    r = c.post(
        "/api/auth/signup",
        json={"email": email, "password": "correct-horse-battery", "invite_code": "test-invite", "adult_attestation": True},
    )
    assert r.status_code == 201, r.text
    if consent:
        assert c.post("/api/consent", json={"photo_scan": photo_scan}).status_code == 201
    return c


@pytest.fixture
def scan_client(client):
    """A patient who also agreed to have an ID photo read."""
    c = make_client("patient.scan@example.com", photo_scan=True)
    yield c
    c.close()


@pytest.fixture
def user_client(client):
    c = make_client("patient.one@example.com")
    yield c
    c.close()
