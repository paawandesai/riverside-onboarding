"""Server-side validation of uploaded ID images.

Images are processed in memory only and never written to disk or the database.
EXIF (including GPS) is dropped by re-encoding pixels into a fresh image.
"""

import io
from dataclasses import dataclass

from pi_heif import register_heif_opener
from PIL import Image, ImageOps

# pi-heif is the decode-only build of pillow-heif: its wheels bundle libheif and libde265 (LGPL-3.0,
# loaded as shared libraries) and, unlike pillow-heif, no GPL-licensed HEVC encoder.
register_heif_opener()

# Pillow raises DecompressionBombError above 2x this; we reject anything above it ourselves.
MAX_PIXELS = 16_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
# A card photo is roughly 1.6:1. Very long or very thin images are rejected before decoding,
# because OCR upscales narrow images and a 100 x 400,000 strip would need gigabytes.
MAX_SIDE = 8000
MAX_ASPECT = 4.0
# Cleaned images are shrunk to this longest side; OCR needs far less, and memory scales with area.
WORK_SIDE = 2500

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF", "HEIC"}
# Magic-byte prefixes, checked before Pillow parses anything.
_MAGIC = (
    b"\xff\xd8\xff",  # JPEG
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"RIFF",  # WEBP (RIFF....WEBP)
)


class UploadRejected(Exception):
    """Raised with a message that is safe to show the user."""


@dataclass
class CleanImage:
    image: Image.Image
    source_format: str


def _looks_like_image(head: bytes) -> bool:
    if head.startswith(_MAGIC):
        return True
    # HEIF/HEIC: ISO-BMFF "ftyp" box at offset 4 with a heic/heif/mif1 brand.
    return head[4:8] == b"ftyp" and head[8:12] in {b"heic", b"heix", b"heif", b"mif1", b"msf1", b"hevc"}


def validate_and_clean(data: bytes, max_bytes: int) -> CleanImage:
    if not data:
        raise UploadRejected("The file is empty. Please choose a photo of your ID.")
    if len(data) > max_bytes:
        raise UploadRejected(f"The file is larger than {max_bytes // (1024 * 1024)} MB. Please upload a smaller photo.")
    if not _looks_like_image(data[:16]):
        raise UploadRejected("That file isn't a supported image. Please upload a JPEG, PNG, WEBP or HEIC photo.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = (probe.format or "").upper()
            if fmt not in ALLOWED_FORMATS:
                raise UploadRejected("That image format isn't supported. Please upload a JPEG, PNG, WEBP or HEIC photo.")
            width, height = probe.size
            if width * height > MAX_PIXELS or max(width, height) > MAX_SIDE:
                raise UploadRejected("That image is too large to process. Please upload a smaller photo.")
            if min(width, height) == 0 or max(width, height) / min(width, height) > MAX_ASPECT:
                raise UploadRejected("That image is an unusual shape. Please upload a photo of the whole ID card.")
            probe.verify()
        with Image.open(io.BytesIO(data)) as img:
            img.draft("RGB", (WORK_SIDE, WORK_SIDE))  # JPEG: decode at reduced scale when possible
            img.load()
            img = ImageOps.exif_transpose(img)  # honour camera rotation before discarding EXIF
            rgb = img.convert("RGB")
            rgb.thumbnail((WORK_SIDE, WORK_SIDE), Image.Resampling.LANCZOS)
    except UploadRejected:
        raise
    except MemoryError as exc:
        raise UploadRejected("That image is too large to process. Please upload a smaller photo.") from exc
    except Exception as exc:  # noqa: BLE001 - malformed files (odd EXIF, truncated data) must not become 500s
        raise UploadRejected("We couldn't read that image. It may be damaged. Please try another photo.") from exc

    # Copy pixels into a brand-new image so no metadata (EXIF, GPS, XMP, ICC) survives.
    clean = Image.new("RGB", rgb.size)
    clean.paste(rgb)
    return CleanImage(image=clean, source_format=fmt)
