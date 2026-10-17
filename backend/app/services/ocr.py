"""Document text extraction with Tesseract (run as a separate process via pytesseract).

The pipeline is deliberately simple and deterministic:
  1. preprocess (grayscale, upscale, deskew by projection profile, contrast)
  2. Tesseract word-level OCR with confidences
  3. parse labeled fields (NAME / DOB / ADDRESS) into normalized values
  4. only if something is still missing or uncertain: retry with another page-segmentation
     mode, then on a glare- and stamp-suppressed image (see preprocess_flat)

Each field reports found / missing / low_confidence. Nothing is guessed: a field we
cannot read is returned as None so the user fills it in.
"""

import os
import re
import time
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pytesseract
from PIL import Image, ImageFilter, ImageOps

from app.config import get_settings

# One OpenMP thread per Tesseract process. Requests already run in parallel; letting each process
# spawn a thread per core oversubscribes the CPU and made OCR time out on a busy CI runner.
os.environ.setdefault("OMP_THREAD_LIMIT", "1")

FIELDS = ("full_name", "dob", "address")
LOW_CONFIDENCE = 60.0


class OcrUnavailable(Exception):
    pass


@dataclass
class FieldResult:
    value: str | None
    confidence: float | None
    status: str  # "found" | "low_confidence" | "missing"


@dataclass
class OcrResult:
    fields: dict[str, FieldResult]
    duration_ms: int
    engine: str = "tesseract"
    notes: list[str] = field(default_factory=list)

    @property
    def any_found(self) -> bool:
        return any(f.value for f in self.fields.values())


# ---------- preprocessing ----------


def _deskew_angle(gray: Image.Image) -> float:
    """Pick the rotation (in 0.5 degree steps, +/-10) that makes text rows sharpest."""
    small = gray.copy()
    small.thumbnail((700, 700))
    arr = np.asarray(small, dtype=np.float32)
    binary = (arr < arr.mean() - 0.5 * arr.std()).astype(np.uint8) * 255
    img = Image.fromarray(binary)
    best_angle, best_score = 0.0, -1.0
    for angle in np.arange(-10, 10.5, 0.5):
        rotated = np.asarray(img.rotate(float(angle), resample=Image.Resampling.NEAREST, fillcolor=0), dtype=np.float32)
        rows = rotated.sum(axis=1)
        score = float(np.var(np.diff(rows)))
        if score > best_score:
            best_angle, best_score = float(angle), score
    return best_angle


def preprocess(image: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(image)
    # Upscale small photos so glyphs are large enough for Tesseract (~30px cap height).
    if gray.width < 1600:
        scale = 1600 / gray.width
        gray = gray.resize((int(gray.width * scale), int(gray.height * scale)), Image.Resampling.LANCZOS)
    angle = _deskew_angle(gray)
    if abs(angle) >= 0.5:
        gray = gray.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=255)
    gray = ImageOps.autocontrast(gray, cutoff=2)
    return gray.filter(ImageFilter.MedianFilter(3))


