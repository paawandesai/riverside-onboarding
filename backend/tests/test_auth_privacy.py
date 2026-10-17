from sqlalchemy import select

from app.models import AuditLog, IntakeRecord
from tests.conftest import make_client

IDENTITY = {"full_name": "AVERY TESTCASE", "dob": "1980-04-02", "address": "12 FICTION WAY, NOWHERE OH 44000"}


def test_signup_requires_invite_code(client):
    r = client.post(
        "/api/auth/signup",
        json={"email": "a@example.com", "password": "correct-horse-battery", "invite_code": "wrong", "adult_attestation": True},
    )
    assert r.status_code == 403


def test_signup_requires_adult_attestation(client):
    r = client.post(
        "/api/auth/signup",
        json={"email": "a@example.com", "password": "correct-horse-battery", "invite_code": "test-invite", "adult_attestation": False},
    )
    assert r.status_code == 400


def test_signup_always_creates_user_role_and_rejects_duplicates(client):
    body = {
        "email": "dup@example.com",
        "password": "correct-horse-battery",
        "invite_code": "test-invite",
        "adult_attestation": True,
        "role": "staff",
    }
    r = client.post("/api/auth/signup", json=body)
    assert r.status_code == 201 and r.json()["role"] == "user"
    assert client.post("/api/auth/signup", json=body).status_code == 409


def test_login_logout_and_me(client):
    make_client("login@example.com", consent=False).close()
    assert client.post("/api/auth/login", json={"email": "login@example.com", "password": "nope-nope-nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "LOGIN@example.com", "password": "correct-horse-battery"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401


def test_processing_requires_consent(client):
    c = make_client("noconsent@example.com", consent=False)
    assert c.put("/api/intake/identity", json=IDENTITY).status_code == 403
    assert c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 403
    assert c.post("/api/documents/extract", files={"file": ("a.png", b"x", "image/png")}).status_code == 403
    text = c.get("/api/consent/text").json()
    assert text["version"]
    # The short notice itself states Anthropic retention, not only the full notice.
    assert any("30 days" in p and "2 years" in p for p in text["points"])


def test_identity_is_saved_encrypted_and_minor_rejected(user_client, db):
    r = user_client.put("/api/intake/identity", json={**IDENTITY, "sources": {"full_name": "ocr_confirmed", "dob": "bogus"}})
    assert r.status_code == 200
    assert r.json()["field_sources"] == {"full_name": "ocr_confirmed", "dob": "manual", "address": "manual"}
    record = db.scalar(select(IntakeRecord))
    assert b"AVERY" not in record.full_name_enc  # ciphertext at rest
    minor = user_client.put("/api/intake/identity", json={**IDENTITY, "dob": "2015-01-01"})
    assert minor.status_code == 422
    assert "2015" not in minor.text  # validation errors don't echo submitted values


def test_consent_revocation_purges_data_and_stops_processing(user_client, db):
    user_client.put("/api/intake/identity", json=IDENTITY)
    user_client.put("/api/intake/assessment", json={"reason_for_visit": "annual check-up"})
    assert user_client.post("/api/consent/revoke").json()["active"] is False
    assert user_client.get("/api/intake").status_code == 404  # verifiable: no longer retrievable
    assert user_client.put("/api/intake/identity", json=IDENTITY).status_code == 403  # processing stops
    actions = [a.action for a in db.scalars(select(AuditLog))]
    assert "consent_revoked_data_purged" in actions


def test_delete_my_data_and_account(user_client, db, slots):
    user_client.put("/api/intake/identity", json=IDENTITY)
    slot = user_client.get("/api/slots").json()[0]
    user_client.post("/api/bookings", json={"slot_id": slot["id"]})
    assert user_client.delete("/api/me/data").status_code == 204
    assert user_client.get("/api/intake").status_code == 404
    assert user_client.get("/api/bookings/mine").json() == []
    assert user_client.delete("/api/me").status_code == 204
    assert user_client.get("/api/auth/me").status_code == 401


def test_staff_access_is_role_scoped_and_audited(user_client, db):
    from app.models import User

    user_client.put("/api/intake/identity", json=IDENTITY)
    patient_id = user_client.get("/api/auth/me").json()["id"]
    other = make_client("other@example.com")
    assert other.get(f"/api/staff/intakes/{patient_id}").status_code == 403
    staff = make_client("staff@example.com")
    staff_id = staff.get("/api/auth/me").json()["id"]
    db.get(User, staff_id).role = "staff"
    db.commit()
    r = staff.get(f"/api/staff/intakes/{patient_id}")
    assert r.status_code == 200 and r.json()["full_name"] == "AVERY TESTCASE"
    assert db.scalar(select(AuditLog).where(AuditLog.action == "staff_viewed_intake")).actor_user_id == staff_id


def test_staff_schedule_lists_upcoming_visits_with_intake_and_is_audited(user_client, db, slots):
    from app.models import User

    user_client.put("/api/intake/identity", json=IDENTITY)
    user_client.put("/api/intake/assessment", json={"reason_for_visit": "Knee pain", "visit_type_preference": "in_person"})
    slot = user_client.get("/api/slots").json()[0]
    assert user_client.post("/api/bookings", json={"slot_id": slot["id"]}).status_code == 201
    patient_id = user_client.get("/api/auth/me").json()["id"]

    # Patients can't see the schedule.
    assert user_client.get("/api/staff/schedule").status_code == 403

    staff = make_client("schedule-staff@example.com")
    staff_id = staff.get("/api/auth/me").json()["id"]
    db.get(User, staff_id).role = "staff"
    db.commit()
    items = staff.get("/api/staff/schedule").json()
    assert [i["patient_id"] for i in items] == [patient_id]
    assert items[0]["full_name"] == "AVERY TESTCASE" and items[0]["slot"]["id"] == slot["id"]
    assert items[0]["identity_confirmed"] and items[0]["assessment_confirmed"]
    assert db.scalar(select(AuditLog).where(AuditLog.action == "staff_listed_schedule")).actor_user_id == staff_id

    detail = staff.get(f"/api/staff/intakes/{patient_id}").json()
    assert detail["assessment"]["reason_for_visit"] == "Knee pain"
    assert detail["assessment_summary"].startswith("Non-binding intake summary")
    assert detail["booking"]["confirmation_code"] == items[0]["confirmation_code"]
