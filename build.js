#!/usr/bin/env node
// Build a weekly incentive report.
//
//   node build.js --week 2 --season 2025 --league <id>   backfill a past week
//   node build.js --week 3                               this season, default league
//   node build.js --latest                               the newest week that has finished
//   node build.js --which                                print "<season> <week>" and stop
//   node build.js --week 1 --force                       report on an unfinished week anyway
//   node build.js --week 2 --text                        print to the terminal instead of HTML
//   node build.js --week 2 --no-drives                   skip the one award that needs play-by-play
//   node build.js --week 2 --demo                        a page whose wheel can be spun for real
//   node build.js --week 2 --demo --fake-names           ...with made-up team names, for a screenshot
//
// --demo is for showing the league how Tuesday works. The page still reports the week honestly,
// but its wheel grows a button that spins to a random prize out of that week's pool and shows
// who would have won it. It decides nothing and saves nothing. Never pass it for a live week.
//
// Writes weeks/<season>-week-<n>.html, which site.js publishes and Vercel serves.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as api from './sleeper.js';
import * as pbp from './drives.js';
import { buildTeams, computeAwards, scoreWith } from './compute.js';
import { renderHTML } from './render.js';
import { AWARDS, PLAYED } from './awards.js';
import { spin } from './wheel.js';
import { LEAGUE, CONFIG_PATH } from './lib/league.js';
import { canonicalLedger } from './lib/ids.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const leagueId = flag('league', LEAGUE.league);
if (!leagueId) {
  console.error(`\n  No league to build. Put this season's Sleeper league id in ${CONFIG_PATH} —`);
  console.error('  `npm run setup` writes it for you — or pass --league <id> for a one-off.\n');
  process.exit(1);
}
const fresh = has('fresh');

const nflState = await api.state();
const season = flag('season', nflState.season);
const sched = await api.schedule(season, fresh);

// A league belongs to exactly one season, but the finality gate below reads `season`'s
// schedule — so the two have to agree before anything is fetched on their terms.
//
// `--season 2025 --league <a 2026 id>` is one character off a real backfill, and it judges a
// half-played 2026 week against a 2025 schedule whose games are all long complete. The week
// reads final, so every fetch for it caches with an infinite TTL, and the provisional copy is
// what the genuinely-final rebuild reads back. That is not hypothetical: it is how
// `.cache/matchups-<league>-{1,2}.json` came to hold a pre-Monday-night week 1 and
// an all-zero week 2. Cheap to check, and it fails before the first cacheable request.
const leagueInfo = await api.league(leagueId);
if (String(leagueInfo.season) !== String(season)) {
  console.error(`\n  League ${leagueId} is a ${leagueInfo.season} league, but --season says ${season}.`);
  console.error(`  A week would be judged final against ${season}'s schedule and cached forever`);
  console.error(`  off scores that may still be moving. Pass the season that matches the league.\n`);
  process.exit(1);
}

// Sleeper rolls state.week forward partway through the week, so "current" is not the same
// as "finished". --latest walks back to the newest week whose every game is settled, which
// is what an unattended Tuesday run actually wants.
function latestFinal() {
  for (let w = Number(nflState.week) + 1; w >= 1; w--) {
    if (api.weekIsFinal(sched, w).final) return w;
  }
  return 0;
}

const week = has('latest') ? latestFinal() : Number(flag('week', nflState.week));
if (!week) {
  console.error('No week has finished yet this season; nothing to build.');
  process.exit(has('latest') ? 0 : 1);
}

// The weekly workflow has to hand the same week to assets.py before this can render, so it
// asks for the number first rather than guessing it a second time.
if (has('which')) {
  console.log(`${season} ${week}`);
  process.exit(0);
}

console.error(`Building ${season} week ${week} for league ${leagueId}`);

