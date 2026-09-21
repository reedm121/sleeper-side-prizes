// The weekly draw: sealed on the first look at a finished week, opened when the manager spins.
//
//   GET  /api/wheel?season=2026&week=3
//        -> { state: 'none' }                              nothing sealed for that week yet
//        -> { revealed:false, commit, pool, createdAt }    sealed, nobody has spun
//        -> { revealed:true,  commit, pool, pick, nonce, revealedAt }
//
//   POST /api/wheel { action:'seal',   season, week, pool }
//        Seals a prize if that week has none. First write wins, so this is safe to call on
//        every page load and safe to replay — it can never reroll a week that is already
//        sealed. The caller never learns the pick.
//
//   POST /api/wheel { action:'reveal', season, week }
//        A spin. Opens the week for everyone and returns the pick with the nonce that proves
//        it against the commitment. Deliberately unauthenticated — see below.
//
// Why a commitment at all: the prize has to be a genuine surprise on Tuesday morning AND the
// league has to be able to tell that nobody swapped it afterwards. The hash is published the
// moment the week is sealed and the answer is not; when the spin opens it, anyone can hash
// `pick|nonce` themselves and match it against the commitment that was already public. That
// is the same guarantee the old score-seeded wheel gave, minus its one flaw — a seeded pick
// is computable off the final scores by anyone who reads wheel.js, so there was nothing left
// to reveal.

import { readWheel, revealWheel, sealWheel, sealed, backend } from '../lib/store.js';
import rawLedger from '../wheel.json' with { type: 'json' };
import { canonicalLedger } from '../lib/ids.js';

const ledger = canonicalLedger(rawLedger);

// The pool a week may be drawn from is whatever the Tuesday build published for it, and
// nothing else. Imported rather than read at runtime so it is bundled with the function.
//
// This is the only thing standing between the wheel and a curl: sealing is first-write-wins,
// so a request that arrived before anyone opened the page with `pool: ["high_score"]` would
// fix that week's prize permanently, and the commitment would verify perfectly afterwards.
// Checking ids against the glossary is not enough — it holds dozens of prizes this league does
// them retired, and any of them would have passed.
const PUBLISHED = new Map(
  (ledger.pending || []).map((p) => [`${p.season}:${p.week}`, new Set(p.pool)]),
);

// Nobody signs in, and there is nothing here to sign in to.
//
// A password would have been protecting the wrong thing. The pick is drawn and committed to a
// hash by the FIRST page load of a finished week — 'seal' below is unauthenticated and fires
// on load — so by the time anyone can press a button the answer already exists and is already
// published as a hash nobody can walk backwards. Pressing spin cannot choose it, change it or
// reroll it. The only thing a gate ever bought was deciding who got to look first, which is a
// question about a video call, not about a server.
//
// So a spin is what it appears to be: the moment someone asks for the envelope to be opened.
// Whoever gets there first opens it for the league, and the commitment published with the page
// proves to the other eleven that it was already inside.

const weekOf = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 22 ? n : null;
};
const seasonOf = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (backend === 'none') {
    return res.status(503).json({
      error: 'no_storage',
      message: 'Connect a Redis store to this Vercel project (Storage -> Upstash), then redeploy.',
    });
  }

  try {
    const src = req.method === 'GET'
      ? Object.fromEntries(new URL(req.url, 'http://x').searchParams)
      : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {});

    const season = seasonOf(src.season);
    const week = weekOf(src.week);
    if (!season || !week) return res.status(400).json({ error: 'bad_week' });

    if (req.method === 'GET') {
      const doc = await readWheel(season, week);
      return res.status(200).json(doc ? sealed(doc) : { season, week, state: 'none' });
    }

    if (req.method === 'POST') {
      if (src.action === 'seal') {
        // The caller's pool is ignored entirely. What the week is drawn from is what the build
        // published for that week, so narrowing it is not something a request can do.
        const published = PUBLISHED.get(`${season}:${week}`);
        if (!published?.size) {
          return res.status(404).json({
            error: 'no_pool',
            message: 'No prizes have been published for that week, so there is nothing to seal.',
          });
        }
        return res.status(200).json(sealed(await sealWheel({ season, week, pool: [...published] })));
      }

      if (src.action === 'reveal') {
        const doc = await revealWheel(season, week);
        if (!doc) return res.status(404).json({ error: 'not_sealed', message: 'No prize is sealed for that week yet.' });
        return res.status(200).json(sealed(doc));
      }

      return res.status(400).json({ error: 'bad_action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
