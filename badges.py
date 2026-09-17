#!/usr/bin/env python3
"""Shrink the badge art to something a page can actually load.

    python3 badges.py            ->  output/badges/web/<award id>.webp

The originals in output/badges/images are 1254px PNGs, ~1MB each. A week page shows
thirty of them, so at full size the badges alone would outweigh the rest of the site by
an order of magnitude. These are flat, vector-like illustrations, so they survive a hard
downscale: a 384px WebP lands around 25KB and still reads cleanly at 3x on a phone.

The output is COMMITTED, not built on deploy. Vercel's build box runs `node site.js` on
Linux with no Pillow, and the art itself is not reproducible (see the commit that added
it), so the shrunk set has to travel with the repository the same way the originals do.
Re-run this only when the art changes.
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent
CATALOG = ROOT / "output" / "badges" / "catalog.json"
OUT = ROOT / "output" / "badges" / "web"

# The badges were doubled on 2026-09-14; the biggest any page now draws is the 116px prize
# row, so 384 keeps it sharp on a 3x screen. Quality 84 is where the flat fills stop gaining
# anything visible from more bytes.
SIZE = 384
QUALITY = 84


def main():
    catalog = json.loads(CATALOG.read_text())
    OUT.mkdir(parents=True, exist_ok=True)

    total = 0
    for entry in catalog:
        src = CATALOG.parent / entry["file"]
        if not src.exists():
            sys.exit(f"missing art for {entry['id']}: {src}")
        im = Image.open(src).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
        dst = OUT / f"{entry['id']}.webp"
        im.save(dst, "WEBP", quality=QUALITY, method=6)
        total += dst.stat().st_size

    print(f"{len(catalog)} badges -> {OUT}/  ({total / 1024:.0f} KB total, "
          f"{total / len(catalog) / 1024:.1f} KB each)")


if __name__ == "__main__":
    main()
