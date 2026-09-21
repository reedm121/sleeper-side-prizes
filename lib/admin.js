// Who may change the league's settings from /admin.
//
// One password, from the environment, never from a file in the repository:
//
//   ADMIN_PASS          the plain password. Hashed here at startup.
//   ADMIN_PASS_SHA256   or its sha256, for anyone who would rather not put the plain text in
//                       a dashboard field: `printf %s 'the password' | shasum -a 256`
//
// Three modes fall out of that and the storage backend:
//
//   password   a password is set. Writes need `Authorization: Bearer <password>`.
//   open       no password, and the store is a local file — a league running this on the
//              manager's own laptop. Whoever is at the keyboard is the manager.
//   locked     no password, and the store is Redis — a deployed site. Writes are refused and
//              the page says what to set. Nobody should be able to reconfigure a league from
//              a public URL because the deployer skipped a step.
//
// Reads are always open: which prizes a league plays for is on /prizes anyway.

import { createHash, timingSafeEqual } from 'node:crypto';
import { backend } from './store.js';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const PLAIN = process.env.ADMIN_PASS;
const HASH = process.env.ADMIN_PASS_SHA256;
const WANT = HASH ? HASH.trim().toLowerCase() : PLAIN ? sha(PLAIN) : null;

export const mode = WANT ? 'password' : backend === 'file' ? 'open' : 'locked';

/** The password out of a request, if it carries one. */
function given(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '');
  return m ? m[1] : null;
}

export function authorized(req) {
  if (mode === 'open') return true;
  if (mode === 'locked') return false;
  const p = given(req);
  if (p === null) return false;
  const a = Buffer.from(sha(p)), b = Buffer.from(WANT);
  return a.length === b.length && timingSafeEqual(a, b);
}

// "Rebuild now" needs somewhere to send the request: a Vercel deploy hook URL on a deployed
// site, or this very machine on a local one.
export const canRebuild = Boolean(process.env.DEPLOY_HOOK) || (backend === 'file' && !process.env.VERCEL);
