// Sleeper API client. Read-only, unauthenticated.
//
// Two hosts are in play and they are not interchangeable:
//   api.sleeper.app — the documented league endpoints (league, rosters, users, matchups)
//   api.sleeper.com — the undocumented stats/projections/schedule endpoints, whose rows
//                     embed player metadata and the team a player was on THAT WEEK
//
// The .com host rejects some default user agents, so every request sends a browser UA.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const APP = 'https://api.sleeper.app/v1';
const COM = 'https://api.sleeper.com';
const CACHE = '.cache';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Exported because drives.js caches a second source on exactly these terms.
export async function cached(key, ttlMs, fn) {
  const path = join(CACHE, `${key}.json`);
  if (ttlMs !== 0) {
    try {
      const raw = await readFile(path, 'utf8');
      const { at, data } = JSON.parse(raw);
      if (ttlMs === Infinity || Date.now() - at < ttlMs) return data;
    } catch {}
  }
  const data = await fn();
  // ttl 0 means this payload is still moving (an unfinished week). Never persist it, or a
  // later run that IS allowed to cache would read this provisional copy back as final.
  if (ttlMs !== 0) {
    await mkdir(CACHE, { recursive: true });
    await writeFile(path, JSON.stringify({ at: Date.now(), data }));
  }
  return data;
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

export const state = () => get(`${APP}/state/nfl`);

export const league = (id) => get(`${APP}/league/${id}`);
export const users = (id) => get(`${APP}/league/${id}/users`);
export const rosters = (id) => get(`${APP}/league/${id}/rosters`);

// A FINISHED week is immutable and caches forever (PLAN.md §3). An unfinished one is still
// moving, so it must never be cached — otherwise a provisional run poisons the final one.
export const matchups = (id, week, { fresh, final } = {}) =>
  cached(`matchups-${id}-${week}`, fresh || !final ? 0 : Infinity, () =>
    get(`${APP}/league/${id}/matchups/${week}`));

export const schedule = (season, fresh) =>
  cached(`schedule-${season}`, fresh ? 0 : 6 * 3600e3, () => get(`${COM}/schedule/nfl/regular/${season}`));

// Rows, not a dict: [{player_id, team, opponent, game_id, player:{...}, stats:{...}}]
// `team` is the team the player was on THAT WEEK, which /v1/players/nfl cannot tell you.
export const stats = (season, week, { fresh, final } = {}) =>
  cached(`stats-${season}-${week}`, fresh || !final ? 0 : Infinity, () =>
    get(`${COM}/stats/nfl/${season}/${week}?season_type=regular`));

export const projections = (season, week, { fresh, final } = {}) =>
  cached(`proj-${season}-${week}`, fresh || !final ? 0 : Infinity, () =>
    get(`${COM}/projections/nfl/${season}/${week}?season_type=regular`));

// 14MB uncompressed. Sleeper asks that this be called at most once a day; we cache for one.
// Needed only for fantasy_positions on benched players who recorded no stat line.
export const players = (fresh) =>
  cached('players', fresh ? 0 : 24 * 3600e3, () => get(`${APP}/players/nfl`));

// Kickoff times, which Sleeper's schedule does not carry — it has a date per game and nothing
// finer, so it cannot tell a 1:00 game from the Sunday night one. nflverse's schedule can, and
// that is the only thing it is asked for: the race under the wheel lands each starter's line in
// the window his game was actually played in. Best-effort like drives.js — if this is missing
// the week still builds and the race runs on game days alone.
const GAMES_CSV = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
// nflverse spells the Rams LA; Sleeper says LAR.
const NFLVERSE_TEAM = { LA: 'LAR' };

// Just enough CSV to be safe: the stadium column at the end carries quoted commas.
function csvLine(line) {
  const out = []; let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out;
}

export const kickoffs = (season, fresh) =>
  cached(`kickoffs-${season}`, fresh ? 0 : 6 * 3600e3, async () => {
    const res = await fetch(GAMES_CSV, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`GET ${GAMES_CSV} -> HTTP ${res.status}`);
    const lines = (await res.text()).split('\n');
    const head = csvLine(lines[0]);
    const col = (n) => head.indexOf(n);
    const [cS, cT, cW, cD, cWd, cTm, cA, cH] = ['season', 'game_type', 'week', 'gameday', 'weekday', 'gametime', 'away_team', 'home_team'].map(col);
    if ([cS, cT, cW, cD, cWd, cTm, cA, cH].some((i) => i < 0)) throw new Error('games.csv is missing a column');
    const out = [];
    for (const line of lines.slice(1)) {
      if (!line) continue;
      const r = csvLine(line);
      if (r[cS] !== String(season) || r[cT] !== 'REG') continue;
      out.push({ week: Number(r[cW]), date: r[cD], weekday: r[cWd], time: r[cTm] || null,
        away: NFLVERSE_TEAM[r[cA]] || r[cA], home: NFLVERSE_TEAM[r[cH]] || r[cH] });
    }
    if (!out.length) throw new Error(`no ${season} games in games.csv`);
    return out;
  });

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const h12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`; };

/**
 * The week's games in the order they were played, each labelled by its window ("SUN 1:00",
 * "MON 8:15"). Sleeper's schedule is the list; nflverse only adds the time of day, so a game
 * it cannot find is still here, labelled by its day alone.
 */
export function weekGames(sched, kick, week) {
  const games = sched.filter((g) => g.week === week).map((g) => {
    const k = (kick || []).find((x) => x.week === week && x.home === g.home && x.away === g.away);
    const weekday = k?.weekday || DAYS[new Date(`${g.date}T12:00:00Z`).getUTCDay()];
    const time = k?.time || null;
    return { id: g.game_id, home: g.home, away: g.away, date: g.date, time,
      label: `${weekday.slice(0, 3).toUpperCase()}${time ? ' ' + h12(time) : ''}` };
  });
  return games.sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
}

// Every week-W game must be settled before the report means anything. An unplayed week
// returns HTTP 200 with a full, plausible, all-zeros lineup and no flag saying so.
export function weekIsFinal(sched, week) {
  const games = sched.filter((g) => g.week === week);
  const done = games.filter((g) => g.status === 'complete' || g.status === 'canceled');
  return { games: games.length, done: done.length, final: games.length > 0 && done.length === games.length,
           pending: games.filter((g) => g.status !== 'complete' && g.status !== 'canceled') };
}
