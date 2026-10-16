import io
import json
import os

import pytest
from PIL import Image

from app.services import ocr
from app.services.privacy import CONSENT_VERSION
from app.services.uploads import MAX_PIXELS, UploadRejected, validate_and_clean
from tests.conftest import FIXTURES

GOLDEN = os.path.join(FIXTURES, "generated-ids")


def _png(size=(50, 50), **save_kw) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, "PNG", **save_kw)
    return buf.getvalue()


def test_rejects_empty_non_image_oversized_and_corrupt():
    with pytest.raises(UploadRejected):
        validate_and_clean(b"", 1000)
    with pytest.raises(UploadRejected, match="isn't a supported image"):
        validate_and_clean(b"%PDF-1.7 not an image", 10_000)
    with pytest.raises(UploadRejected, match="larger than"):
        validate_and_clean(b"\x89PNG\r\n\x1a\n" + b"0" * 5000, 1000)
    with pytest.raises(UploadRejected, match="couldn't read"):
        validate_and_clean(_png()[:60], 10_000)


def test_rejects_decompression_bomb():
    side = int(MAX_PIXELS**0.5) + 100
    data = _png(size=(side, side), compress_level=9)
    with pytest.raises(UploadRejected, match="too large"):
        validate_and_clean(data, 50 * 1024 * 1024)


def test_strips_exif_including_gps():
    img = Image.new("RGB", (40, 40), "white")
    exif = Image.Exif()
    exif[0x8825] = {2: (40.0, 26.0, 46.0)}  # GPSInfo
    exif[0x010F] = "FakeCam"
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    clean = validate_and_clean(buf.getvalue(), 10_000_000)
    assert not clean.image.getexif()
    assert clean.image.info.get("exif") is None


def test_accepts_heic():
    import pillow_heif

    buf = io.BytesIO()
    pillow_heif.from_pillow(Image.new("RGB", (64, 64), "white")).save(buf, quality=80)
    assert validate_and_clean(buf.getvalue(), 10_000_000).source_format in {"HEIF", "HEIC"}


def test_normalize_dob_formats_and_refusals():
    assert ocr.normalize_dob("03/21/1974") == "1974-03-21"
    assert ocr.normalize_dob("12 AUG 1965") == "1965-08-12"
    assert ocr.normalize_dob("1961-12-20") == "1961-12-20"
    assert ocr.normalize_dob("13/45/1990") is None
    assert ocr.normalize_dob("sometime in 1990") is None


def _line(text, conf=95.0):
    words, x = [], 0
    for w in text.split():
        words.append(ocr._Word(w, conf, x))
        x += 20 * (len(w) + 1)
    return ocr._Line(words)


def test_partial_extraction_leaves_missing_fields_blank():
    lines = [_line("NAME JORDAN EXAMPLE"), _line("DOB 01/02/1970"), _line("MEMBER NO MG-123456")]
    fields = ocr.parse_fields(lines)
    assert fields["full_name"].value == "JORDAN EXAMPLE"
    assert fields["dob"].value == "1970-01-02"
    assert fields["address"].value is None and fields["address"].status == "missing"


def test_low_confidence_is_flagged_not_dropped():
    fields = ocr.parse_fields([_line("NAME JORDAN EXAMPLE", conf=41)])
    assert fields["full_name"].value == "JORDAN EXAMPLE"
    assert fields["full_name"].status == "low_confidence"


def test_unlabeled_date_fallback_ignores_issue_dates_and_minors():
    lines = [_line("ISSUED 2026-01-15"), _line("pos 2001-05-05")]
    fields = ocr.parse_fields(lines)
    assert fields["dob"].value == "2001-05-05" and fields["dob"].status == "low_confidence"
    assert ocr.parse_fields([_line("ISSUED 2026-01-15")])["dob"].value is None


def test_extracts_clean_golden_card():
    labels = json.load(open(os.path.join(GOLDEN, "labels.json")))["items"]
    item = next(i for i in labels if i["category"] == "clean_scan")
    result = ocr.extract_fields(Image.open(os.path.join(GOLDEN, item["file"])).convert("RGB"))
    for name, expected in item["expected"].items():
        assert result.fields[name].value == expected


def test_extract_endpoint_returns_fields_and_never_retains_image(scan_client):
    labels = json.load(open(os.path.join(GOLDEN, "labels.json")))["items"]
    item = labels[0]
    with open(os.path.join(GOLDEN, item["file"]), "rb") as fh:
        r = scan_client.post("/api/documents/extract", files={"file": ("card.jpg", fh, "image/jpeg")})
    assert r.status_code == 200
    body = r.json()
    assert body["image_retained"] is False
    assert set(body["fields"]) == {"full_name", "dob", "address"}


def test_extract_endpoint_rejects_non_image_with_message(scan_client):
    r = scan_client.post("/api/documents/extract", files={"file": ("notes.txt", b"hello there", "text/plain")})
    assert r.status_code == 422 and "supported image" in r.json()["detail"]


def test_blank_image_offers_manual_entry(scan_client):
    r = scan_client.post("/api/documents/extract", files={"file": ("blank.png", _png((800, 500)), "image/png")})
    assert r.status_code == 200
    assert r.json()["missing"] == ["full_name", "dob", "address"]
    assert "type them in" in r.json()["message"]


def test_ocr_engine_failure_degrades_to_manual(scan_client, monkeypatch):
    def boom(_):
        raise ocr.OcrUnavailable("TesseractNotFoundError")

    monkeypatch.setattr(ocr, "extract_fields", boom)
    r = scan_client.post("/api/documents/extract", files={"file": ("a.png", _png(), "image/png")})
    assert r.status_code == 503 and "type your details" in r.json()["detail"]


def test_extract_needs_separate_photo_consent(user_client):
    with open(os.path.join(GOLDEN, "specimen-01.jpg"), "rb") as fh:
        r = user_client.post("/api/documents/extract", files={"file": ("card.jpg", fh, "image/jpeg")})
    assert r.status_code == 403 and "type your details" in r.json()["detail"]
    # Turning photo consent on later works without a second full consent.
    assert user_client.post("/api/consent", json={"photo_scan": True}).json()["photo_scan"] is True
    assert user_client.get("/api/consent").json() == {"active": True, "version": CONSENT_VERSION, "photo_scan": True}
