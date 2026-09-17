#!/usr/bin/env node
// Set this project up for YOUR Sleeper league. Writes league.json — see lib/league.js for what
// every field means — by asking a few questions, or from flags for a scripted run.
//
//   node setup.js                                   ask everything
//   node setup.js --league 123456789012345678       ask the rest, skip the id
//   node setup.js --league <id> --prizes core --yes  no questions: the core set, house empty
//   node setup.js --league <id> --prizes all --house house_high,house_closest --name "My League" --yes
//   node setup.js --list                            print the glossary and stop
//
// `--prizes` takes `core` (the ~20 that settle cleanly and rarely tie), `all`, or a comma list of
// ids. `--house` is a comma list of ids to pin at the top under their own heading. `--out` writes
// somewhere other than league.json. Nothing here touches Sleeper except to look the league up so
// you can see you typed the right id.

import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { GLOSSARY, TIERS } from './awards.js';
import { CONFIG_PATH } from './lib/league.js';
import * as api from './sleeper.js';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const has = (name) => argv.includes(`--${name}`);

const byId = new Map(GLOSSARY.map((a) => [a.id, a]));
const CORE = GLOSSARY.filter((a) => a.core).map((a) => a.id);

// One flat, numbered list, grouped by tier, so a person can answer "1-8, 14, rec_yd".
const NUMBERED = [];
for (const t of Object.keys(TIERS).map(Number).filter((t) => t > 0)) {
  for (const a of GLOSSARY.filter((x) => x.tier === t)) NUMBERED.push(a);
}
const caveat = (a) => [
  a.core ? 'core' : null,
  a.void ? 'stat can go dark for a week' : null,
  a.needsProj ? 'needs projections' : null,
  a.agg === 'drive' ? 'needs nflverse play-by-play' : null,
  a.agg === 'ratio' ? 'rate stat' : null,
  a.dir === 'asc' ? 'lowest wins' : null,
].filter(Boolean).join(', ');

function printGlossary(marked = new Set()) {
  let tier = null;
  NUMBERED.forEach((a, i) => {
    if (a.tier !== tier) { tier = a.tier; console.log(`\n  ${TIERS[tier].name.toUpperCase()}`); }
    const n = String(i + 1).padStart(3);
    const mark = marked.has(a.id) ? '*' : ' ';
    const note = caveat(a);
    console.log(`  ${mark}${n}. ${a.name.padEnd(30)} ${a.id.padEnd(20)} ${a.blurb}${note ? `  [${note}]` : ''}`);
  });
  console.log();
}

// "1-8, 14, rec_yd, core" -> ids. Unknown tokens are reported, not guessed at.
function parsePicks(text) {
  const ids = new Set(); const bad = [];
  for (const tok of String(text).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)) {
    if (tok === 'all') { for (const a of GLOSSARY) ids.add(a.id); continue; }
    if (tok === 'core') { for (const id of CORE) ids.add(id); continue; }
    if (tok === 'none') { ids.clear(); continue; }
    const range = /^(\d+)-(\d+)$/.exec(tok);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) NUMBERED[n - 1] ? ids.add(NUMBERED[n - 1].id) : bad.push(tok);
      continue;
    }
    if (/^\d+$/.test(tok)) { NUMBERED[Number(tok) - 1] ? ids.add(NUMBERED[Number(tok) - 1].id) : bad.push(tok); continue; }
    byId.has(tok) ? ids.add(tok) : bad.push(tok);
  }
  return { ids: [...ids], bad };
}

if (has('list')) { printGlossary(new Set(CORE)); console.log('  * = core set\n'); process.exit(0); }

let existing = {};
try { existing = JSON.parse(await readFile(flag('out') || CONFIG_PATH, 'utf8')); } catch {}

// Questions are separated by network calls, and readline does not hold a line that arrives
// while nothing is asking for it — with answers piped in (`printf ... | node setup.js`) it reads
// them all, hits the end of the pipe and closes before the second question. So lines are queued
// as they come, and a question takes the next queued line or waits for one. End of input answers
// every remaining question with its default, which is what a blank line would have done.
const rl = has('yes') ? null : createInterface({ input: stdin, output: stdout });
const lines = []; const waiting = []; let ended = false;
rl?.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
rl?.on('close', () => { ended = true; while (waiting.length) waiting.shift()(''); });
const nextLine = () => (lines.length ? Promise.resolve(lines.shift()) : ended ? Promise.resolve('') : new Promise((r) => waiting.push(r)));
const ask = async (q, fallback) => {
  if (!rl) return fallback;
  stdout.write(`${q}${fallback !== undefined && fallback !== null && fallback !== '' ? ` [${fallback}]` : ''}: `);
  const a = (await nextLine()).trim();
  if (ended && !lines.length) stdout.write('\n');
  return a || fallback;
};