const gate = api.weekIsFinal(sched, week);
if (!gate.final && !has('force')) {
  console.error(`\n  Week ${week} is not final: ${gate.done}/${gate.games} games settled.`);
  for (const g of gate.pending.slice(0, 4)) console.error(`    ${g.away} @ ${g.home}  ${g.date}  ${g.status}`);
  if (gate.pending.length > 4) console.error(`    ...and ${gate.pending.length - 4} more`);
  console.error(`\n  An unplayed week still returns a full, plausible, all-zero lineup, so this`);
  console.error(`  would publish nonsense. Re-run once the games are in, or pass --force.\n`);
  process.exit(1);
}

// Only a settled week may be cached; a provisional pull must never poison the final one.
const cacheOpts = { fresh, final: gate.final };

const [rosters, users, matchups, statRows] = await Promise.all([
  api.rosters(leagueId), api.users(leagueId),
  api.matchups(leagueId, week, cacheOpts), api.stats(season, week, cacheOpts),
]);

// Week-over-week prizes need the prior week's scores.
let prevPoints = new Map();
if (week > 1) {
  try {
    const prevGate = api.weekIsFinal(sched, week - 1);
    const prev = await api.matchups(leagueId, week - 1, { fresh, final: prevGate.final });
    for (const m of prev) prevPoints.set(m.roster_id, Number(m.points) || 0);
  } catch { console.error(`  week ${week - 1} unavailable; week-over-week prizes will void`); }
}

let projRows = [];
try { projRows = await api.projections(season, week, cacheOpts); } catch { console.error('  projections unavailable'); }

// "Now Watch This Drive" is the only award Sleeper cannot answer — drive length is not one of
// its 228 stat keys — so it reaches for nflverse play-by-play. That is a second source on a
// different release cadence, so it is strictly optional: any failure here voids that one card
// and every other award still publishes.
let drives = null;
if (!has('no-drives')) {
  try {
    drives = await pbp.longestTdDrives(season, week, { ...cacheOpts, games: gate.games });
    const span = drives.games ? ` across ${drives.games} games` : '';
    console.error(`  drives: ${drives.tdDrives} TD drives${span}, ${drives.qbs} QBs credited` +
      (drives.unattributed ? `, ${drives.unattributed} with no pass attempt to credit` : '') +
      (drives.unmapped ? `, ${drives.unmapped} unmapped` : ''));
  } catch (e) { console.error(`  play-by-play unavailable (${e.message}); the drive award will void`); }
}

// Kickoff times for the race under the wheel. Optional, like the play-by-play: without them
// the race still runs, with every Sunday game in one window.
let kick = null;
try { kick = await api.kickoffs(season, fresh); }
catch (e) { console.error(`  kickoff times unavailable (${e.message}); the race runs on game days only`); }

// Only needed to position benched players who recorded no stat line.
let playersDex = null;
try { playersDex = await api.players(fresh); } catch { console.error('  player dictionary unavailable; bench awards may be partial'); }

const ctx = buildTeams({ leagueInfo, rosters, users, matchups, statRows, projRows, playersDex });

// A page to show strangers: the real week's real numbers under made-up team names, so a
// screenshot or a shared demo says nothing about who is in the league. Names go on by roster
// order, before anything is computed, so every board, the wheel and the ledger agree.
if (has('fake-names')) {
  const FAKE = ['Hail Mary Poppins', 'Kelce Grammer', 'Dak to the Future', 'Hurts So Good', 'Bijan Mustard', 'Mahomes Alone',
    'Saquon for the Team', 'Goff Balls', 'Nacua Matata', 'Fields of Dreams', 'Waddle Waddle', 'Baby Got Dak',
    'Lamb Chops', 'Chubb Hub', 'Pitts and Giggles', 'Stroud Boys'];
  ctx.teams.slice().sort((a, b) => a.rosterId - b.rosterId)
    .forEach((t, i) => { t.name = FAKE[i % FAKE.length] + (i >= FAKE.length ? ` ${Math.floor(i / FAKE.length) + 1}` : ''); t.ownerId = null; });
  leagueInfo.name = LEAGUE.name;
}
ctx.scoring = leagueInfo.scoring_settings;
ctx.hasProjections = projRows.length > 0;
ctx.drives = drives;
ctx.games = api.weekGames(sched, kick, week);
if (prevPoints.size) ctx.prevPoints = prevPoints;

