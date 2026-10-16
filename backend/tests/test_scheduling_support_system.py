import logging
import threading

from fastapi.testclient import TestClient

from app.main import app
from app.services import llm, support
from tests.conftest import API_HEADERS, make_client


def test_view_book_confirm_and_persist(user_client, slots):
    open_slots = user_client.get("/api/slots").json()
    assert open_slots
    r = user_client.post("/api/bookings", json={"slot_id": open_slots[0]["id"]})
    assert r.status_code == 201 and r.json()["confirmation_code"]
    # A new session (fresh login) still sees the booking.
    fresh = TestClient(app, headers=API_HEADERS)
    fresh.post("/api/auth/login", json={"email": "patient.one@example.com", "password": "correct-horse-battery"})
    assert fresh.get("/api/bookings/mine").json()[0]["id"] == r.json()["id"]
    assert open_slots[0]["id"] not in [s["id"] for s in user_client.get("/api/slots").json()]


def test_double_booking_rejected(user_client, slots):
    slot_id = user_client.get("/api/slots").json()[0]["id"]
    assert user_client.post("/api/bookings", json={"slot_id": slot_id}).status_code == 201
    other = make_client("second@example.com")
    r = other.post("/api/bookings", json={"slot_id": slot_id})
    body = r.json()
    assert r.status_code == 409 and "closest open times" in body["detail"]
    # The closest open times of the same visit type are offered, and none is the taken slot.
    assert len(body["alternatives"]) == 3 and slot_id not in [a["id"] for a in body["alternatives"]]
    still_open = {s["id"] for s in other.get("/api/slots").json()}
    assert all(a["id"] in still_open for a in body["alternatives"])


def test_concurrent_booking_only_one_wins(slots):
    clients = [make_client(f"racer{i}@example.com") for i in range(6)]
    slot_id = clients[0].get("/api/slots").json()[0]["id"]
    results = []
    barrier = threading.Barrier(len(clients))

    def go(c):
        barrier.wait()
        results.append(c.post("/api/bookings", json={"slot_id": slot_id}).status_code)

    threads = [threading.Thread(target=go, args=(c,)) for c in clients]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [201] + [409] * (len(clients) - 1)


def test_reschedule_and_cancel(user_client, slots):
    first, second = user_client.get("/api/slots").json()[:2]
    b1 = user_client.post("/api/bookings", json={"slot_id": first["id"]}).json()
    b2 = user_client.post("/api/bookings", json={"slot_id": second["id"]}).json()
    mine = user_client.get("/api/bookings/mine").json()
    assert [b["id"] for b in mine] == [b2["id"]] and b1["id"] != b2["id"]
    assert user_client.post(f"/api/bookings/{b2['id']}/cancel").status_code == 204
    assert user_client.get("/api/bookings/mine").json() == []
    assert user_client.post(f"/api/bookings/{b2['id']}/cancel").status_code == 404


def test_booking_unknown_slot(user_client, slots):
    assert user_client.post("/api/bookings", json={"slot_id": 999999}).status_code == 404


def test_support_triggers_each_map_to_content():
    cases = {
        "distress": support.Signals(distress=True),
        "upload_failed": support.Signals(upload_failed=True),
        "ocr_low_confidence": support.Signals(ocr_low_confidence=True),
        "booking_conflict": support.Signals(booking_conflicts=2),
        "llm_unavailable": support.Signals(llm_unavailable=True),
        "long_pause": support.Signals(idle_seconds=support.IDLE_SECONDS_THRESHOLD),
    }
    for trigger, signals in cases.items():
        assert support.content_for(signals)["trigger"] == trigger


def test_support_not_shown_without_trigger_and_priority_order(client):
    assert support.content_for(support.Signals(idle_seconds=support.IDLE_SECONDS_THRESHOLD - 1)) is None
    assert client.post("/api/support/evaluate", json={}).json() == {"content": None}
    both = client.post("/api/support/evaluate", json={"idle_seconds": 120, "distress": True}).json()
    assert both["content"]["trigger"] == "distress"


def test_events_are_first_party_and_anonymous(client, db):
    from app.models import FunnelEvent

    r = client.post(
        "/api/events", json={"anon_session_id": "6f1b8c1e-0b7a-4d0c-9a51-7d0f3b2f1a11", "step_id": "upload", "event": "started"}
    )
    assert r.status_code == 204
    assert (
        client.post(
            "/api/events", json={"anon_session_id": "6f1b8c1e-0b7a-4d0c-9a51-7d0f3b2f1a11", "step_id": "Name: Avery", "event": "x"}
        ).status_code
        == 422
    )
    assert db.query(FunnelEvent).count() == 1


def test_health_reports_config_without_model_call(client, monkeypatch):
    def forbidden(*_a, **_k):
        raise AssertionError("health check must not call the model")

    monkeypatch.setattr(llm, "classify_turn", forbidden)
    body = client.get("/api/health").json()
    assert body["database"] == "ok"
    assert body["ocr"]["version"]
    assert body["llm"]["mode"] == "fallback_only"
    assert client.get("/api/health").headers["X-Robots-Tag"] == "noindex, nofollow"


def test_logs_contain_no_pii(user_client, slots, caplog):
    secret_name, secret_reason = "ZEPHYRINE QUILLBRACKET", "my secret rash symptom"
    with caplog.at_level(logging.INFO):
        user_client.put(
            "/api/intake/identity", json={"full_name": secret_name, "dob": "1980-01-01", "address": "99 HIDDEN LANE, NOWHERE OH 44000"}
        )
        user_client.post("/api/chat", json={"messages": [{"role": "user", "content": secret_reason}]})
        user_client.put("/api/intake/identity", json={"full_name": secret_name, "dob": "2020-01-01", "address": "x"})
    from app.logging_config import JsonFormatter

    rendered = "\n".join(JsonFormatter().format(r) for r in caplog.records)
    for needle in (secret_name, "HIDDEN LANE", "1980-01-01", secret_reason, "patient.one@example.com"):
        assert needle not in rendered
    assert '"event": "chat_turn"' in rendered


def test_one_booking_conflict_is_inline_two_show_support():
    assert support.content_for(support.Signals(booking_conflicts=1)) is None
    assert support.content_for(support.Signals(booking_conflicts=2))["trigger"] == "booking_conflict"


def test_mutations_without_csrf_header_are_rejected(client):
    bare = TestClient(app)
    r = bare.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 12})
    assert r.status_code == 403
    assert bare.get("/api/health").status_code == 200  # reads are unaffected


def test_security_headers(client):
    r = client.get("/api/health")
    assert "script-src 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["Permissions-Policy"].startswith("camera=(self)")
    assert r.headers["X-Frame-Options"] == "DENY"


def test_progress_reports_flags_only(user_client, slots):
    p = user_client.get("/api/progress").json()
    assert p == {"consent": True, "photo_scan": False, "assessment_done": False, "identity_done": False, "booked": False}
    user_client.post("/api/bookings", json={"slot_id": user_client.get("/api/slots").json()[0]["id"]})
    assert user_client.get("/api/progress").json()["booked"] is True
