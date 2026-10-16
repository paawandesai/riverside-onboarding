"""Generate the synthetic OCR golden set: 30 fictional SPECIMEN patient ID cards.

Rules this script follows (see README "Synthetic ID set"):
  * fictional issuer and template, never a real government document layout
  * a SPECIMEN watermark on every card, silhouette faces, no seals, no barcodes
  * names and addresses are composed from made-up parts below; any resemblance to
    a real person is coincidental
  * no model is involved: cards are drawn with Pillow

Output: fixtures/generated-ids/<id>.png and fixtures/generated-ids/labels.json
Categories: clean scans, phone photos (perspective, noise, blur, uneven light),
skew/glare, and a few deliberately hard cases.

Usage: python scripts/generate_specimen_ids.py [--out fixtures/generated-ids] [--seed N]
"""

import argparse
import json
import random
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

FONT_DIR = Path("/usr/share/fonts/truetype")
FONTS = {
    "sans": FONT_DIR / "dejavu/DejaVuSans.ttf",
    "sans_bold": FONT_DIR / "dejavu/DejaVuSans-Bold.ttf",
    "liberation": FONT_DIR / "liberation/LiberationSans-Regular.ttf",
    "liberation_bold": FONT_DIR / "liberation/LiberationSans-Bold.ttf",
}

FIRST = ["AVERY", "JORDAN", "MORGAN", "CASEY", "RILEY", "QUINN", "ROWAN", "SAGE", "HARPER", "EMERSON",
         "FINLEY", "ELLIS", "DAKOTA", "MARLOWE", "REESE", "TATUM", "LENNON", "BLAIR", "SKYLER", "PEYTON"]
LAST = ["ASHWORTH", "BRAMBLE", "CALLOWAY", "DUNMORE", "ELLSWORTH", "FAIRBANK", "GALLOWAY", "HOLLOWAY",
        "IVERSEN", "KESTREL", "LANGLEY", "MERRIWEATHER", "NORCROSS", "OAKHURST", "PEMBERTON", "QUILLON",
        "RADCLIFFE", "STANWICK", "THORNBURY", "WAVERLY"]
STREETS = ["MAPLE GROVE RD", "LANTERN WAY", "OTTER CREEK LN", "BIRCHWOOD AVE", "CEDAR HOLLOW DR",
           "MILLBROOK ST", "QUARRY RIDGE CT", "WILLOW BEND BLVD", "FOXGLOVE PL", "HERON POINT RD"]
TOWNS = [("BRAMBLETON", "OH", "44"), ("FENWICK FALLS", "PA", "15"), ("LAKEMERE", "MI", "49"),
         ("SUTTON GROVE", "IN", "46"), ("WESTBURY PINES", "WI", "53")]
ISSUER = "MAPLE GROVE COMMUNITY HEALTH"
CARD_W, CARD_H = 1012, 638  # ~CR80 aspect ratio


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS[name]), size)


def make_person(rng: random.Random) -> dict:
    dob = date(1950, 1, 1) + timedelta(days=rng.randint(0, 365 * 55))
    town, state, zip_prefix = rng.choice(TOWNS)
    return {
        "full_name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
        "dob": dob.isoformat(),
        "line1": f"{rng.randint(12, 9890)} {rng.choice(STREETS)}",
        "line2": f"{town} {state} {zip_prefix}{rng.randint(100, 999)}",
        "member": f"MG-{rng.randint(100000, 999999)}",
    }


def dob_print(iso: str, style: int) -> str:
    y, m, d = iso.split("-")
    months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    if style == 0:
        return f"{m}/{d}/{y}"
    if style == 1:
        return f"{int(d):02d} {months[int(m) - 1]} {y}"
    return iso


def draw_card(person: dict, rng: random.Random) -> Image.Image:
    family = rng.choice(["sans", "liberation"])
    card = Image.new("RGB", (CARD_W, CARD_H), (247, 248, 250))
    d = ImageDraw.Draw(card)
    # header band
    band = rng.choice([(28, 92, 138), (40, 110, 90), (90, 70, 140)])
    d.rectangle([0, 0, CARD_W, 110], fill=band)
    d.text((36, 22), ISSUER, font=font(family + "_bold", 36), fill="white")
    d.text((36, 68), "PATIENT IDENTIFICATION CARD  -  FICTIONAL SPECIMEN", font=font(family, 22), fill="white")
    # silhouette photo box
    px, py = 40, 150
    d.rectangle([px, py, px + 230, py + 290], fill=(214, 220, 228), outline=(160, 168, 180), width=2)
    d.ellipse([px + 70, py + 40, px + 160, py + 135], fill=(150, 158, 170))
    d.pieslice([px + 30, py + 140, px + 200, py + 330], 180, 360, fill=(150, 158, 170))
    # fields
    label_font, value_font = font(family + "_bold", 24), font(family, 34)
    x, y = 310, 150
    rows = [("NAME", person["full_name"]), ("DOB", dob_print(person["dob"], rng.randint(0, 2)))]
    for label, value in rows:
        d.text((x, y), label, font=label_font, fill=(90, 96, 110))
        d.text((x + 120, y - 6), value, font=value_font, fill=(20, 22, 28))
        y += 64
    d.text((x, y), "ADDRESS", font=label_font, fill=(90, 96, 110))
    d.text((x + 150, y - 6), person["line1"], font=value_font, fill=(20, 22, 28))
    d.text((x + 150, y + 40), person["line2"], font=value_font, fill=(20, 22, 28))
    y += 120
    d.text((x, y), f"MEMBER NO  {person['member']}", font=font(family, 24), fill=(70, 76, 90))
    d.text((x, y + 40), "ISSUED  2026-01-15", font=font(family, 24), fill=(70, 76, 90))
    # SPECIMEN watermark, semi-transparent and diagonal
    mark = Image.new("RGBA", card.size, (0, 0, 0, 0))
    md = ImageDraw.Draw(mark)
    md.text((150, 220), "SPECIMEN", font=font("sans_bold", 150), fill=(200, 40, 40, 70))
    mark = mark.rotate(18, resample=Image.Resampling.BICUBIC)
    card = Image.alpha_composite(card.convert("RGBA"), mark).convert("RGB")
    return card


