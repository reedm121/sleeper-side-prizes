// A single versioned JSON document, shared by everyone who opens the shortlist.
//
// Two backends, chosen by environment and nothing else:
//   Upstash Redis  — whichever pair of REST credentials is present
//   a local file   — everything else, so `npm run dev` needs no account
//
// Deliberately dependency-free: Upstash speaks plain HTTP, so the whole project
// still installs nothing.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonical, canonicalKeys, canonicalWheelDoc } from './ids.js';

// Two versioned documents live here, under the same rules:
//   shortlist   the league's votes and notes on prizes it does not yet play for
//   config      what the manager set on /admin — overrides league.json at the next build
const DOCS = {
  shortlist: { ver: 'shortlist:version', doc: 'shortlist:doc', file: process.env.SHORTLIST_FILE || '.data/shortlist.json',
    blank: { verdicts: {}, notes: {}, note: '', updatedAt: null } },
  config: { ver: 'config:version', doc: 'config:doc', file: process.env.CONFIG_FILE || '.data/config.json',
    blank: { updatedAt: null } },
};
const WHEEL_DIR = process.env.WHEEL_DIR || '.data/wheel';

// The REST credentials arrive under a name nobody can predict. Vercel's integration has used
// KV_REST_API_* (old Vercel KV) and UPSTASH_REDIS_REST_* (marketplace Upstash), and it prefixes
// both with the store's own name when you give it one — FANTASY_KV_REST_API_URL and friends. So
// find the URL by its shape and take the token sitting beside it, rather than betting on a name.
//
// The read-only token is deliberately not eligible: it is a valid-looking credential that fails
// only at the moment of a write, which is the worst way to find out.
function credentials() {
  const shape = /^(.*_)?(KV_REST_API|UPSTASH_REDIS_REST)_URL$/;
  const names = Object.keys(process.env).filter((k) => shape.test(k) && process.env[k]);

  // An unprefixed name wins if both are somehow present, then shortest, for stable behaviour.
  names.sort((a, b) => a.length - b.length);

  for (const urlName of names) {
    const tokenName = urlName.replace(/_URL$/, '_TOKEN');
    if (process.env[tokenName]) return { url: process.env[urlName], token: process.env[tokenName], urlName, tokenName };
  }
  return {};
}

const { url: URL_, token: TOKEN, urlName: URL_NAME } = credentials();
export const credentialName = URL_NAME || null;

export const backend = URL_ && TOKEN ? 'redis' : process.env.VERCEL ? 'none' : 'file';

export const BLANK = DOCS.shortlist.blank;

