from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


def test_client_routes_serve_the_app_but_missing_assets_and_api_paths_404(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>app</title>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    monkeypatch.setenv("STATIC_DIR", str(tmp_path))
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        for path in ("/", "/book", "/staff/patients/abc", "/account"):
            r = client.get(path)
            assert r.status_code == 200 and "<title>app</title>" in r.text, path
            assert "script-src 'self'" in r.headers["content-security-policy"]
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/assets/missing.js").status_code == 404
        assert client.get("/api/does-not-exist").status_code == 404
    finally:
        get_settings.cache_clear()


def test_each_page_gets_its_own_style_nonce_matching_the_csp(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text('<meta name="csp-nonce" content="__CSP_NONCE__"><title>app</title>')
    monkeypatch.setenv("STATIC_DIR", str(tmp_path))
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        nonces = []
        for _ in range(2):
            r = client.get("/book")
            nonce = r.text.split('content="')[1].split('"')[0]
            assert nonce != "__CSP_NONCE__" and f"style-src 'self' 'nonce-{nonce}'" in r.headers["content-security-policy"]
            nonces.append(nonce)
        assert nonces[0] != nonces[1]
    finally:
        get_settings.cache_clear()


def test_production_defaults_hide_the_schema_and_send_hsts(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        assert client.get("/api/openapi.json").status_code == 404
        assert "max-age" in client.get("/api/health").headers["strict-transport-security"]
    finally:
        get_settings.cache_clear()