// ---- 1. the league ---------------------------------------------------------------------
let leagueId = flag('league') || null;
let info = null;
for (;;) {
  if (!leagueId) leagueId = await ask('Sleeper league id (the long number in the league URL)', existing.league || '');
  if (!leagueId) { console.error('A league id is required.'); process.exit(1); }
  try {
    info = await api.league(leagueId);
    break;
  } catch (e) {
    console.error(`  Could not fetch league ${leagueId} from Sleeper (${e.message}).`);
    if (!rl) process.exit(1);
    leagueId = null;
  }
}
const slots = (info.roster_positions || []).filter((p) => !['BN', 'IR', 'TAXI'].includes(p));
console.log(`\n  ${info.name}  —  ${info.season} season, ${info.total_rosters} teams`);
console.log(`  Lineup: ${slots.join(' ')}`);
const sc = info.scoring_settings || {};
console.log(`  Scoring: ${sc.rec === 1 ? 'full PPR' : sc.rec === 0.5 ? 'half PPR' : sc.rec ? `${sc.rec} per catch` : 'standard'}, ${sc.pass_td ?? '?'} per passing TD`);
if (String(info.season) !== String((await api.state()).season)) {
  console.log(`  Note: this is a ${info.season} league. Sleeper gives each season its own id — for the current season use this year's.`);
}
console.log();

// ---- 2. name and timezone ---------------------------------------------------------------
const name = flag('name') || await ask('Name to print on the pages', existing.name || info.name);
let timezone = flag('timezone') || await ask('Timezone for dates on the pages', existing.timezone || 'America/New_York');
try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { console.error(`  "${timezone}" is not a timezone Node knows; using America/New_York.`); timezone = 'America/New_York'; }

// ---- 3. prizes ---------------------------------------------------------------------------
let picks;
if (flag('prizes')) {
  picks = parsePicks(flag('prizes'));
} else if (!rl) {
  picks = { ids: [...CORE], bad: [] };
} else {
  const current = new Set([...(existing.house || []), ...(existing.prizes === 'all' ? GLOSSARY.map((a) => a.id) : existing.prizes || [])]);
  printGlossary(current.size ? current : new Set(CORE));
  console.log(current.size ? '  * = what league.json has now' : '  * = the core set: prizes that settle cleanly and rarely tie');
  console.log('  Answer with numbers, ranges or ids — "1-8, 14, rec_yd" — or "core", "all", or blank to keep the marks.\n');
  for (;;) {
    const answer = await ask('Prizes to play for', current.size ? '' : 'core');
    picks = answer ? parsePicks(answer) : { ids: [...(current.size ? current : CORE)], bad: [] };
    if (!picks.bad.length) break;
    console.log(`  Not in the glossary: ${picks.bad.join(', ')}. Try again.`);
  }
}
if (picks.bad.length) { console.error(`Not in the glossary: ${picks.bad.join(', ')}`); process.exit(1); }
if (!picks.ids.length) { console.error('Pick at least one prize.'); process.exit(1); }

// ---- 4. house prizes ---------------------------------------------------------------------
let house;
if (flag('house') !== null) {
  const h = parsePicks(flag('house'));
  if (h.bad.length) { console.error(`Not in the glossary: ${h.bad.join(', ')}`); process.exit(1); }
  house = h.ids;
} else if (!rl) {
  house = (existing.house || []).filter((id) => picks.ids.includes(id));
} else {
  console.log('\n  House prizes are pinned at the top of every page under their own heading — the ones');
  console.log('  your league has always played for. Optional.');
  const answer = await ask('House prizes (ids or numbers, blank for none)', (existing.house || []).join(', '));
  const h = parsePicks(answer);
  if (h.bad.length) console.log(`  Ignoring unknown: ${h.bad.join(', ')}`);
  house = h.ids;
}
const houseSet = new Set(house);
const prizes = picks.ids.filter((id) => !houseSet.has(id));
// Anything named as house is played for, whether or not it was in the prize answer.
const houseLabel = flag('house-label') || existing.houseLabel || 'The House Prizes';

// ---- 5. write --------------------------------------------------------------------------
const out = flag('out') || CONFIG_PATH;
const config = {
  league: String(leagueId),
  name,
  timezone,
  houseLabel,
  house,
  prizes,
  // Custom names survive a re-run; there is no question for them because editing JSON is the
  // shorter route. See league.json in the README.
  custom: existing.custom && typeof existing.custom === 'object' ? existing.custom : {},
};
await writeFile(out, JSON.stringify(config, null, 2) + '\n');
rl?.close();

const total = house.length + prizes.length;
console.log(`\n  Wrote ${out}: ${total} prize${total === 1 ? '' : 's'} (${house.length} house).`);
console.log('\n  Next:');
if (info.previous_league_id) {
  console.log(`    node build.js --season ${Number(info.season) - 1} --week 1 --league ${info.previous_league_id} --demo`);
  console.log('      a demo page from last season, to see the wheel and every board with real numbers');
}
console.log('    node build.js --latest         the newest finished week of this season');
console.log('    npm run build && npm run dev   the site at http://localhost:3000');
console.log('    see README.md for deploying it and for the Tuesday workflow\n');
