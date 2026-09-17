// Drive-level data, which Sleeper does not have.
//
// All 228 keys in Sleeper's box score describe a PLAYER on a PLAY — there is no drive,
// series, possession or field-position key anywhere in the payload. So "longest touchdown
// drive" cannot be computed from the six calls the rest of this report lives on. It needs
// play-by-play, and that means a second source: nflverse.
//
// Everything here is therefore best-effort and must never be load-bearing. The award that
// consumes it voids cleanly (compute.js `case 'drive'`) if this module throws, so a stale
// or missing nflverse release costs one fun card and nothing else. build.js --no-drives
// skips it entirely.
//
// Two joins had to be earned:
//
//   1. pbp identifies a passer by GSIS id (`00-0036442`). Sleeper keys on its own id. Sleeper's
//      player dictionary *has* a `gsis_id` field, and it is a trap — it is populated for only
//      153 of 474 QBs and covered just 12 of the 33 quarterbacks who threw a pass in 2025 wk1,
//      missing Burrow, Hurts, Herbert and Love. DynastyProcess's crosswalk hit 33/33, and all
//      33 resolved to a real row in that week's Sleeper stats payload. So: crosswalk, not gsis_id.
//
//   2. Drive length comes from `drive_start_yard_line` ("SF 5"), which is side-relative.
//      Read against `posteam` it gives yards-to-goal, and a drive that ended in a touchdown
//      covered exactly that. `yardline_100` on the drive's first play is NOT a substitute —
//      on a drive whose first row is the kickoff it describes the kick, not the possession.

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

import { cached } from './sleeper.js';

const PBP = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
const XWALK = 'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv';

const COLS = ['week', 'game_id', 'posteam', 'fixed_drive', 'fixed_drive_result',
  'drive_start_yard_line', 'drive_play_count', 'drive_time_of_possession',
  'drive_first_downs', 'passer_player_id', 'passer_player_name'];

/**
 * RFC4180 over a stream, because the play description column contains both commas and
 * escaped quotes — `cut -d,` and `split(',')` both corrupt the row. Yields only `want`,
 * since a full season is 98 MB across 400 columns and we need eleven of them.
 */
async function* csvRows(stream, want) {
  const dec = new TextDecoder();
  let row = [], field = '', inQ = false, pendingQuote = false, header = null, pick = null;

  const finish = () => {
    row.push(field); field = '';
    const done = row; row = [];
    if (!header) {
      header = done;
      pick = want.map((c) => header.indexOf(c));
      const missing = want.filter((c, i) => pick[i] < 0);
      if (missing.length) throw new Error(`pbp is missing columns: ${missing.join(', ')}`);
      return null;
    }
    const o = {};
    want.forEach((c, i) => { o[c] = done[pick[i]]; });
    return o;
  };

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        // A quote inside a quoted field may be the closer or the first half of an escaped
        // pair, and the pair can straddle a chunk boundary — hence the carried flag.
        if (pendingQuote) {
          pendingQuote = false;
          if (c === '"') { field += '"'; continue; }
          inQ = false;
        } else if (c === '"') { pendingQuote = true; continue; }
        else { field += c; continue; }
      }
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { const r = finish(); if (r) yield r; }
      else if (c !== '\r') field += c;
    }
  }
  if (field || row.length) { const r = finish(); if (r) yield r; }
}

// The pbp asset is a gzipped FILE, not a gzip-encoded response — GitHub serves it as opaque
// octets with no content-encoding, so fetch will not inflate it. It has to be done by hand.
async function stream(url, gz = false) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  if (!gz) return res.body;
  return Readable.fromWeb(res.body).pipe(createGunzip());
}

/** gsis_id -> sleeper player_id. 8k rows, ~2.6 MB, changes rarely; one day is plenty. */
export const crosswalk = (fresh) =>
  cached('xwalk-gsis-sleeper', fresh ? 0 : 24 * 3600e3, async () => {
    const map = {};
    const body = await stream(XWALK);
    for await (const r of csvRows(body, ['gsis_id', 'sleeper_id'])) {
      if (r.gsis_id && r.sleeper_id) map[r.gsis_id] = r.sleeper_id;
    }
    if (Object.keys(map).length < 3000) throw new Error('crosswalk looks truncated');
    return map;
  });

