#!/usr/bin/env python3
"""Turn the frames scripts/screenshots.mjs wrote into docs/img/spin.gif, and shrink the stills.

    python3 scripts/gif.py [docs/img]

Needs Pillow. The GIF keeps the real timing between frames, is cropped to the wheel, scaled to 500px wide
and quantised to 40 colours, which keeps a dark, flat page under a couple of megabytes. Stills become
WebP at 1600px, a tenth the size of the PNGs; the PNGs and the frames are deleted.
"""
import json, sys
from pathlib import Path
from PIL import Image

out = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/img")
frames_dir = out / "frames"
stamps = json.loads((frames_dir / "stamps.json").read_text())
paths = sorted(frames_dir.glob("[0-9]*.png"))
W, CROP_H, COLORS, MAX_MS = 500, 840, 40, 9000   # the wheel and its card, not the board under it; stop once it has landed
paths = [p for i, p in enumerate(paths) if stamps[i] <= MAX_MS]
frames, durations = [], []
for i, p in enumerate(paths):
    im = Image.open(p).convert("RGB")
    im = im.crop((0, 0, im.width, min(CROP_H, im.height)))
    im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    frames.append(im.quantize(colors=COLORS, method=Image.MEDIANCUT, dither=Image.Dither.NONE))
    nxt = stamps[i + 1] if i + 1 < len(stamps) else stamps[i] + 2500   # hold the last frame
    durations.append(max(40, nxt - stamps[i]))
durations[0] = 900                                                     # a beat before the spin
frames[0].save(out / "spin.gif", save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f"spin.gif: {len(frames)} frames, {(out / 'spin.gif').stat().st_size / 1e6:.1f} MB")

for p in sorted(out.glob("*.png")):
    im = Image.open(p).convert("RGB")
    if im.width > 1600:
        im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    dst = p.with_suffix(".webp")
    im.save(dst, "WEBP", quality=86, method=6)
    print(f"{dst.name}: {dst.stat().st_size / 1024:.0f} KB")
    p.unlink()
for p in frames_dir.iterdir():
    p.unlink()
frames_dir.rmdir()
