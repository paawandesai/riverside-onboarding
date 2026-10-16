"""Server-side validation of uploaded ID images.

Images are processed in memory only and never written to disk or the database.
EXIF (including GPS) is dropped by re-encoding pixels into a fresh image.
"""

import io
from dataclasses import dataclass

import pillow_heif
from PIL import Image, ImageOps, UnidentifiedImageError

pillow_heif.register_heif_opener()

# Pillow raises DecompressionBombError above 2x this; we reject anything above it ourselves.
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

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
            if width * height > MAX_PIXELS:
                raise UploadRejected("That image is too large to process. Please upload a smaller photo.")
            probe.verify()
        with Image.open(io.BytesIO(data)) as img:
            img.load()
            img = ImageOps.exif_transpose(img)  # honour camera rotation before discarding EXIF
            rgb = img.convert("RGB")
    except UploadRejected:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise UploadRejected("We couldn't read that image. It may be damaged. Please try another photo.") from exc

    # Copy pixels into a brand-new image so no metadata (EXIF, GPS, XMP, ICC) survives.
    clean = Image.new("RGB", rgb.size)
    clean.paste(rgb)
    return CleanImage(image=clean, source_format=fmt)
