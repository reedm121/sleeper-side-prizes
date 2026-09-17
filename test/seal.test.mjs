// The sealed weekly draw. It decides money and it is the one thing on the site nobody is
// allowed to know early, so these cover the four properties it has to hold:
//
//   sealed      the pick does not leave the server before somebody reveals it
//   binding     the commitment published up front matches the pick that comes out
//   once        a week can be sealed exactly one time, however many requests arrive
//   no repeats  a prize that already has a week cannot be drawn again that season
//
// Runs against the file backend, which is what `npm run dev` uses, in a throwaway directory.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dir = await mkdtemp(join(tmpdir(), 'wheel-'));
process.env.WHEEL_DIR = dir;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const { sealWheel, revealWheel, readWheel, sealed } = await import('../lib/store.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const POOL = ['rec_yd', 'pass_yd', 'scrimmage', 'rush_att', 'td_lng', 'top_starter'];
const S = 2099;

// 1. Nothing leaks before the reveal.
const first = await sealWheel({ season: S, week: 1, pool: POOL });
const before = sealed(first);
ok('a sealed week hides its pick', before.pick === undefined && before.nonce === undefined,
  JSON.stringify(before));
ok('a sealed week still publishes its commitment', typeof before.commit === 'string' && before.commit.length === 64);
ok('a sealed week publishes the pool it was drawn from', Array.isArray(before.pool) && before.pool.length === POOL.length);

// 2. Sealing again must hand back the same prize, not draw a new one.
const again = await sealWheel({ season: S, week: 1, pool: POOL });
ok('a week can only be sealed once', again.pick === first.pick && again.commit === first.commit,
  `${first.pick} then ${again.pick}`);

// 3. A narrowed pool cannot force a week that is already sealed.
const narrowed = await sealWheel({ season: S, week: 1, pool: ['rec_yd'] });
ok('a later pool cannot re-fix a sealed week', narrowed.pick === first.pick, `${first.pick} then ${narrowed.pick}`);

// 4. The commitment is binding.
const opened = sealed(await revealWheel(S, 1));
ok('revealing hands over the pick and the nonce', typeof opened.pick === 'string' && typeof opened.nonce === 'string');
ok('the commitment matches what was revealed',
  createHash('sha256').update(`${opened.pick}|${opened.nonce}`).digest('hex') === before.commit);
ok('the revealed pick was in the published pool', before.pool.includes(opened.pick));

// 5. Revealing twice must not move the record of when it was spun.
const twice = sealed(await revealWheel(S, 1));
ok('revealing twice does not move the timestamp', twice.revealedAt === opened.revealedAt);
ok('revealing twice does not change the pick', twice.pick === opened.pick);

// 6. No repeats across a season — including weeks that are sealed but never spun.
const picks = [opened.pick];
for (let w = 2; w <= POOL.length; w++) {
  picks.push((await sealWheel({ season: S, week: w, pool: POOL })).pick);
}
ok('a season never draws the same prize twice', new Set(picks).size === POOL.length, picks.join(', '));

// 7. Once the pool is exhausted it refills rather than the draw failing.
const wrapped = await sealWheel({ season: S, week: POOL.length + 1, pool: POOL });
ok('the pool refills when it runs out', POOL.includes(wrapped.pick) && wrapped.wrapped === true);

// 8. A week nobody sealed has no answer to give.
ok('an unsealed week reads as nothing', (await readWheel(S, 99)) === null);
ok('revealing an unsealed week does not invent one', (await revealWheel(S, 99)) === null);

await rm(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