/**
 * "SF 5" with SF on offense is their own 5 — 95 to go. "SEA 5" is the opponent's — 5 to go.
 * Midfield is stored as a bare "50" with no side, which needs no disambiguating.
 *
 * Without a posteam the string is unreadable rather than ambiguous, so this returns null and
 * lets the caller retry on a later row of the same drive — guessing would flip a 12-yard
 * drive into an 88-yard one, which is exactly the kind of silent wrong answer that settles
 * a prize incorrectly.
 */
function yardsToGoal(startYardLine, posteam) {
  if (!startYardLine) return null;
  const parts = startYardLine.trim().split(/\s+/);
  const yd = Number(parts[parts.length - 1]);
  if (!Number.isFinite(yd) || yd < 0 || yd > 50) return null;
  if (parts.length === 1) return yd === 50 ? 50 : null;
  if (!posteam) return null;
  return parts[0] === posteam ? 100 - yd : yd;
}

/**
 * Every touchdown drive of one week, keyed by the Sleeper id of the quarterback who ran it.
 *
 * A drive is credited to whoever threw the most passes on it, which is a heuristic and is
 * documented as one: a drive with no pass attempt at all has no quarterback to credit
 * (2025 wk1 had a 91-yard Jacksonville touchdown drive that was entirely runs) and is
 * dropped rather than guessed at. Only each quarterback's single best drive is kept.
 */
export async function longestTdDrives(season, week, { fresh, final, games } = {}) {
  return cached(`drives-${season}-${week}`, fresh || !final ? 0 : Infinity, async () => {
    const xw = await crosswalk(fresh);
    const wk = String(week);
    const drives = new Map();

    for await (const r of csvRows(await stream(PBP(season), true), COLS)) {
      if (r.week !== wk) continue;
      const key = `${r.game_id}#${r.fixed_drive}`;
      let d = drives.get(key);
      // A drive's first row is usually the kickoff that set it up; nflfastR already assigns
      // that row's posteam to the RECEIVING team, so it is the right side to read against.
      if (!d) drives.set(key, (d = { game: r.game_id, team: r.posteam, passers: new Map() }));
      if (r.fixed_drive_result) d.result = r.fixed_drive_result;
      if (r.posteam && !d.team) d.team = r.posteam;
      // drive_start_yard_line repeats on every row of the drive, so a row that cannot be read
      // (no posteam yet) costs nothing — the next one resolves it.
      if (d.start === undefined) {
        const y = yardsToGoal(r.drive_start_yard_line, r.posteam || d.team);
        if (y !== null) d.start = y;
      }
      if (r.drive_play_count) d.plays = Number(r.drive_play_count);
      if (r.drive_time_of_possession) d.top = r.drive_time_of_possession;
      if (r.drive_first_downs) d.fd = Number(r.drive_first_downs);
      if (r.passer_player_id) {
        d.passers.set(r.passer_player_id,
          { n: (d.passers.get(r.passer_player_id)?.n || 0) + 1, name: r.passer_player_name });
      }
    }

    const byPid = {};
    let tdDrives = 0, unattributed = 0, unmapped = 0;
    for (const d of drives.values()) {
      if (d.result !== 'Touchdown' || !d.start) continue;
      tdDrives++;
      const lead = [...d.passers.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      if (!lead) { unattributed++; continue; }
      const pid = xw[lead[0]];
      if (!pid) { unmapped++; continue; }
      const row = { yards: d.start, plays: d.plays ?? null, top: d.top || null,
                    firstDowns: d.fd ?? null, team: d.team, game: d.game, qb: lead[1].name };
      if (!byPid[pid] || row.yards > byPid[pid].yards) byPid[pid] = row;
    }
    if (!tdDrives) throw new Error(`no touchdown drives found for ${season} week ${week}`);
    // An EMPTY release is obvious and already handled above. A PARTIAL one is the dangerous
    // shape: nflverse publishes on its own cadence, so a few hours after Monday night the file
    // holds fifteen of the week's sixteen games and every count above still looks healthy.
    // The award would then be decided off whichever drives happened to have landed, and say so
    // nowhere. If the caller tells us how many games the week really had, insist on all of them.
    const present = new Set([...drives.values()].filter((x) => x.game).map((x) => x.game)).size;
    if (games && present < games) {
      throw new Error(`play-by-play has ${present} of ${games} games for ${season} week ${week}`);
    }
    return { byPid, tdDrives, unattributed, unmapped, games: present, qbs: Object.keys(byPid).length };
  });
}