// A write only lands if the document is still at the version the writer read. Two people
// marking at once is the normal case here, not an edge case: whoever is second is told to
// reload rather than silently overwriting the other's marks.
const CAS = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v ~= tonumber(ARGV[1]) then return -1 end
redis.call('SET', KEYS[2], ARGV[2])
return redis.call('INCR', KEYS[1])
`;

async function redis(command) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`redis: ${body.error || res.status}`);
  return body.result;
}

// The file backend's read-compare-write is three awaits long, so two overlapping saves can
// both see the same version and both think they won. Redis does not have this problem — its
// check and write are one Lua call — so dev is serialised here to behave the same way, and a
// conflict is something you can actually reproduce locally.
let chain = Promise.resolve();
function exclusive(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

async function readFileDoc(spec) {
  try {
    return JSON.parse(await readFile(spec.file, 'utf8'));
  } catch {
    return { version: 0, state: spec.blank };
  }
}

async function loadDoc(name) {
  const spec = DOCS[name];
  if (backend === 'none') throw new Error('no storage configured');
  if (backend === 'file') return readFileDoc(spec);

  const [version, doc] = await redis(['MGET', spec.ver, spec.doc]);
  return {
    version: Number(version) || 0,
    state: doc ? { ...spec.blank, ...JSON.parse(doc) } : spec.blank,
  };
}

// Returns { ok: true, version } on success, or { ok: false, ...current } if someone
// else got there first — the caller hands the current document back to the client.
async function saveDoc(name, version, state) {
  const spec = DOCS[name];
  if (backend === 'none') throw new Error('no storage configured');
  const next = { ...spec.blank, ...state, updatedAt: new Date().toISOString() };

  if (backend === 'file') {
    return exclusive(async () => {
      const cur = await readFileDoc(spec);
      if (cur.version !== version) return { ok: false, ...cur };
      await mkdir(dirname(spec.file), { recursive: true });
      await writeFile(spec.file, JSON.stringify({ version: version + 1, state: next }, null, 2));
      return { ok: true, version: version + 1, state: next };
    });
  }

  const result = await redis(['EVAL', CAS, '2', spec.ver, spec.doc, String(version), JSON.stringify(next)]);
  if (Number(result) === -1) return { ok: false, ...(await loadDoc(name)) };
  return { ok: true, version: Number(result), state: next };
}

// ---- the shortlist ----------------------------------------------------------------------

// Votes and notes are keyed by prize id, and a prize can be renamed after a vote was saved.
const currentIds = (doc) => ({ ...doc, state: { ...doc.state, verdicts: canonicalKeys(doc.state.verdicts), notes: canonicalKeys(doc.state.notes) } });

export const load = async () => currentIds(await loadDoc('shortlist'));
export const save = (version, state) => saveDoc('shortlist', version, state);

// ---- the manager's config -----------------------------------------------------------------
//
// The same shape as league.json (see lib/league.js), saved from /admin. `config.js pull` writes
// it over league.json before a build, so the pages and the wheel follow what the manager set.
// A store with no config document means nobody has used /admin: league.json stands alone.

const currentConfigIds = (doc) => {
  const s = doc.state || {};
  return { ...doc, state: {
    ...s,
    ...(Array.isArray(s.house) ? { house: s.house.map(canonical) } : {}),
    ...(Array.isArray(s.prizes) ? { prizes: s.prizes.map(canonical) } : {}),
    ...(s.custom && typeof s.custom === 'object' ? { custom: canonicalKeys(s.custom) } : {}),
  } };
};
export const loadConfig = async () => currentConfigIds(await loadDoc('config'));
export const saveConfig = (version, state) => saveDoc('config', version, state);
/** True once somebody has saved from /admin: the document has more in it than a blank. */
export const hasConfig = (doc) => Boolean(doc?.state?.updatedAt);


// ---------------------------------------------------------------------------------------
// THE WEEKLY DRAW
//
// One document per week, at `wheel:<season>:<week>`, holding a sealed prize:
//
//   { pool, pick, nonce, commit, createdAt, revealed, revealedAt }
//
// `commit` is sha256(`pick|nonce`) and is public from the moment the week is built. `pick`
// and `nonce` are not — `sealed()` strips them until someone reveals the week — so nobody,
// the league manager included, can know Tuesday's prize before he spins for it. Afterwards
// anyone can hash the revealed pick against the commit that was published hours earlier and
// see that it was never swapped.
//
// The draw happens HERE, on the server, and not in the build: a pick that passes through CI
// is a pick sitting in a workflow log. The build only publishes the pool it is drawn from.
//
// Sealing is first-write-wins. A week whose prize is already sealed can never be re-sealed,
// so a second page load cannot reroll a prize and neither can anyone replaying the request.

const wheelKey = (season, week) => `wheel:${Number(season)}:${Number(week)}`;
const wheelFile = (season, week) => join(WHEEL_DIR, `${Number(season)}-${Number(week)}.json`);

// What a request is allowed to see. Before the reveal that is the commitment and the pool it
// was drawn from; after it, the answer and everything needed to check it.
export function sealed(doc) {
  if (!doc) return null;
  const open = { season: doc.season, week: doc.week, pool: doc.pool, commit: doc.commit, createdAt: doc.createdAt };
  if (!doc.revealed) return { ...open, revealed: false };
  // `sealedPick` is what the commitment hashes; it differs from `pick` only after a rename.
  return { ...open, revealed: true, revealedAt: doc.revealedAt, pick: doc.pick, nonce: doc.nonce,
    ...(doc.sealedPick && doc.sealedPick !== doc.pick ? { sealedPick: doc.sealedPick } : {}) };
}

// A draw sealed under an id that was later renamed comes back under the current one. The
// commitment still verifies: it was computed over the pick's id AS SEALED, so `sealed()` also
// hands out the id the hash was made with.
export async function readWheel(season, week) {
  if (backend === 'none') throw new Error('no storage configured');
  const raw = await readWheelRaw(season, week);
  return raw ? { ...canonicalWheelDoc(raw), sealedPick: raw.pick } : null;
}
async function readWheelRaw(season, week) {
  if (backend === 'file') {
    try { return JSON.parse(await readFile(wheelFile(season, week), 'utf8')); } catch { return null; }
  }
  const doc = await redis(['GET', wheelKey(season, week)]);
  return doc ? JSON.parse(doc) : null;
}

async function putWheel(doc, { onlyIfAbsent }) {
  const body = JSON.stringify(doc);
  if (backend === 'file') {
    return exclusive(async () => {
      await mkdir(WHEEL_DIR, { recursive: true });
      if (onlyIfAbsent) {
        try { return JSON.parse(await readFile(wheelFile(doc.season, doc.week), 'utf8')); } catch {}
      }
      await writeFile(wheelFile(doc.season, doc.week), body);
      return doc;
    });
  }
  // NX means the first seal of a week is the only seal of that week.
  const args = onlyIfAbsent ? ['SET', wheelKey(doc.season, doc.week), body, 'NX'] : ['SET', wheelKey(doc.season, doc.week), body];
  const ok = await redis(args);
  if (onlyIfAbsent && ok === null) return readWheel(doc.season, doc.week);
  return doc;
}

// Draw a prize for a week and seal it. Returns whatever is sealed for that week afterwards,
// which for an already-sealed week is the prize drawn the first time and not this one.
// Every prize this season already has its week. A prize that is merely sealed and not yet
// spun counts: it is spoken for even though nobody knows what it is.
//
// The whole season, not the weeks below this one. Weeks are not necessarily sealed in order —
// a cron that misses a Tuesday gets backfilled afterwards, and the week built later is opened
// later — and looking only backwards lets the earlier week redraw a prize the later one has
// already fixed. Seals are permanent, so a collision cannot be undone by rerolling either.
const SEASON_WEEKS = 22;
async function spokenFor(season, week) {
  const taken = new Set();

  if (backend === 'file') {
    for (let w = 1; w <= SEASON_WEEKS; w++) {
      if (w === week) continue;
      const doc = await readWheel(season, w);
      if (doc) taken.add(doc.pick);
    }
    return taken;
  }

  const keys = [];
  for (let w = 1; w <= SEASON_WEEKS; w++) if (w !== week) keys.push(wheelKey(season, w));
  for (const doc of await redis(['MGET', ...keys])) {
    if (doc) taken.add(JSON.parse(doc).pick);
  }
  return taken;
}

export async function sealWheel({ season, week, pool }) {
  if (backend === 'none') throw new Error('no storage configured');
  if (!Array.isArray(pool) || !pool.length) throw new Error('empty pool');

  const ordered = [...new Set(pool)].sort();

  // Without replacement across the season, the way the old build-time wheel drew: the index
  // page promises a prize is never drawn twice and the prize board's "still up" column is
  // only true if that holds. If a season somehow outlasts the catalogue the pool refills
  // rather than the draw failing.
  const taken = await spokenFor(season, week);
  const fresh = ordered.filter((id) => !taken.has(id));
  const from = fresh.length ? fresh : ordered;
  const pick = from[randomInt(from.length)];
  const nonce = randomBytes(16).toString('hex');

  return putWheel({
    season: Number(season), week: Number(week),
    pool: from, pick, nonce,
    wrapped: !fresh.length,
    commit: createHash('sha256').update(`${pick}|${nonce}`).digest('hex'),
    createdAt: new Date().toISOString(),
    revealed: false, revealedAt: null,
  }, { onlyIfAbsent: true });
}

// Open a sealed week. Revealing twice is not an error and does not move the timestamp — the
// manager reloading the page after his spin must not rewrite when the spin happened.
export async function revealWheel(season, week) {
  // Written back exactly as stored — the raw document — so a reveal never rewrites the id the
  // commitment was computed over.
  const raw = await readWheelRaw(season, week);
  if (!raw) return null;
  if (!raw.revealed) {
    raw.revealed = true;
    raw.revealedAt = new Date().toISOString();
    await putWheel(raw, { onlyIfAbsent: false });
  }
  return readWheel(season, week);
}
