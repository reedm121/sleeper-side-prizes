// The league's settings, as the manager sets them on /admin.
//
//   GET  /api/config
//        -> { version, stored, config, mode, canRebuild }
//           `config` is what the manager saved, or league.json's values if nobody has saved yet.
//
//   POST /api/config  { action: 'login' }                   Authorization: Bearer <password>
//        -> 200 { ok: true } | 401
//
//   POST /api/config  { version, config }                    Authorization: Bearer <password>
//        -> 200 { ok, version, config } | 409 { ok: false, version, config } if stale | 401
//
//   POST /api/config  { action: 'rebuild' }                  Authorization: Bearer <password>
//        -> 200 { ok, via } — a Vercel deploy hook, or `node config.js pull && node site.js` here
//
// Saving does not change the site by itself. Pages are built, and the wheel's pool is fixed, at
// build time: the Tuesday run online, `npm run week` on a laptop, or the rebuild above. Both
// begin with `config.js pull`, which writes this document over league.json.
//
// The payload is checked against the glossary and clamped rather than trusted: an unknown prize
// id, a bogus timezone or a novel of a blurb is dropped, not stored.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, saveConfig, hasConfig, backend } from '../lib/store.js';
import { authorized, mode, canRebuild } from '../lib/admin.js';
import { GLOSSARY } from '../awards.js';
import { LEAGUE } from '../lib/league.js';
import { canonical } from '../lib/ids.js';

const IDS = new Set(GLOSSARY.map((a) => a.id));
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const run = promisify(execFile);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ids = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => canonical(String(x))).filter((x) => IDS.has(x)))] : []);

export function clean(c) {
  const out = {};
  if (!c || typeof c !== 'object') return out;
  const league = str(c.league, 32);
  if (/^\d{6,32}$/.test(league)) out.league = league;
  out.name = str(c.name, 80) || LEAGUE.name;
  const tz = str(c.timezone, 64);
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); out.timezone = tz; } catch { out.timezone = LEAGUE.timezone; }
  out.houseLabel = str(c.houseLabel, 60) || 'The House Prizes';
  out.house = ids(c.house);
  out.prizes = c.prizes === 'all' ? 'all' : ids(c.prizes).filter((id) => !out.house.includes(id));
  out.custom = {};
  for (const [id, v] of Object.entries(c.custom && typeof c.custom === 'object' ? c.custom : {})) {
    const cid = canonical(id);
    if (!IDS.has(cid) || !v || typeof v !== 'object') continue;
    const name = str(v.name, 80), blurb = str(v.blurb, 300);
    if (name || blurb) out.custom[cid] = { ...(name ? { name } : {}), ...(blurb ? { blurb } : {}) };
  }
  const site = str(c.site, 200);
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site)) out.site = site;
  return out;
}

/** league.json's values in the same shape, for a store nobody has saved to yet. */
export const fromFile = () => ({
  league: LEAGUE.league, name: LEAGUE.name, timezone: LEAGUE.timezone, houseLabel: LEAGUE.houseLabel,
  house: LEAGUE.house, prizes: LEAGUE.prizes, custom: LEAGUE.custom, ...(LEAGUE.site ? { site: LEAGUE.site } : {}),
});

async function rebuild() {
  if (process.env.DEPLOY_HOOK) {
    const res = await fetch(process.env.DEPLOY_HOOK, { method: 'POST' });
    if (!res.ok) throw new Error(`deploy hook answered ${res.status}`);
    return 'deploy hook';
  }
  if (backend === 'file' && !process.env.VERCEL) {
    await run(process.execPath, [join(ROOT, 'config.js'), 'pull'], { cwd: ROOT });
    await run(process.execPath, [join(ROOT, 'site.js')], { cwd: ROOT });
    return 'local build';
  }
  throw Object.assign(new Error('nowhere to send a rebuild'), { code: 'no_rebuild' });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (backend === 'none') {
    return res.status(503).json({ error: 'no_storage', message: 'Connect a Redis store to this Vercel project (Storage -> Upstash), then redeploy.' });
  }

  try {
    if (req.method === 'GET') {
      const doc = await loadConfig();
      const stored = hasConfig(doc);
      const { updatedAt, ...state } = doc.state;
      return res.status(200).json({ version: doc.version, stored, updatedAt: updatedAt || null,
        config: stored ? { ...fromFile(), ...state } : fromFile(), mode, canRebuild });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

      if (!authorized(req)) {
        return res.status(401).json({ error: 'unauthorized', mode,
          message: mode === 'locked'
            ? 'This site has no manager password. Set ADMIN_PASS in the project\'s Environment Variables and redeploy.'
            : 'Wrong password.' });
      }

      if (body.action === 'login') return res.status(200).json({ ok: true, mode });

      if (body.action === 'rebuild') {
        try {
          return res.status(200).json({ ok: true, via: await rebuild() });
        } catch (e) {
          if (e.code === 'no_rebuild') return res.status(400).json({ error: 'no_rebuild', message: 'Set DEPLOY_HOOK to a Vercel deploy hook URL to rebuild from here. Until then the Tuesday build picks this up.' });
          throw e;
        }
      }

      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'bad_version' });
      const result = await saveConfig(version, clean(body.config));
      const { updatedAt, ...state } = result.state || {};
      return res.status(result.ok ? 200 : 409).json({ ok: result.ok, version: result.version, updatedAt: updatedAt || null, config: { ...fromFile(), ...state } });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
