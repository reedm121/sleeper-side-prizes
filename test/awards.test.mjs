// The glossary is config, and config drifts. These hold it to the shape compute.js expects and
// to the stat keys Sleeper actually returns, so a typo in a new row fails here rather than as a
// board that quietly reads zero for everybody.
import { readFile } from 'node:fs/promises';
import { GLOSSARY, AWARDS, PLAYED, HOUSE, TIERS, phaseOf, PHASES, statKeysOf } from '../awards.js';
import { LEAGUE } from '../lib/league.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const { keys } = JSON.parse(await readFile(new URL('./fixtures/sleeper-stat-keys.json', import.meta.url), 'utf8'));
const KNOWN = new Set(keys);

const AGGS = new Set(['sum', 'max', 'count', 'ratio', 'points', 'slot', 'delta', 'luckyLoser', 'luckyWinner',
  'closest', 'shootout', 'margin', 'shareOfTeam', 'projDelta', 'bench', 'drive']);
const POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

// 1. Ids: unique, permanent-looking, and never declaring tier 0 (that is the league's to assign).
const ids = GLOSSARY.map((a) => a.id);
ok('every id is unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
ok('ids are lowercase snake_case', ids.every((id) => /^[a-z][a-z0-9_]*$/.test(id)), ids.filter((id) => !/^[a-z][a-z0-9_]*$/.test(id)).join(','));
ok('no glossary row claims tier 0', GLOSSARY.every((a) => a.tier > 0 && TIERS[a.tier]), GLOSSARY.filter((a) => !(a.tier > 0 && TIERS[a.tier])).map((a) => a.id).join(','));

// 2. Shape: every row says how it aggregates, and has what that aggregation needs.
const shapeBad = [];
for (const a of GLOSSARY) {
  if (!AGGS.has(a.agg)) shapeBad.push(`${a.id}: unknown agg ${a.agg}`);
  if (['sum', 'max'].includes(a.agg) && !(a.keys?.length)) shapeBad.push(`${a.id}: ${a.agg} without keys`);
  if (a.agg === 'max' && a.keys?.some((k) => !/_lng$|^rush_att$|^rush_yd$|^rec_yd$|^rec_tgt$|^rec$|^fgm_lng$/.test(k))) shapeBad.push(`${a.id}: max over an odd key ${a.keys}`);
  if (a.agg === 'sum' && a.keys?.some((k) => /_lng$/.test(k))) shapeBad.push(`${a.id}: NEVER sum a _lng key`);
  if (a.agg === 'ratio' && !(a.num?.length)) shapeBad.push(`${a.id}: ratio without num`);
  if (a.agg === 'count' && !a.where) shapeBad.push(`${a.id}: count without where`);
  if (a.agg === 'slot' && !(a.slots?.length)) shapeBad.push(`${a.id}: slot without slots`);
  if (a.agg === 'points' && !['sum', 'max', 'min'].includes(a.mode)) shapeBad.push(`${a.id}: points needs mode`);
  if (a.agg === 'bench' && !['beast', 'left', 'optimal', 'pct', 'total'].includes(a.mode)) shapeBad.push(`${a.id}: bench mode ${a.mode}`);
  if (a.agg === 'projDelta' && (!['team', 'max', 'min'].includes(a.mode) || !a.needsProj)) shapeBad.push(`${a.id}: projDelta needs mode and needsProj`);
  if (!['asc', 'desc'].includes(a.dir)) shapeBad.push(`${a.id}: dir ${a.dir}`);
  if (a.pos && !a.pos.every((p) => POS.has(p))) shapeBad.push(`${a.id}: pos ${a.pos}`);
  if (a.posNot && !a.posNot.every((p) => POS.has(p))) shapeBad.push(`${a.id}: posNot ${a.posNot}`);
  if (!a.name || !a.blurb) shapeBad.push(`${a.id}: needs a name and a blurb`);
  if (typeof a.unit !== 'string') shapeBad.push(`${a.id}: unit must be a string ("" for a count)`);
}
ok('every row has the shape its aggregation needs', !shapeBad.length, shapeBad.join(' | '));

// 3. Stat keys: only ones Sleeper returns. The one exception is `where.field`, which reads a
//    starter field rather than a stat.
const keyBad = GLOSSARY.flatMap((a) => statKeysOf(a).filter((k) => !KNOWN.has(k)).map((k) => `${a.id}:${k}`));
ok('every stat key exists in Sleeper\'s stats payload', !keyBad.length, keyBad.join(','));

// 4. Every row lands in a phase the prize list knows how to head.
const phaseBad = GLOSSARY.filter((a) => !PHASES.includes(phaseOf(a))).map((a) => a.id);
ok('every row has a phase', !phaseBad.length, phaseBad.join(','));

// 5. The league's config resolved: what league.json names is what PLAYED holds, in that order.
const houseIds = LEAGUE.house;
ok('HOUSE is league.json\'s house list, in order', JSON.stringify(HOUSE.map((a) => a.id)) === JSON.stringify(houseIds));
ok('house rows sit in tier 0', HOUSE.every((a) => a.tier === 0));
const expectPlayed = LEAGUE.prizes === 'all' ? GLOSSARY.length : new Set([...houseIds, ...LEAGUE.prizes]).size;
ok('PLAYED is exactly house + prizes', PLAYED.length === expectPlayed, `${PLAYED.length} vs ${expectPlayed}`);
ok('AWARDS carries the whole glossary', AWARDS.length === GLOSSARY.length);
ok('everything not played is marked out', AWARDS.filter((a) => a.out).length === GLOSSARY.length - PLAYED.length);
const customBad = Object.entries(LEAGUE.custom).filter(([id, c]) => c.name && AWARDS.find((a) => a.id === id)?.name !== c.name.trim());
ok('custom names are applied', !customBad.length, customBad.map(([id]) => id).join(','));
ok('a core set exists for setup to offer', GLOSSARY.filter((a) => a.core).length >= 15);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
