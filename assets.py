#!/usr/bin/env python3
"""Fetch and inline Sleeper's player headshots, team logos and league avatars.

The Artifact CSP blocks every external image host, so anything shown on the published
page has to travel with it as a data URI. This trims each asset hard: headshots get
their flat NFL backdrop keyed out, a circular crop, and a resize to 132px.

    python3 assets.py --season 2026 --week 1 --league <id>   ->  assets.json
"""
import argparse, base64, io, json, sys, urllib.request
from collections import deque
from PIL import Image, ImageDraw

CDN = "https://sleepercdn.com"
# Sleeper's stock avatar — the purple robot — shown for a manager who never set a team
# picture. Their app does the same, so a pictureless team looks the way it looks in Sleeper.
DEFAULT_AVATAR = f"{CDN}/images/v3/avatars/avatar_default_purple.webp"
UA = {"User-Agent": "Mozilla/5.0"}


def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            return r.read()
    except Exception:
        return None


def api(url):
    raw = fetch(url)
    return json.loads(raw) if raw else None


def key_background(im, tol=34):
    """Flood the flat studio backdrop from the edges out to transparent."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = px[1, 1][:3]
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        r, g, b, _ = px[x, y]
        if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > tol:
            continue
        seen[y * w + x] = 1
        px[x, y] = (r, g, b, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def circle_crop(im, size=104, bias=0.12):
    w, h = im.size
    side = min(w, h)
    # Headshots frame the subject high, so they crop upward toward the face (bias 0.12).
    # A team picture has no such convention and crops from the middle (bias 0.5).
    left = (w - side) // 2
    top = max(0, int((h - side) * bias))
    im = im.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def to_uri(im):
    """WebP keeps the alpha channel and runs ~4.5x smaller than optimised PNG at this size,
    which matters when ~120 faces all have to travel inside the page."""
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=72, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True)
    ap.add_argument("--week", required=True)
    ap.add_argument("--league", required=True)
    ap.add_argument("--out", default="assets.json")
    ap.add_argument("--size", type=int, default=104)
    a = ap.parse_args()

    matchups = api(f"https://api.sleeper.app/v1/league/{a.league}/matchups/{a.week}") or []
    stat_rows = api(f"https://api.sleeper.com/stats/nfl/{a.season}/{a.week}?season_type=regular") or []
    users = api(f"https://api.sleeper.app/v1/league/{a.league}/users") or []

    played = {r["player_id"]: r for r in stat_rows if r.get("stats")}
    starters = {p for m in matchups for p in (m.get("starters") or []) if p and p != "0"}
    want = sorted(starters & set(played))
    print(f"{len(starters)} starters, {len(want)} of them played", file=sys.stderr)

    players, teams, avatars = {}, {}, {}

    for pid in want:
        # Team defenses are keyed by bare abbreviation and have a logo, not a headshot.
        if pid.isalpha():
            continue
        raw = fetch(f"{CDN}/content/nfl/players/{pid}.jpg")
        if not raw:
            continue
        try:
            im = Image.open(io.BytesIO(raw))
            players[pid] = to_uri(circle_crop(key_background(im), a.size))
        except Exception as e:
            print(f"  skip {pid}: {e}", file=sys.stderr)

    involved = {r.get("team") for r in stat_rows if r.get("stats") and r.get("team")}
    involved |= {r.get("opponent") for r in stat_rows if r.get("stats") and r.get("opponent")}
    for t in sorted(x for x in involved if x):
        raw = fetch(f"{CDN}/images/team_logos/nfl/{t.lower()}.png")
        if not raw:
            continue
        try:
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            im.thumbnail((88, 88), Image.LANCZOS)
            teams[t] = to_uri(im)
        except Exception as e:
            print(f"  skip logo {t}: {e}", file=sys.stderr)

    # The team picture and the account avatar are different things, and only the first one
    # belongs on this page. metadata.avatar is the picture a manager set for THIS league and
    # arrives as a full URL; u["avatar"] is their account picture, the same in every league
    # they play in and very often one of Sleeper's stock defaults — three pairs of managers
    # here share one. Falling back to it would print the same face on two different teams,
    # so a manager with no team picture gets Sleeper's default robot instead.
    for u in users:
        url = (u.get("metadata") or {}).get("avatar") or DEFAULT_AVATAR
        raw = fetch(url) or fetch(DEFAULT_AVATAR)
        if not raw:
            continue
        try:
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            avatars[u["user_id"]] = to_uri(circle_crop(im, 96, bias=0.5))
        except Exception as e:
            print(f"  skip avatar {u.get('display_name')}: {e}", file=sys.stderr)

    # Stamp what this file was built from. It is gitignored and lives at a fixed path, so a
    # backfill of an older season overwrites the current one's copy, and team pictures belong
    # to a league — build.js reads this stamp and refuses avatars from the wrong one rather
    # than printing a departed manager's face on this season's roll call.
    out = {"built": {"season": str(a.season), "week": int(a.week), "league": str(a.league)},
           "players": players, "teams": teams, "avatars": avatars}
    with open(a.out, "w") as f:
        json.dump(out, f)
    kb = sum(len(v) for d in (players, teams, avatars) for v in d.values()) / 1024
    print(f"{len(players)} headshots, {len(teams)} logos, {len(avatars)} avatars -> {a.out} ({kb:.0f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
