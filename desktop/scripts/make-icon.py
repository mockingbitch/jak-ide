#!/usr/bin/env python3
"""Generate the JakIDE app icon with PIL, supersampled for smooth edges.

Usage: python3 make-icon.py <assets-dir>
Writes <assets-dir>/icon.png (1024x1024 master) and a hicolor size set in
<assets-dir>/icons/<n>x<n>.png that electron-builder installs into the deb.
"""
import os
import sys
from PIL import Image, ImageDraw

SS = 4                      # supersample factor
MASTER = 1024
S = MASTER * SS             # working resolution
SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]


def render():
    # background: rounded-rect with a top->bottom violet->blue gradient
    c1, c2 = (124, 58, 237), (37, 99, 235)      # #7c3aed -> #2563eb
    grad = Image.new("RGB", (S, S), c1)
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        gd.line([(0, y), (S, y)], fill=(
            round(c1[0] + (c2[0] - c1[0]) * t),
            round(c1[1] + (c2[1] - c1[1]) * t),
            round(c1[2] + (c2[2] - c1[2]) * t),
        ))

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)

    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(icon)

    # glyph "</>" in white, thick strokes with rounded caps/joints
    cx = cy = S / 2
    gw, ah, lw = S * 0.30, S * 0.155, int(S * 0.052)
    WHITE = (255, 255, 255, 255)

    def stroke(points):
        d.line(points, fill=WHITE, width=lw, joint="curve")
        r = lw / 2 - 1
        for x, y in points:
            d.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)

    stroke([(cx - gw * 0.46, cy - ah), (cx - gw, cy), (cx - gw * 0.46, cy + ah)])   # "<"
    stroke([(cx + gw * 0.46, cy - ah), (cx + gw, cy), (cx + gw * 0.46, cy + ah)])   # ">"
    stroke([(cx - gw * 0.15, cy + ah * 1.18), (cx + gw * 0.15, cy - ah * 1.18)])    # "/"

    # small AI "spark" (4-point star) top-right
    sx, sy, sr, sw = cx + gw * 0.66, cy - ah * 1.72, S * 0.052, S * 0.017
    d.polygon(
        [(sx, sy - sr), (sx + sw, sy - sw), (sx + sr, sy), (sx + sw, sy + sw),
         (sx, sy + sr), (sx - sw, sy + sw), (sx - sr, sy), (sx - sw, sy - sw)],
        fill=(255, 255, 255, 235),
    )
    return icon


def main():
    assets = sys.argv[1] if len(sys.argv) > 1 else "assets"
    icons_dir = os.path.join(assets, "icons")
    os.makedirs(icons_dir, exist_ok=True)
    base = render()
    base.resize((MASTER, MASTER), Image.LANCZOS).save(os.path.join(assets, "icon.png"))
    for n in SIZES:
        base.resize((n, n), Image.LANCZOS).save(os.path.join(icons_dir, f"{n}x{n}.png"))
    print("wrote", os.path.join(assets, "icon.png"), "and", len(SIZES), "sizes in", icons_dir)


if __name__ == "__main__":
    main()
