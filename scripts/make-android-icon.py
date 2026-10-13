"""Android launcher icons from the desktop icon (src-tauri/icons/icon.png).

Adaptive icon (API 26+): background = the tile's blue diagonal gradient,
foreground = its white glyph, scaled so glyph:tile matches the Windows icon
once the launcher masks the 108dp canvas to its shape. Legacy PNGs are the
desktop icon as-is.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops

SRC = Path(sys.argv[1])  # icon.png
RES = Path(sys.argv[2])  # .../app/src/main/res

TL = (7, 47, 105)  # sampled from the tile's corners
BR = (16, 104, 232)
CANVAS = 432  # 108dp at xxxhdpi
VISIBLE = 72 / 108  # roughly what a launcher mask leaves of the canvas

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

src = Image.open(SRC).convert("RGBA")

# Diagonal gradient, rendered small and upscaled (smooth and fast).
g = Image.new("RGB", (64, 64))
for y in range(64):
    for x in range(64):
        t = (x + y) / 126
        g.putpixel((x, y), tuple(round(a + (b - a) * t) for a, b in zip(TL, BR)))
background = g.resize((CANVAS, CANVAS), Image.BICUBIC)

# White glyph: whiteness is how far the red channel rises above the tile's
# (red stays under ~30 on the blue); the faint wave lines fall under the cut.
r = src.getchannel("R").point(lambda v: max(0, min(255, round((v - 40) * 255 / (255 - 40)))))
alpha = ImageChops.multiply(r, src.getchannel("A"))
glyph = Image.new("RGBA", src.size, (255, 255, 255, 0))
glyph.putalpha(alpha)

tile = round(CANVAS * VISIBLE)
foreground = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
off = (CANVAS - tile) // 2
foreground.paste(glyph.resize((tile, tile), Image.LANCZOS), (off, off))

# Keep the tile's wave lines: the real tile with the glyph (grown a few px
# to swallow its anti-aliased edge) filled from the gradient, laid over the
# gradient so the area outside the tile's rounded corners matches too.
from PIL import ImageFilter
hole = alpha.point(lambda v: 255 if v > 8 else 0).filter(ImageFilter.MaxFilter(9))
grad_src = background.resize(src.size, Image.BICUBIC).convert("RGBA")
tile_bg = Image.composite(grad_src, src, hole)
tile_bg.putalpha(src.getchannel("A"))
background = background.convert("RGBA")
background.alpha_composite(tile_bg.resize((tile, tile), Image.LANCZOS), (off, off))
background = background.convert("RGB")

for name, k in DENSITIES.items():
    d = RES / f"mipmap-{name}"
    d.mkdir(exist_ok=True)
    n = round(108 * k)
    background.resize((n, n), Image.LANCZOS).save(d / "ic_launcher_background.png", optimize=True)
    foreground.resize((n, n), Image.LANCZOS).save(d / "ic_launcher_foreground.png", optimize=True)
    legacy = src.resize((round(48 * k),) * 2, Image.LANCZOS)
    legacy.save(d / "ic_launcher.png", optimize=True)
    legacy.save(d / "ic_launcher_round.png", optimize=True)

adaptive = """<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from src-tauri/icons/icon.png; see BUILDING.md (Android). -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
any_dpi = RES / "mipmap-anydpi-v26"
any_dpi.mkdir(exist_ok=True)
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    (any_dpi / name).write_text(adaptive)

# Preview: the xxxhdpi layers composited and masked as a squircle-ish shape.
prev = background.convert("RGBA")
prev.alpha_composite(foreground)
inset = (CANVAS - tile) // 2
prev = prev.crop((inset, inset, inset + tile, inset + tile))
mask = Image.new("L", prev.size, 0)
from PIL import ImageDraw
ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile - 1, tile - 1), radius=tile // 4, fill=255)
prev.putalpha(mask)
side = Image.new("RGBA", (tile * 2 + 20, tile), (40, 40, 40, 255))
side.alpha_composite(src.resize((tile, tile), Image.LANCZOS), (0, 0))
side.alpha_composite(prev, (tile + 20, 0))
side.save(sys.argv[3])
print("ok")
