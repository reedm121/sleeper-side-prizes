// The wheel decides money, so these cover the three properties it has to hold:
// same input -> same pick, different week -> different pick, and no repeats in a season.
import { spin, seedFrom, verify } from '../wheel.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const teams = (pts) => pts.map((p, i) => ({ rosterId: i + 1, points: p }));
const WEEK = teams([94.44, 112.3, 88.02, 130.5, 76.9, 101.1, 99.98, 120.4, 84.2, 145.6, 91.3, 108.7]);
const EL = ['rec_yd', 'pass_yd', 'scrimmage', 'rush_att', 'td_lng', 'top_starter', 'bench_pts', 'six_god'];

// 1. Deterministic.
const a = spin({ season: 2026, week: 3, teams: WEEK, eligible: EL });
const b = spin({ season: 2026, week: 3, teams: WEEK, eligible: EL });
ok('same scores give the same pick', a.pick === b.pick && a.seed === b.seed, `${a.pick} vs ${b.pick}`);

// 2. Order of the matchups must not matter.
const shuffled = [...WEEK].reverse();
ok('roster order does not change the seed', spin({ season: 2026, week: 3, teams: shuffled, eligible: EL }).seed === a.seed);

// 3. One different score changes everything.
const nudged = teams([94.44, 112.3, 88.02, 130.5, 76.9, 101.1, 99.98, 120.4, 84.2, 145.6, 91.3, 108.72]);
ok('a 0.02 score change reseeds the draw', spin({ season: 2026, week: 3, teams: nudged, eligible: EL }).seed !== a.seed);

// 4. Different weeks are independent.
ok('week number changes the pick', spin({ season: 2026, week: 4, teams: WEEK, eligible: EL }).seed !== a.seed);

// 5. A voided award can never be drawn.
const noBench = EL.filter((x) => x !== 'bench_pts');
const many = Array.from({ length: 200 }, (_, i) =>
  spin({ season: 2026, week: (i % 17) + 1, teams: teams(WEEK.map((t, j) => t.points + i + j * 0.01)), eligible: noBench }).pick);
ok('an ineligible award is never picked', !many.includes('bench_pts'));

// 6. No repeats across a season.
const drawn = [];
for (let w = 1; w <= EL.length; w++) {
  const r = spin({ season: 2026, week: w, teams: teams(WEEK.map((t, j) => t.points + w * 3 + j * 0.7)), eligible: EL, drawn });
  drawn.push(r.pick);
}
ok('no repeats until the pool empties', new Set(drawn).size === EL.length, `${drawn.length} draws, ${new Set(drawn).size} unique`);

// 7. Pool refills instead of throwing once everything has been used.
const wrap = spin({ season: 2026, week: 9, teams: WEEK, eligible: EL, drawn: EL });
ok('pool refills when exhausted', wrap.wrapped === true && EL.includes(wrap.pick));

// 8. A recorded draw verifies, and a tampered one does not.
const rec = { season: 2026, week: 3, pick: a.pick, seed: a.seed, pool: a.pool, scores: a.scores };
ok('an honest record verifies', verify(rec).ok);
ok('a swapped pick fails verification', !verify({ ...rec, pick: a.pool.find((x) => x !== a.pick) }).ok);
ok('an edited score fails verification', !verify({ ...rec, scores: rec.scores.map((s, i) => (i ? s : '1:0.00')) }).ok);

// 9. Distribution is not obviously lopsided.
const counts = {};
for (let i = 0; i < 4000; i++) {
  const p = spin({ season: 2026, week: 1, teams: teams(WEEK.map((t, j) => t.points + i * 0.13 + j)), eligible: EL }).pick;
  counts[p] = (counts[p] || 0) + 1;
}
const vals = Object.values(counts);
const spread = Math.max(...vals) / Math.min(...vals);
ok('draws spread evenly over the pool', Object.keys(counts).length === EL.length && spread < 1.25,
   `spread ${spread.toFixed(2)}, ${JSON.stringify(counts)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
