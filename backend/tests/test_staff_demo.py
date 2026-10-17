import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models import AuditLog, FunnelEvent, IntakeRecord, User
from app.security import email_lookup_key
from app.services.demo import SAMPLE_PATIENTS, seed_sample_patients, upsert_account
from tests.conftest import make_client


def staff_client(db, email="analytics-staff@example.com"):
    c = make_client(email, consent=False)
    db.get(User, c.get("/api/auth/me").json()["id"]).role = "staff"
    db.commit()
    return c


def add_session(db, steps, start, gaps):
    sid = str(uuid.uuid4())
    at = start
    for step, gap in zip(steps, gaps, strict=True):
        db.add(FunnelEvent(anon_session_id=sid, step_id=step, event="viewed", at=at))
        at += timedelta(seconds=gap)
    db.commit()
    return sid


def test_analytics_reports_funnel_drop_off_and_time_per_step(db):
    now = datetime.now(UTC) - timedelta(hours=1)
    flow = ["start", "account", "consent", "chat"]
    add_session(db, flow, now, [10, 20, 30, 40])
    add_session(db, flow[:2], now, [12, 99])
    add_session(db, ["start"], now, [5])
    # A 2-hour gap is a closed tab, not time spent on the step.
    add_session(db, ["start", "account"], now, [7200, 1])
    db.add(FunnelEvent(anon_session_id=str(uuid.uuid4()), step_id="chat", event="support_long_pause", at=now))
    # Older than the window: ignored.
    add_session(db, ["start"], now - timedelta(days=30), [1])
    db.commit()

    r = staff_client(db).get("/api/staff/analytics?days=7")
    assert r.status_code == 200, r.text
    data = r.json()
    steps = {s["step"]: s for s in data["funnel"]}
    assert [s["step"] for s in data["funnel"]][:3] == ["start", "account", "consent"]
    assert steps["start"]["sessions"] == 4 and steps["start"]["share_of_start"] == 1.0
    assert steps["account"]["sessions"] == 3 and steps["account"]["drop_off"] == 0.25
    assert steps["consent"]["sessions"] == 1 and steps["consent"]["share_of_start"] == 0.25
    # start -> next view: 10 s and 12 s; the 7200 s gap is dropped.
    assert steps["start"]["median_seconds"] == 11.0 and steps["start"]["timed_sessions"] == 2
    assert steps["done"]["sessions"] == 0 and steps["done"]["median_seconds"] is None
    assert data["support_shown"] == {"long_pause": 1}
    assert db.scalar(select(AuditLog).where(AuditLog.action == "staff_viewed_analytics")) is not None


def test_analytics_ocr_correction_rates_leave_out_sample_patients(db, slots, user_client):
    seed_sample_patients(db)
    me = user_client.get("/api/auth/me").json()["id"]
    db.add(
        IntakeRecord(
            user_id=me,
            field_sources={"full_name": "ocr_confirmed", "dob": "ocr_edited", "address": "manual"},
            identity_confirmed_at=datetime.now(UTC),
        )
    )
    db.commit()
    data = staff_client(db).get("/api/staff/analytics").json()
    assert data["ocr_records"] == 1
    ocr = {f["field"]: f for f in data["ocr"]}
    assert ocr["full_name"] == {"field": "full_name", "confirmed": 1, "corrected": 0, "typed": 0, "correction_rate": 0.0}
    assert ocr["dob"]["correction_rate"] == 1.0
    assert ocr["address"]["typed"] == 1 and ocr["address"]["correction_rate"] is None


def test_analytics_is_staff_only(user_client):
    assert user_client.get("/api/staff/analytics").status_code == 403


def test_sample_patients_get_upcoming_visits_and_show_in_schedule(db, slots):
    assert seed_sample_patients(db) == len(SAMPLE_PATIENTS)
    # Idempotent: a second run neither adds patients nor rebooks.
    assert seed_sample_patients(db) == 0
    assert db.query(User).filter(User.synthetic.is_(True)).count() == len(SAMPLE_PATIENTS)
    items = staff_client(db).get("/api/staff/schedule").json()
    assert len(items) == len(SAMPLE_PATIENTS) and all(i["sample"] for i in items)
    assert {i["full_name"] for i in items} == {p["full_name"] for p in SAMPLE_PATIENTS}


def test_sample_patients_cannot_sign_in(db, slots, client):
    seed_sample_patients(db)
    r = client.post("/api/auth/login", json={"email": "sample-patient-1@example.org", "password": "anything-at-all"})
    assert r.status_code == 401


def test_purge_keeps_staff_and_sample_patients(db, slots, monkeypatch):
    from scripts import purge_demo_data

    seed_sample_patients(db)
    upsert_account(db, "demo-staff@example.com", "staff-password-123", role="staff")
    old = datetime.now(UTC) - timedelta(days=3)
    for user in db.scalars(select(User)):
        user.created_at = old
    db.commit()
    monkeypatch.setenv("DEMO_SAMPLE_PATIENTS", "true")
    purge_demo_data.main()
    db.expire_all()
    assert db.query(User).filter(User.synthetic.is_(True)).count() == len(SAMPLE_PATIENTS)
    assert db.scalar(select(User).where(User.email_lookup == email_lookup_key("demo-staff@example.com"))).role == "staff"


def test_upsert_account_rotates_password_and_role(db, client):
    assert upsert_account(db, "rotate@example.com", "first-password-1", role="staff") == "created"
    assert upsert_account(db, "rotate@example.com", "first-password-1", role="staff") == "unchanged"
    assert upsert_account(db, "rotate@example.com", "second-password-2", role="staff") == "updated"
    user = db.scalar(select(User).where(User.email_lookup == email_lookup_key("rotate@example.com")))
    assert user.session_version == 1
    ok = client.post("/api/auth/login", json={"email": "rotate@example.com", "password": "second-password-2"})
    assert ok.status_code == 200 and ok.json()["role"] == "staff"


def test_staff_accounts_cannot_consent_or_book(db, slots):
    staff = staff_client(db, "booking-staff@example.com")
    assert staff.post("/api/consent", json={"photo_scan": False}).status_code == 403
    slot = staff.get("/api/slots").json()[0]
    assert staff.post("/api/bookings", json={"slot_id": slot["id"]}).status_code == 403


def test_consent_notice_says_demo_staff_can_see_entries(client):
    points = client.get("/api/consent/text").json()["points"]
    assert any("staff login" in p for p in points)
