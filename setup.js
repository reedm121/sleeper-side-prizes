#!/usr/bin/env node
// Set this project up for YOUR Sleeper league. Writes league.json — see lib/league.js for what
// every field means — by asking a few questions, or from flags for a scripted run.
//
//   node setup.js                                   ask everything
//   node setup.js --league 123456789012345678       ask the rest, skip the id
//   node setup.js --league <id> --prizes core --yes  no questions: the core set, house empty
//   node setup.js --league <id> --prizes all --house house_high,house_closest --name "My League" --yes
//   node setup.js --list                            print the glossary and stop
//   node setup.js --league <id> --yes --preview      ...and build a page and serve it
//
// `--prizes` takes `core` (the ~20 that settle cleanly and rarely tie), `all`, or a comma list of
// ids. `--house` is a comma list of ids to pin at the top under their own heading. `--out` writes
// somewhere other than league.json. `--preview` / `--no-preview` answer the last question. Sleeper
// is only read: the league, its teams and, for the preview, one week's box scores.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
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
if (rl) console.log('\n  Set this up for your Sleeper league. Press Enter to take the answer shown in [brackets].');
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
// The teams, exactly as the pages will print them — a team name where the manager set one,
// the display name where not. Twelve familiar names is how you know you typed the right id.
try {
  const users = await api.users(leagueId);
  const names = users.map((u) => (u.metadata?.team_name || '').trim() || u.display_name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  console.log(`  Teams:   ${names.join(' · ')}`);
} catch { console.log('  Teams:   (could not fetch the team list; the build will)'); }
const nfl = await api.state();
const pastSeason = String(info.season) !== String(nfl.season);
if (pastSeason) {
  console.log(`\n  Note: this is a ${info.season} league. Sleeper gives each season its own id — for the current season use this year's.`);
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

const total = house.length + prizes.length;
console.log(`\n  Wrote ${out}: ${total} prize${total === 1 ? '' : 's'} (${house.length} house).`);

// ---- 6. a preview ------------------------------------------------------------------------
//
// The point of the whole thing is a page with your league's names on it, so offer to build one
// now rather than hand over a list of commands. Which week depends on the calendar:
//
//   this season, a week has finished   the real thing: the newest finished week, live wheel
//   this season, nothing finished yet   last season's final week, as a demo, off the league
//                                       Sleeper links as the previous one
//   a past season's league              its own final week, as a demo
//
// Headshots and the play-by-play download are skipped here so the preview is a minute, not
// five; the Tuesday workflow includes both.
async function previewTarget() {
  const latestFinal = async (season) => {
    const sched = await api.schedule(season);
    const top = Math.max(0, ...sched.map((g) => g.week));
    for (let w = top; w >= 1; w--) if (api.weekIsFinal(sched, w).final) return w;
    return 0;
  };
  if (!pastSeason) {
    const w = await latestFinal(nfl.season);
    if (w) return { args: ['--latest'], label: `week ${w} of this season — the real page, with a live wheel` };
    if (info.previous_league_id) {
      const prev = await api.league(info.previous_league_id);
      const pw = await latestFinal(prev.season);
      if (pw) return { args: ['--season', String(prev.season), '--week', String(pw), '--league', String(prev.league_id), '--demo'], label: `week ${pw} of ${prev.season}, as a demo — nothing this season has finished yet` };
    }
    return null;
  }
  const w = await latestFinal(info.season);
  return w ? { args: ['--season', String(info.season), '--week', String(w), '--league', String(leagueId), '--demo'], label: `week ${w} of ${info.season}, as a demo` } : null;
}

let wantPreview = has('preview');
if (!wantPreview && rl && !has('no-preview')) {
  const a = await ask('Build a preview page now and open it', 'Y');
  wantPreview = /^y/i.test(a);
}
rl?.close();

if (wantPreview) {
  const target = await previewTarget().catch(() => null);
  if (!target) {
    console.log('\n  No finished week to preview yet. Once one is, run: node build.js --latest && npm run build && npm run dev');
  } else {
    console.log(`\n  Building ${target.label}...\n`);
    const env = { ...process.env, LEAGUE_CONFIG: out };
    const here = new URL('.', import.meta.url).pathname;
    const run = (script, args) => execFileSync(process.execPath, [join(here, script), ...args], { stdio: 'inherit', env });
    try {
      run('build.js', [...target.args, '--no-drives']);
      run('site.js', []);
    } catch {
      console.error('\n  The preview build failed; the messages above say why. league.json is written either way.');
      process.exit(1);
    }
    const port = Number(process.env.PORT) || 3000;
    const url = `http://localhost:${port}`;
    // Straight to the page that was just built. The front door is the holding card while a week
    // is being played, and the person at this prompt wants to see their league's names.
    const built = (await readdir(join(here, 'weeks')).catch(() => []))
      .filter((f) => /^\d{4}-week-\d+\.html$/.test(f))
      .map((f) => ({ f, t: statSync(join(here, 'weeks', f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    const page = built ? `${url}/weeks/${built.f.replace(/\.html$/, '')}` : url;
    console.log(`\n  Serving ${url} — Ctrl-C stops it. Opening ${page}`);
    console.log('  Every page is real except the wheel on a demo week, which spins for fun and records nothing.\n');
    const server = spawn(process.execPath, [join(here, 'dev.js')], { stdio: 'inherit', env });
    // Only when a person is watching. A scripted run has nowhere to open a browser.
    if (stdout.isTTY) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      setTimeout(() => { try { spawn(opener, [page], { stdio: 'ignore', shell: process.platform === 'win32' }).on('error', () => {}); } catch {} }, 1200);
    }
    await new Promise((resolve) => server.on('exit', resolve));
    process.exit(0);
  }
}

console.log('\n  Next:');
console.log('    node build.js --latest         the newest finished week of this season');
console.log('    npm run build && npm run dev   the site at http://localhost:3000');
console.log('    see README.md for deploying it and for the Tuesday workflow\n');
