"""Photo and proof uploads: any image type up to 8 MB (and PDF where allowed).

Phone and camera formats that browsers cannot show (HEIC/HEIF, TIFF, BMP, ICO, PSD, …) are converted to JPEG so every
photo displays in the dashboard. The file is checked by its content, not its name, so a renamed file cannot slip through.
"""
import io
import uuid

from PIL import Image, ImageOps, UnidentifiedImageError

try:  # iPhone/Android HEIC & HEIF photos
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:  # pragma: no cover – optional; HEIC is then reported as unsupported
    pillow_heif = None

from db import DATA

MAX_BYTES = 8 * 1024 * 1024
KEEP = {'JPEG': '.jpg', 'PNG': '.png', 'WEBP': '.webp', 'GIF': '.gif', 'AVIF': '.avif'}  # shown by browsers as they are


class BadFile(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def store(content: bytes, filename: str = '', allow_pdf: bool = False) -> str:
    """Validate and save an upload; returns the stored file name."""
    if not content:
        raise BadFile(400, 'The file is empty.')
    if len(content) > MAX_BYTES:
        raise BadFile(413, f'The file is {len(content) / 1024 / 1024:.1f} MB – the limit is 8 MB. Use a smaller photo or lower the camera resolution.')
    if content[:5] == b'%PDF-':
        if not allow_pdf:
            raise BadFile(400, 'Please attach a photo (any image type), not a PDF.')
        return _write(content, '.pdf')
    head = content[:512].lstrip().lower()
    if head.startswith(b'<svg') or head.startswith(b'<?xml') and b'<svg' in content[:2048].lower():
        raise BadFile(400, 'SVG drawings are not accepted – export it as PNG or JPG first.')
    try:
        with Image.open(io.BytesIO(content)) as probe:
            probe.verify()
        im = Image.open(io.BytesIO(content))
        fmt = (im.format or '').upper()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError) as e:
        hint = ' HEIC support is missing – run Nexora.bat → 3.' if filename.lower().endswith(('.heic', '.heif')) and pillow_heif is None else ''
        raise BadFile(400, f'This file is not a readable image ({type(e).__name__}).{hint} Allowed: any photo or picture file up to 8 MB' + (' or a PDF.' if allow_pdf else '.'))
    if fmt in KEEP:
        return _write(content, KEEP[fmt])
    # Convert everything else to a high-quality JPEG, keeping the photo's orientation.
    im = ImageOps.exif_transpose(im)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel('A'))
        im = bg
    elif im.mode != 'RGB':
        im = im.convert('RGB')
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=88, optimize=True)
    return _write(out.getvalue(), '.jpg')


def _write(content, ext):
    name = f'{uuid.uuid4().hex}{ext}'
    (DATA / 'uploads' / name).write_bytes(content)
    return name
