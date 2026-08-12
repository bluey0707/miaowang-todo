from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
SCALE = 4
INDIGO = "#555cc8"
WHITE = "#ffffff"


def make_icon(size: int, path: Path, maskable: bool = False) -> None:
    canvas = size * SCALE
    shape_mask = Image.new("L", (canvas, canvas), 255 if maskable else 0)
    if not maskable:
        radius = int(size * 0.28 * SCALE)
        ImageDraw.Draw(shape_mask).rounded_rectangle((0, 0, canvas - 1, canvas - 1), radius=radius, fill=255)
    shape_mask = shape_mask.resize((size, size), Image.Resampling.LANCZOS)
    image = Image.new("RGBA", (size, size), INDIGO)
    image.putalpha(shape_mask)

    points = [(size * 0.281, size * 0.516), (size * 0.422, size * 0.656), (size * 0.734, size * 0.312)]
    check_mask = Image.new("L", (canvas, canvas), 0)
    draw = ImageDraw.Draw(check_mask)
    draw.line(
        [(int(x * SCALE), int(y * SCALE)) for x, y in points],
        fill=255,
        width=int(size * 0.109 * SCALE),
        joint="curve",
    )
    for x, y in (points[0], points[-1]):
        r = int(size * 0.0545 * SCALE)
        cx, cy = int(x * SCALE), int(y * SCALE)
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)

    check_mask = check_mask.resize((size, size), Image.Resampling.LANCZOS)
    check = Image.new("RGBA", (size, size), WHITE)
    check.putalpha(check_mask)
    Image.alpha_composite(image, check).save(path, optimize=True)


ICONS.mkdir(parents=True, exist_ok=True)
make_icon(192, ICONS / "icon-192.png")
make_icon(512, ICONS / "icon-512.png")
make_icon(512, ICONS / "icon-maskable-512.png", maskable=True)
make_icon(180, ICONS / "apple-touch-icon.png")
