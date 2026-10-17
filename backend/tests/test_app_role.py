"""The app's database role can read and write rows but cannot change the schema."""

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError

from app.db import get_engine
from scripts import ensure_app_role


@pytest.fixture
def can_create_roles():
    with get_engine().connect() as conn:
        ok = conn.execute(text("SELECT rolcreaterole OR rolsuper FROM pg_roles WHERE rolname = current_user")).scalar()
    if not ok:
        pytest.skip("the test database user can't create roles")


def test_app_role_has_row_access_only(can_create_roles, monkeypatch):
    admin = get_engine().url
    app_url = admin.set(username="onboarding_app_test", password="TestOnlyPassw0rd123")
    monkeypatch.setenv("APP_DATABASE_URL", app_url.render_as_string(hide_password=False))
    ensure_app_role.main()
    ensure_app_role.main()  # idempotent: re-running updates the password and grants

    engine = create_engine(app_url)
    try:
        with engine.begin() as conn:
            conn.execute(text("SELECT count(*) FROM users")).scalar()
            conn.execute(text("INSERT INTO funnel_events (at, anon_session_id, step_id, event) VALUES (now(), 'x', 'chat', 'viewed')"))
            conn.execute(text("DELETE FROM funnel_events"))
        with pytest.raises(ProgrammingError):
            with engine.begin() as conn:
                conn.execute(text("CREATE TABLE should_fail (id int)"))
        with pytest.raises(ProgrammingError):
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE users"))
    finally:
        engine.dispose()


def test_verifier_never_contains_the_password():
    assert "hunter2hunter2" not in ensure_app_role.scram_verifier("hunter2hunter2")


def test_role_names_are_checked():
    with pytest.raises(SystemExit):
        ensure_app_role.statements("bad name; drop", "x", "onboarding")