def on_background(card: Image.Image, rng: random.Random, margin: int = 120) -> Image.Image:
    bg_color = rng.choice([(70, 60, 50), (120, 110, 95), (40, 45, 55), (180, 175, 165)])
    bg = Image.new("RGB", (card.width + 2 * margin, card.height + 2 * margin), bg_color)
    bg.paste(card, (margin, margin))
    return bg


def perspective(img: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    w, h = img.size
    j = lambda: rng.uniform(0, strength) * w  # noqa: E731
    quad = (j(), j(), j(), h - j(), w - j(), h - j(), w - j(), j())
    return img.transform((w, h), Image.Transform.QUAD, quad, resample=Image.Resampling.BICUBIC)


def uneven_light(img: Image.Image, rng: random.Random) -> Image.Image:
    w, h = img.size
    grad = Image.linear_gradient("L").resize((w, h)).rotate(rng.choice([0, 90, 180, 270]), expand=False)
    shade = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(img, shade, grad.point(lambda v: 150 + v * 105 // 255))


def noise(img: Image.Image, rng: random.Random, amount: int) -> Image.Image:
    import numpy as np

    arr = np.asarray(img).astype("int16")
    gen = np.random.default_rng(rng.randint(0, 2**31))
    arr = arr + gen.normal(0, amount, arr.shape).astype("int16")
    return Image.fromarray(arr.clip(0, 255).astype("uint8"))


def glare(img: Image.Image, rng: random.Random, intensity: int) -> Image.Image:
    w, h = img.size
    layer = Image.new("L", (w, h), 0)
    ld = ImageDraw.Draw(layer)
    cx, cy = rng.randint(w // 4, 3 * w // 4), rng.randint(h // 4, 3 * h // 4)
    rx, ry = rng.randint(w // 8, w // 5), rng.randint(h // 10, h // 6)
    ld.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=intensity)
    layer = layer.filter(ImageFilter.GaussianBlur(40))
    white = Image.new("RGB", (w, h), (255, 255, 255))
    return Image.composite(white, img, layer)


def jpeg_roundtrip(img: Image.Image, quality: int) -> Image.Image:
    import io

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def variant(card: Image.Image, category: str, rng: random.Random) -> Image.Image:
    if category == "clean_scan":
        return jpeg_roundtrip(card, 92)
    if category == "phone_photo":
        img = on_background(card, rng)
        img = perspective(img, rng, 0.035)
        img = uneven_light(img, rng)
        img = noise(img, rng, 8)
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.6, 1.2)))
        img = img.resize((int(img.width * 0.8), int(img.height * 0.8)))
        return jpeg_roundtrip(img, 80)
    if category == "skew_glare":
        img = on_background(card, rng, margin=80)
        img = img.rotate(rng.choice([-1, 1]) * rng.uniform(2, 7), resample=Image.Resampling.BICUBIC,
                         expand=True, fillcolor=(90, 85, 80))
        img = glare(img, rng, rng.randint(90, 150))
        return jpeg_roundtrip(img, 85)
    # hard: heavier blur, low contrast, small resolution, stronger glare
    img = on_background(card, rng, margin=60)
    img = img.rotate(rng.uniform(-9, 9), resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(60, 60, 60))
    img = ImageEnhance.Contrast(img).enhance(0.55)
    img = glare(img, rng, 190)
    img = img.filter(ImageFilter.GaussianBlur(1.8))
    img = img.resize((int(img.width * 0.55), int(img.height * 0.55)))
    return jpeg_roundtrip(img, 65)


PLAN = ["clean_scan"] * 10 + ["phone_photo"] * 10 + ["skew_glare"] * 7 + ["hard"] * 3


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="fixtures/generated-ids")
    # The default seed builds the golden set. A different seed builds a holdout set the
    # OCR rules were never tuned on (fixtures/generated-ids-holdout, seed 7).
    parser.add_argument("--seed", type=int, default=20261016)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)  # fixed so the committed set is reproducible
    labels = []
    for i, category in enumerate(PLAN, 1):
        person = make_person(rng)
        card = draw_card(person, rng)
        img = variant(card, category, rng)
        name = f"specimen-{i:02d}.jpg"
        img.save(out / name, "JPEG", quality=90)
        labels.append({
            "file": name,
            "category": category,
            "expected": {
                "full_name": person["full_name"],
                "dob": person["dob"],
                "address": f"{person['line1']}, {person['line2']}",
            },
        })
    (out / "labels.json").write_text(json.dumps({
        "description": "Generated synthetic SPECIMEN cards. Fictional people, issuer and template. Not provided by the brief.",
        "items": labels,
    }, indent=2))
    print(f"wrote {len(labels)} cards to {out}")


if __name__ == "__main__":
    main()
