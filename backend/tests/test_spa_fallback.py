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