def preprocess_flat(image: Image.Image) -> Image.Image:
    """A second view of the card for glare and coloured stamps.

    Printed text is dark in every colour channel, while a coloured stamp or watermark is bright
    in at least one, so taking the brightest channel per pixel fades the stamp and keeps the text.
    Dividing by a heavily blurred copy then removes uneven lighting (glare, shadow), so faint text
    under a hotspot gets the same contrast as text elsewhere.
    """
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    gray = Image.fromarray(rgb.max(axis=2).astype(np.uint8))
    if gray.width < 1600:
        scale = 1600 / gray.width
        gray = gray.resize((int(gray.width * scale), int(gray.height * scale)), Image.Resampling.LANCZOS)
    angle = _deskew_angle(gray)
    if abs(angle) >= 0.5:
        gray = gray.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=255)
    arr = np.asarray(gray, dtype=np.float32)
    background = np.asarray(gray.filter(ImageFilter.GaussianBlur(radius=max(gray.width // 40, 8))), dtype=np.float32)
    flat = np.clip(arr / np.maximum(background, 1.0) * 255.0, 0, 255).astype(np.uint8)
    return ImageOps.autocontrast(Image.fromarray(flat), cutoff=1)


# ---------- OCR ----------


@dataclass
class _Word:
    text: str
    confidence: float
    left: int


@dataclass
class _Line:
    words: list[_Word]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def confidence(self) -> float:
        return sum(w.confidence for w in self.words) / len(self.words)

    def from_x(self, x: int) -> "_Line":
        """Words starting at or right of x (drops noise left of an aligned column)."""
        return _Line([w for w in self.words if w.left >= x]) if any(w.left >= x for w in self.words) else self


def _ocr_lines(image: Image.Image, psm: int = 4) -> list[_Line]:
    settings = get_settings()
    pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
    try:
        data = pytesseract.image_to_data(image, lang="eng", config=f"--oem 1 --psm {psm}", output_type=pytesseract.Output.DICT, timeout=15)
    except (pytesseract.TesseractNotFoundError, RuntimeError) as exc:
        raise OcrUnavailable(type(exc).__name__) from exc

    grouped: dict[tuple[int, int, int], list[_Word]] = {}
    for i, word in enumerate(data["text"]):
        word = word.strip()
        conf = float(data["conf"][i])
        if not word or conf < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        grouped.setdefault(key, []).append(_Word(word, conf, int(data["left"][i])))
    return [_Line(sorted(grouped[key], key=lambda w: w.left)) for key in sorted(grouped)]


# ---------- parsing ----------

# Labels may be preceded by OCR noise (e.g. edges of the photo box), so search, not match.
_LABELS = {
    "full_name": re.compile(r"(?:^|[^A-Za-z])(?:full\s*)?name\b[\s:.\-]*", re.I),
    "dob": re.compile(r"(?:^|[^A-Za-z])(?:dob|d\.o\.b\.?|date\s*of\s*birth|birth\s*date)\b[\s:.\-]*", re.I),
    "address": re.compile(r"(?:^|[^A-Za-z])(?:address|addr)\b[\s:.\-]*", re.I),
}
_ANY_LABEL = re.compile(
    r"(?:^|[^A-Za-z])(?:name|dob|date\s*of\s*birth|address|member|issued|expires|specimen)\b",
    re.I,
)
# Labels as OCR often misreads them ("aporess", "ADORESS"): the first word of a line within a small
# edit distance of the label counts. Only labels of 4+ letters, where a 1-2 letter slip can't turn
# one ordinary word into another; short labels like DOB rely on the exact pattern above.
_FUZZY_LABELS = {"full_name": ("name", 1), "address": ("address", 2)}
_FIRST_WORD = re.compile(r"^\W*([A-Za-z0-9]{3,9})\b[\s:.\-]*")


def _edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _label_end(name: str, text: str) -> int | None:
    """Where the value starts after this field's label on the line, or None if there's no label."""
    match = _LABELS[name].search(text)
    if match:
        return match.end()
    if name in _FUZZY_LABELS:
        label, max_distance = _FUZZY_LABELS[name]
        first = _FIRST_WORD.match(text)
        if first and _edit_distance(first.group(1).lower(), label) <= max_distance:
            return first.end()
    return None


_ID_NUMBER = re.compile(r"\b[A-Z]{1,4}-?\d{5,}\b")  # member / record numbers end an address block
_ISSUED = re.compile(r"\b(?:issued|expires|exp|iss)\b", re.I)
_DATE_SHAPE = re.compile(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}")


def _strip_noise_prefix(text: str) -> str:
    """Drop leading OCR junk tokens (punctuation, stray single letters) before real content."""
    tokens = text.split()
    while tokens and (not re.fullmatch(r"[A-Za-z0-9#][A-Za-z0-9#'.,\-]*", tokens[0]) or re.fullmatch(r"[a-z]", tokens[0])):
        tokens.pop(0)
    return " ".join(tokens)


_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def normalize_dob(raw: str) -> str | None:
    """Return an ISO date (YYYY-MM-DD) or None. Never invents missing parts."""
    s = raw.strip().replace("O", "0").replace("o", "0")
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", s)
        if m:
            mo, d, y = int(m[1]), int(m[2]), int(m[3])  # US order on our cards
        else:
            m = re.search(r"\b(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})\b", s)
            if not m or m[2][:3].lower() not in _MONTHS:
                return None
            d, mo, y = int(m[1]), _MONTHS[m[2][:3].lower()], int(m[3])
    try:
        parsed = date(y, mo, d)
    except ValueError:
        return None
    if not (1900 <= parsed.year <= date.today().year):
        return None
    return parsed.isoformat()


def _plausible_adult_dob(iso: str) -> bool:
    born = date.fromisoformat(iso)
    today = date.today()
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    return 18 <= age <= 120


def normalize_name(raw: str) -> str | None:
    cleaned = re.sub(r"[^A-Za-z' \-]", " ", raw)
    tokens = cleaned.split()
    while tokens and len(tokens[-1].strip("'-")) <= 1:  # trailing stray letters / dashes
        tokens.pop()
    cleaned = " ".join(tokens)
    if len(cleaned) < 3 or len(cleaned.split()) < 2:
        return None
    return cleaned.upper()


_STATE_ZIP_END = re.compile(r"\b[A-Z]{2},? \d{5}(?:-\d{4})?$")


def normalize_address(parts: list[str]) -> str | None:
    joined = ", ".join(p.strip(" ,") for p in parts if p.strip(" ,"))
    joined = re.sub(r"[^A-Za-z0-9#'.,\- ]", " ", joined)
    joined = re.sub(r"\s+", " ", joined).strip(" ,")
    if not re.search(r"\d", joined) or len(joined) < 8:
        return None
    # A US address ends in a state code and ZIP. Without them the read is truncated or garbled,
    # so leave the field blank for the user (or a later pass) rather than show a fragment.
    if not _STATE_ZIP_END.search(joined.upper()):
        return None
    return joined.upper()


def _value_start_x(line: _Line, char_offset: int) -> int | None:
    """x position of the first word that starts at or after char_offset in line.text."""
    pos = 0
    for word in line.words:
        if pos >= char_offset:
            return word.left
        pos += len(word.text) + 1
    return None


def parse_fields(lines: list[_Line]) -> dict[str, FieldResult]:
    results: dict[str, FieldResult] = {f: FieldResult(None, None, "missing") for f in FIELDS}
    for idx, line in enumerate(lines):
        for name in _LABELS:
            end = None if results[name].value else _label_end(name, line.text)
            if end is None:
                continue
            remainder = line.text[end:].strip()
            confs = [line.confidence]
            value_x = _value_start_x(line, end)
            # Value may sit on the line after its label.
            if not remainder and idx + 1 < len(lines) and not _ANY_LABEL.search(lines[idx + 1].text):
                remainder = lines[idx + 1].text
                confs.append(lines[idx + 1].confidence)
            if name == "full_name":
                value = normalize_name(remainder)
            elif name == "dob":
                value = normalize_dob(remainder)
            else:
                parts = [remainder]
                # Address continues on following lines until the next label.
                for nxt in lines[idx + 1 : idx + 3]:
                    if _ANY_LABEL.search(nxt.text) or nxt.text == remainder or _ID_NUMBER.search(nxt.text):
                        break
                    # Continuation lines are aligned under the value, so ignore anything left of it.
                    aligned = nxt.from_x(value_x - 40) if value_x is not None else nxt
                    parts.append(_strip_noise_prefix(aligned.text))
                    confs.append(aligned.confidence)
                value = normalize_address(parts)
            if value:
                conf = round(min(confs), 1)
                results[name] = FieldResult(value, conf, "found" if conf >= LOW_CONFIDENCE else "low_confidence")

    # The DOB label is short and often misread ("pos", "D0B"). If it wasn't found by label,
    # accept the one date on the card that isn't on an issued/expiry line, flagged for review.
    if not results["dob"].value:
        candidates = [
            (normalize_dob(m.group(0)), line.confidence)
            for line in lines
            if not _ISSUED.search(line.text)
            for m in [_DATE_SHAPE.search(line.text)]
            if m
        ]
        # Without a label we only trust a date that could be an adult's birth date
        # (the service is adults-only); this keeps issue/expiry dates out.
        candidates = [(v, c) for v, c in candidates if v and _plausible_adult_dob(v)]
        if len(candidates) == 1:
            results["dob"] = FieldResult(candidates[0][0], round(min(candidates[0][1], LOW_CONFIDENCE - 1), 1), "low_confidence")
    return results


def extract_fields(image: Image.Image) -> OcrResult:
    started = time.perf_counter()
    prepared = preprocess(image)
    fields = parse_fields(_ocr_lines(prepared, psm=4))
    notes = ["pass1:psm4"]
    # Second pass with a different page-segmentation mode, only when the first pass
    # left something missing or uncertain. It fills gaps; it never overrides a
    # confident first-pass value.
    passes = [("pass2:psm6", lambda: _ocr_lines(prepared, psm=6)), ("pass3:flat", lambda: _ocr_lines(preprocess_flat(image), psm=4))]
    for note, run in passes:
        if all(f.status == "found" for f in fields.values()):
            break
        notes.append(note)
        for name, alt in parse_fields(run()).items():
            cur = fields[name]
            if alt.value and (cur.value is None or (cur.status == "low_confidence" and (alt.confidence or 0) > (cur.confidence or 0))):
                fields[name] = alt
    return OcrResult(fields=fields, duration_ms=int((time.perf_counter() - started) * 1000), notes=notes)


def tesseract_version() -> str | None:
    try:
        pytesseract.pytesseract.tesseract_cmd = get_settings().tesseract_cmd
        return str(pytesseract.get_tesseract_version())
    except Exception:  # noqa: BLE001 - health reporting only
        return None
