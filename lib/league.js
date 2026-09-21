// The one file a league edits: league.json.
//
// Everything that makes this deployment THIS league lives there — the Sleeper league id, the
// name on the masthead, the timezone the pages speak in, and which prizes out of the glossary
// the league actually plays for. Nothing else in the repository should know a league id or a
// league name; if it does, it is a bug in the template.
//
//   {
//     "league":    "123456789012345678",        Sleeper league id (this season's — they change yearly)
//     "name":      "New Ro FFL",                on every masthead and <title>
//     "timezone":  "America/New_York",          the clock the pages read dates in
//     "houseLabel":"The House Prizes",          heading over the house prizes
//     "house":     ["high_score", ...],         prizes always listed first, under that heading
//     "prizes":    ["rec_yd", ...] | "all",     the rest of what the league plays for
//     "custom":    { "rush_yd_team": { "name": "Run Forrest Run" } }   your name or blurb for a prize
//     "site":      "https://your-league.vercel.app"    optional; set by /admin once deployed
//   }
//
// `npm run setup` writes this file by asking questions. It can also be written by hand, and
// /admin edits a copy of it in the site's store that `config.js pull` writes back here before a
// build.
//
// A missing file is not an error here — `setup.js` has to be able to import the glossary before
// the file exists — so the values below are safe defaults and `configured` says whether anything
// was actually read. build.js refuses to build without a league id.

import { readFileSync } from 'node:fs';
import { canonical, canonicalKeys } from './ids.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CONFIG_PATH = process.env.LEAGUE_CONFIG || join(ROOT, 'league.json');

function read() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${CONFIG_PATH} is not valid JSON: ${e.message}`);
  }
}

const raw = read();
export const configured = raw !== null;

const DEFAULTS = {
  league: null,
  name: 'Side Prizes',
  timezone: 'America/New_York',
  houseLabel: 'The House Prizes',
  house: [],
  prizes: [],
  custom: {},
};

// Ids in the file are brought current, so a league.json written before a rename still works.
const list = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => canonical(String(x))))] : v === 'all' ? 'all' : []);

export const LEAGUE = {
  ...DEFAULTS,
  ...(raw || {}),
  // The environment wins, so a workflow variable can point a deploy at next season's league
  // without editing the file. `--league` on build.js wins over both, for backfills.
  league: process.env.LEAGUE_ID || raw?.league || null,
  house: list(raw?.house),
  prizes: list(raw?.prizes),
  custom: raw?.custom && typeof raw.custom === 'object' ? canonicalKeys(raw.custom) : {},
  // Where this league's site lives, once it has one. Set from /admin; lets the Tuesday workflow
  // fetch the manager's latest choices without database credentials (see config.js).
  site: typeof raw?.site === 'string' && /^https:\/\//.test(raw.site) ? raw.site.replace(/\/$/, '') : null,
};

// Any IANA zone Node knows about. A typo here would otherwise surface as a crash inside
// toLocaleDateString on the first page that prints a date.
try {
  new Intl.DateTimeFormat('en-US', { timeZone: LEAGUE.timezone });
} catch {
  throw new Error(`league.json: "${LEAGUE.timezone}" is not a timezone Node recognises (try "America/New_York" or "America/Chicago")`);
}

/** Every id the config mentions, so awards.js can check them against the glossary in one pass. */
export function mentionedIds() {
  const ids = new Set();
  for (const id of LEAGUE.house) ids.add(id);
  if (LEAGUE.prizes !== 'all') for (const id of LEAGUE.prizes) ids.add(id);
  for (const id of Object.keys(LEAGUE.custom)) ids.add(id);
  return ids;
}