// Sanity check: our scoring of raw stats should reproduce Sleeper's own starters_points.
let checked = 0, drift = 0;
for (const t of ctx.teams) for (const s of t.starters) {
  if (!ctx.stats[s.pid]) continue;
  checked++;
  if (Math.abs(scoreWith(ctx.scoring, ctx.stats[s.pid]) - s.points) > 0.5) drift++;
}
console.error(`  scoring check: ${checked - drift}/${checked} starters reproduce Sleeper's points`);

const missing = ctx.teams.flatMap((t) => t.starters.filter((s) => !s.played).map((s) => `${t.name}: ${s.name}`));
console.error(`  ${ctx.teams.length} teams, ${ctx.teams.reduce((a, t) => a + t.starters.length, 0)} starters, ${missing.length} without a stat line`);

// The ledger is opened before anything is computed, because on one kind of week it changes
// what gets computed at all. See `catalogue` below.
const LEDGER = 'wheel.json';
let ledger = { draws: [] };
try { ledger = canonicalLedger(JSON.parse(await readFile(LEDGER, 'utf8'))); } catch {}
const recorded = ledger.draws.find((d) => d.season === Number(season) && d.week === week);

// Only the prizes the league currently plays for are computed — a retired award must not
// reappear on a page or, worse, in the wheel's pool. The single exception is a past week that
// already paid out a prize since retired: that week's page has to go on naming the prize it
// drew, so the retired award is computed for this one week and no other.
const catalogue = [...PLAYED];
if (recorded && !catalogue.some((a) => a.id === recorded.pick)) {
  const retired = AWARDS.find((a) => a.id === recorded.pick);
  if (retired) {
    catalogue.push(retired);
    console.error(`  ${retired.id} is retired, but it paid out this week — computing it anyway`);
  }
}

const results = computeAwards(ctx, catalogue);
const live = results.filter((r) => !r.voided);
console.error(`  ${live.length}/${results.length} awards produced a board`);

// The wheel.
//
// A live week is NOT drawn here any more. The prize is sealed by the server the first time
// somebody opens the page, and stays sealed until the manager signs in and spins for it — so
// a draw at build time would be a second, competing answer written into the ledger hours
// before the real one exists. What the build publishes instead is the pool and what every
// prize in it would pay, which is everything the page needs to land on whichever prize the
// server eventually opens. See api/wheel.js.
//
// `--demo` keeps the original score-seeded draw, because that is exactly what the demo weeks
// are demonstrating: a week already in the ledger is replayed rather than re-drawn, so
// rebuilding an old week cannot rewrite what it paid.
let draw = null;
let fresh_draw = false;
if (recorded) {
  draw = recorded;
  console.error(`  wheel: replaying recorded draw -> ${draw.pick}`);
} else if (has('demo') && live.length) {
  const drawn = ledger.draws.filter((d) => d.season === Number(season)).map((d) => d.pick);
  draw = spin({ season: Number(season), week, teams: ctx.teams, eligible: live.map((r) => r.id), drawn });
  fresh_draw = gate.final;
  if (!gate.final) console.error(`  wheel: ${draw.pick} (provisional — not recorded until the week is final)`);
} else if (!gate.final) {
  console.error(`  wheel: week is not final, so no prize is offered for sealing`);
} else {
  console.error(`  wheel: sealed server-side; whoever spins first opens it at /weeks/${season}-week-${week}`);
}
const drawnAward = draw ? results.find((r) => r.id === draw.pick) : null;

