// The shortlist's shared state.
//
//   GET  /api/state                        -> { version, state }
//   POST /api/state  { version, state }    -> { ok, version, state }
//                                          -> 409 { ok:false, version, state } if stale
//
// The page is open to anyone holding the link, so the payload is checked against the real
// award catalogue rather than trusted: an unknown id, a verdict that is not yes/no, or an
// oversized note is dropped instead of being written to shared storage.

import { load, save, backend } from '../lib/store.js';
import { AWARDS } from '../awards.js';

const IDS = new Set(AWARDS.map((a) => a.id));
const NOTE_MAX = 2000;
const FREEFORM_MAX = 5000;

function clean(state) {
  const out = { verdicts: {}, notes: {}, note: '' };
  if (!state || typeof state !== 'object') return out;

  for (const [id, v] of Object.entries(state.verdicts || {})) {
    if (IDS.has(id) && (v === 'yes' || v === 'no')) out.verdicts[id] = v;
  }
  for (const [id, text] of Object.entries(state.notes || {})) {
    if (IDS.has(id) && typeof text === 'string' && text.trim()) {
      out.notes[id] = text.slice(0, NOTE_MAX);
    }
  }
  if (typeof state.note === 'string') out.note = state.note.slice(0, FREEFORM_MAX);
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (backend === 'none') {
    return res.status(503).json({
      error: 'no_storage',
      message: 'Connect a Redis store to this Vercel project (Storage -> Upstash), then redeploy.',
      // Which names were actually injected is the thing you need to know when this fires.
      sawEnv: Object.keys(process.env).filter((k) => /^(KV_|UPSTASH_|REDIS_)/.test(k)).sort(),
    });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await load());
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 0) {
        return res.status(400).json({ error: 'bad_version' });
      }
      const result = await save(version, clean(body.state));
      return res.status(result.ok ? 200 : 409).json(result);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
