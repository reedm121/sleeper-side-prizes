// Which prize the week actually paid out.
//
// The pick has to satisfy three things at once, and they pull against each other:
//
//   unpredictable  — if anyone could work out Thursday morning that week 6 is Most Rushing
//                    Yards, they would chase that one prize instead of setting a real lineup,
//                    which is the whole thing this is meant to prevent.
//   verifiable     — twelve people are splitting money on this. "Trust me, I spun it" is not
//                    good enough, and neither is a random number nobody else can reproduce.
//   stable         — rebuilding week 6 next March must land on the same prize it landed on in
//                    October. A re-roll on rebuild would quietly rewrite history.
//
// So the wheel is seeded by the week's own twelve final scores. Nobody can know those before
// the games are played, everybody can read them off Sleeper afterwards, and the same scores
// always produce the same pick. No secret, no trusted spinner, nothing to re-roll.
//
// Stability is finished off in build.js: a week already recorded in wheel.json is replayed,
// never spun again, so even a stat correction months later cannot move it.

import { createHash } from 'node:crypto';

// Scores are canonicalised to two decimals and ordered by roster, so the seed does not depend
// on the order Sleeper happened to return the matchups in.
export function seedFrom(season, week, teams) {
  const scores = teams
    .map((t) => ({ rosterId: t.rosterId, points: Number(t.points) || 0 }))
    .sort((a, b) => a.rosterId - b.rosterId)
    .map((t) => `${t.rosterId}:${t.points.toFixed(2)}`);

  const basis = `${season}|${week}|${scores.join(',')}`;
  return { seed: createHash('sha256').update(basis).digest('hex'), scores };
}

// eligible: ids of awards that actually produced a board this week — a voided award cannot be
//           the prize, or the week pays out nothing.
// drawn:    ids already used earlier this season.
export function spin({ season, week, teams, eligible, drawn = [] }) {
  if (!eligible.length) throw new Error('no eligible awards to draw from');

  const { seed, scores } = seedFrom(season, week, teams);

  // Without replacement, so a 17-week season never repeats out of a catalogue this size.
  // If it ever did empty, the pool refills rather than the draw failing.
  const used = new Set(drawn);
  const remaining = eligible.filter((id) => !used.has(id));
  const wrapped = remaining.length === 0;
  const pool = (wrapped ? eligible : remaining).slice().sort();

  // 64 bits of the digest is far more than the ~6 needed here, and taking it modulo a pool of
  // 40 skews the earliest entries by about one part in 2^58.
  const index = Number(BigInt(`0x${seed.slice(0, 16)}`) % BigInt(pool.length));

  return { season, week, pick: pool[index], seed, pool, index, wrapped, scores };
}

// Recompute a recorded draw from what was written down, to confirm nobody edited the answer in.
export function verify(record) {
  const { seed } = seedFrom(record.season, record.week, record.scores.map((s) => {
    const [rosterId, points] = s.split(':');
    return { rosterId: Number(rosterId), points: Number(points) };
  }));
  if (seed !== record.seed) return { ok: false, why: 'seed does not match the recorded scores' };
  const index = Number(BigInt(`0x${seed.slice(0, 16)}`) % BigInt(record.pool.length));
  if (record.pool[index] !== record.pick) return { ok: false, why: 'pick is not what the seed selects' };
  return { ok: true };
}