// What the prize actually paid, written into the ledger beside the draw that chose it.
//
// The prize board at /awards is built from wheel.json alone. Without this it could say which
// week each prize was drawn and never who took it, since the only other record of that is the
// built week page — twelve megabytes of HTML to re-parse for one name. Ties and the split
// prize both put more than one team on a prize, so a winner is always a list.
//
// The moment the next week's first game kicks off, as one absolute instant.
//
// It has to be absolute. A bare date closes the week at whatever midnight the reader's own
// clock says, which is a different moment in Denver than in New York and roughly twenty hours
// before the game either way. Kickoff times come off nflverse in US Eastern, so the offset is
// read for that date rather than assumed — the season runs across the end of daylight saving,
// and hardcoding -04:00 would be an hour out from November onward.
function kickoffInstant(game) {
  const offset = (day) => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${day}T17:00:00Z`)).find((p) => p.type === 'timeZoneName').value;
    return name.replace('GMT', '') || '+00:00';       // "GMT-04:00" -> "-04:00"
  };
  // Without a kickoff time, midnight Eastern on the game's own date. Still one instant for
  // everybody, just an earlier one than the whistle.
  return `${game.date}T${game.time || '00:00'}:00${offset(game.date)}`;
}

// Recorded on exactly the same rule as the draw: a final week only. A provisional week's
// scores are still moving, so its winner could still change.
function winnerOf(award) {
  if (!award || award.voided || !award.rows?.length) return null;
  const top = award.rows[0];
  // Level on the prize is NOT the same as tied for it. compute.js already settled this board
  // with the prize's own tiebreak — rows carry the tiebreak value in `tb` and are sorted by
  // it — so a winner is a row level on the prize AND level on the tiebreak. Filtering on
  // value alone re-opens a tie the report has already broken, and writes every team that
  // merely matched the number into the ledger as a winner, while the week page names one.
  const teams = top.split || award.rows.filter((r) => r.value === top.value && r.tb === top.tb).map((r) => r.team);
  return {
    teams,
    value: top.value,
    // Copied, not looked up at display time: this is a record of what was handed out that
    // week, and a blurb or a unit edited next season must not rewrite it.
    unit: award.unit || '',
    name: award.name,
    tied: !top.split && teams.length > 1,
    split: Boolean(top.split),
  };
}

const byWeek = (a, b) => a.season - b.season || a.week - b.week;
async function writeLedger() {
  ledger.draws.sort(byWeek);
  if (ledger.pending) ledger.pending.sort(byWeek);
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
}

// A live week goes into the ledger with everything except an answer: the pool its prize will
// be drawn from, and what each prize in that pool would pay if it came up. The prize board
// lists the week as sealed off this, then asks /api/wheel whether the manager has spun yet —
// which is the only place the answer ever exists.
if (!has('demo') && !recorded && gate.final) {
  const winners = {};
  for (const r of live) winners[r.id] = winnerOf(r);
  // The pool may GROW on a rebuild but must never shrink. By the time anyone rebuilds a week,
  // the server may already have sealed a prize drawn from the pool published the first time —
  // and that seal is permanent. Dropping an id the seal could have landed on leaves the page
  // unable to find the wedge for its own answer, so the published pool is the union.
  const prior = (ledger.pending || []).find((p) => p.season === Number(season) && p.week === week);
  const pool = [...new Set([...(prior?.pool || []), ...live.map((r) => r.id)])];
  if (prior && pool.length > prior.pool.length) {
    console.error('  wheel: pool grew ' + prior.pool.length + ' -> ' + pool.length + '; the sealed draw is unaffected');
  }
  ledger.pending = (ledger.pending || []).filter((p) => !(p.season === Number(season) && p.week === week));
  ledger.pending.push({ season: Number(season), week, pool, winners, builtAt: new Date().toISOString() });
  await writeLedger();
  console.error(`  wheel: ${pool.length} eligible prizes published for the board`);
}

if (fresh_draw) {
  draw.winner = winnerOf(drawnAward);
  ledger.draws.push(draw);
  await writeLedger();
  console.error(`  wheel: drew ${draw.pick} from ${draw.pool.length} eligible -> recorded` +
    (draw.winner ? ` (${draw.winner.teams.join(' & ')})` : ''));
} else if (gate.final && recorded && !recorded.winner) {
  // Draws recorded before the prize board existed have no winner on them. Rebuilding one of
  // those weeks fills it in without touching the draw itself.
  const winner = winnerOf(drawnAward);
  if (winner) {
    recorded.winner = winner;
    await writeLedger();
    console.error(`  wheel: backfilled winner -> ${winner.teams.join(' & ')}`);
  }
}

if (has('text')) {
  if (drawnAward) {
    console.log(`\n=== THE WHEEL: ${drawnAward.name} ===`);
    console.log(`  ${drawnAward.blurb}`);
    const win = drawnAward.rows[0];
    console.log(`  WINNER: ${win.team} — ${win.value}${drawnAward.unit ? ' ' + drawnAward.unit : ''}`);
    console.log(`  seed ${draw.seed.slice(0, 16)}... from ${draw.pool.length} eligible prizes`);
  }
  for (const r of results) {
    if (r.voided) { console.log(`\n${r.name} — unavailable (${r.voided})`); continue; }
    const unit = r.unit ? ` ${r.unit}` : '';
    const tie = r.tied ? '  [TIE]' : r.tieBroken ? `  [tie broken on ${r.tieBroken}]` : '';
    console.log(`\n${r.name}${tie} — ${r.blurb}`);
    r.rows.slice(0, 3).forEach((row, i) => {
      const who = row.detail?.length ? `  (${row.detail.map((d) => `${d.name} ${d.value}`).join(', ')})` : '';
      console.log(`  ${i + 1}. ${row.value}${unit}  ${row.team}${who}`);
    });
  }
} else {
  // Optional: headshots and club marks, generated by assets.py. Without it the page still
  // renders, just without faces.
  let assets = null;
  try { assets = JSON.parse(await readFile('assets.json', 'utf8')); }
  catch { console.error('  no assets.json — run assets.py for headshots and club marks'); }
  // assets.json is gitignored and written to one fixed path, so backfilling an older season
  // leaves that season's copy sitting there for the next build to pick up. A stale headshot is
  // only a missing face, but a team picture belongs to a LEAGUE: last year's set prints a
  // departed manager's face on the roll call and leaves a new manager blank. So a mismatched
  // or unstamped league gives up its avatars rather than passing off last season's twelve.
  if (assets && assets.built?.league !== leagueId) {
    const from = assets.built ? `league ${assets.built.league} (${assets.built.season} week ${assets.built.week})` : 'an unrecorded league';
    console.error(`  assets.json was built for ${from}, not ${leagueId} — dropping its team pictures.`);
    console.error(`  Re-run: python3 assets.py --season ${season} --week ${week} --league ${leagueId}`);
    assets = { ...assets, avatars: {} };
  }
  if (assets) console.error(`  ${Object.keys(assets.players).length} faces, ${Object.keys(assets.teams).length} crests, ${Object.keys(assets.avatars || {}).length} team pictures`);

  // Three kinds of page, and only one of them gets a sealable wheel:
  //
  //   already drawn   a week in the ledger renders the prize it drew, whether or not --demo
  //                   is passed. Rebuilding week 2 must not replace its answer with a lock.
  //   not final       no wheel at all. A sealed prize is permanent, and the first visitor to
  //                   a --force build would fix the week off scores that are still moving.
  //   live and final  the sealed wheel — see liveWheel() in render.js and api/wheel.js.
  const liveWeek = !has('demo') && !recorded && gate.final;
  // When this week's page stops being spinnable. Everyone gets to turn the wheel for
  // themselves while the week is the current one — the prize is the same for all of them, so
  // there is nothing to protect by letting only the first person watch it turn. Once the next
  // week kicks off this one is history, and the page settles into what it paid. A season's
  // last week has no next kickoff and simply never locks.
  const nextWeek = api.weekGames(sched, kick, week + 1);
  const lock = nextWeek.length ? kickoffInstant(nextWeek[0]) : null;
  // What the wheel has already paid this season, for the card beside it.
  const drawn = ledger.draws
    .filter((d) => d.season === Number(season) && d.week < week)
    .map((d) => ({ week: d.week, id: d.pick, name: AWARDS.find((a) => a.id === d.pick)?.name || d.pick }));
  const html = renderHTML({ results, ctx, leagueInfo, season, week, gate, assets,
    draw, drawnAward, demo: has('demo'), liveWeek, drawn, lock,
    generatedAt: new Date().toISOString() });
  const out = flag('out', `weeks/${season}-week-${week}.html`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html);
  console.error(`  wrote ${out}`);
}
