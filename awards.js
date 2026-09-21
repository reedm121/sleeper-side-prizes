// The award glossary, and what this league plays for out of it.
//
// Two things live here and they are deliberately separate:
//
//   GLOSSARY   every prize this project knows how to compute, under a generic name. Adding a
//              prize means adding one row here — and nothing else, if it uses an aggregation
//              compute.js already has. This list belongs to the project, not to any league.
//   AWARDS     the glossary as THIS league sees it: house prizes moved up under their own
//              heading, custom names applied, and everything the league does not play for
//              marked `out`. Read from league.json (see lib/league.js).
//
// IDS ARE PERMANENT. An id keys the season ledger (wheel.json), the sealed draws in Redis, the
// badge art files and every saved shortlist verdict. Rename the NAME freely. If an id really
// must change, add the old one to LEGACY_IDS in lib/ids.js — everything that reads an id from
// storage passes it through `canonical()`, so history written under the old id keeps resolving.
//
// Each row declares how it aggregates, which positions it can draw from, and when it should
// refuse to publish a result:
//
// agg:
//   sum          add keys across a team's starters
//   max          take the best single starter — NEVER sum a *_lng key
//   count        how many starters satisfy `where` — { key, gte } on a stat, or { field, lte } on a
//                starter field such as points
//   ratio        num/den, gated on `min`
//   points       from starters_points, no stats join needed; mode sum | max | min
//   slot         points from named lineup slots only
//   delta        this week's team score minus last week's
//   luckyLoser   highest score among teams that lost;  luckyWinner  lowest score among teams that won
//   closest      the matchup with the smallest margin — both teams split it
//   shootout     the matchup with the most combined points — both teams split it
//   margin       the widest winning margin
//   shareOfTeam  one starter's points as a share of the team's
//   projDelta    actual minus projected, scored with the league's own settings; mode team | max | min
//   bench        from the full roster; mode beast | left | optimal | pct | total
//   drive        needs nflverse play-by-play (drives.js); voids on its own if that is missing
//
// dir: 'desc' unless lower is better. `min` gates ratio awards so a one-target sample cannot
// win. `void` marks awards whose stat can vanish league-wide for a whole week (2025 wk18 has
// rush_yac on zero rows and has never backfilled). `core` marks the set `npm run setup` offers
// as a starting point — the ones that settle cleanly and rarely tie.

import { LEAGUE, mentionedIds } from './lib/league.js';
import { canonical } from './lib/ids.js';

export { canonical, LEGACY_IDS } from './lib/ids.js';

const A = (id, name, blurb, cfg) => ({ id, name, blurb, dir: 'desc', ...cfg });

// The glossary's own sections. Tier 0 is reserved for the league's house prizes and is filled
// in below from league.json; a glossary row never declares it.
export const TIERS = {
  0: { name: LEAGUE.houseLabel, note: '' },
  1: { name: 'Team Score & Matchup', note: 'What your lineup scored, or what it scored against something else.' },
  2: { name: 'The Big Ones', note: 'Yardage, volume and scoring. These settle cleanly and rarely tie.' },
  3: { name: 'Kickers & Defense', note: '' },
  4: { name: 'Fun & Degenerate', note: 'Some rely on charting data that can go dark for a week.' },
  5: { name: 'Shame', note: 'Lowest wins. Hand these out with care.' },
  6: { name: 'Versus Projection', note: 'Projections rescored with your league settings.' },
  7: { name: 'Lineup Management', note: 'What you started against what you could have.' },
};

export const GLOSSARY = [
  // ---- Team score & matchup ------------------------------------------------------------
  A('high_score', 'Scoreboard', 'Every one of your starters added up — highest team score of the week', { tier: 1, agg: 'points', mode: 'sum', unit: 'pts', core: true }),
  A('low_score', 'The Basement', 'Every one of your starters added up — lowest team score of the week', { tier: 5, agg: 'points', mode: 'sum', dir: 'asc', unit: 'pts' }),
  A('swing_down', 'Crash and Burn', 'Your team score this week minus last week — the biggest fall', { tier: 1, agg: 'delta', dir: 'asc', unit: 'pts' }),
  A('swing_up', 'Not Dead Yet', 'Your team score this week minus last week — the biggest climb', { tier: 1, agg: 'delta', unit: 'pts', core: true }),
  A('best_loser', 'Unlucky Schedule', 'Of the teams that lost their matchup, the one that scored most', { tier: 1, agg: 'luckyLoser', unit: 'pts', core: true }),
  A('escape', 'Escape Artist', 'Of the teams that won their matchup, the one that scored least', { tier: 1, agg: 'luckyWinner', dir: 'asc', unit: 'pts' }),
  A('closest', 'Photo Finish', 'The matchup decided by the smallest margin — both teams split it', { tier: 1, agg: 'closest', dir: 'asc', unit: 'pts', split: true, core: true }),
  A('blowout', 'Curb Stomp', 'The matchup decided by the widest margin — the winner takes it', { tier: 1, agg: 'margin', unit: 'pts' }),
  A('shootout', 'Shootout', 'The matchup with the most combined points — both teams split it', { tier: 1, agg: 'shootout', unit: 'pts', split: true }),
  A('share_of_team', 'Carried', 'One starter’s points as a share of their whole team’s score', { tier: 1, agg: 'shareOfTeam', unit: '%', core: true }),
  A('flex', 'Flex Appeal', 'Points from your flex slots alone', { tier: 1, agg: 'slot', slots: ['FLEX', 'WRRB_FLEX', 'REC_FLEX', 'SUPER_FLEX'], unit: 'pts' }),

  // ---- The big ones --------------------------------------------------------------------
  A('top_starter', 'Highest-Scoring Starter', 'Fantasy points of your single best starter', { tier: 2, agg: 'points', mode: 'max', unit: 'pts', core: true }),
  A('qb_pts', 'Quarterback Room', 'Fantasy points from your starting quarterbacks', { tier: 2, agg: 'points', mode: 'sum', pos: ['QB'], unit: 'pts' }),
  A('rb_pts', 'The Backfield', 'Fantasy points from your starting running backs', { tier: 2, agg: 'points', mode: 'sum', pos: ['RB'], unit: 'pts' }),
  A('wr_pts', 'Receiving Corps', 'Fantasy points from your starting wide receivers', { tier: 2, agg: 'points', mode: 'sum', pos: ['WR'], unit: 'pts' }),
  A('te_pts', 'Tight End Room', 'Fantasy points from your starting tight ends', { tier: 2, agg: 'points', mode: 'sum', pos: ['TE'], unit: 'pts' }),
  A('rec_yd', 'Air Raid', 'Receiving yards added up across all your starters', { tier: 2, agg: 'sum', keys: ['rec_yd'], unit: 'yd', core: true }),
  A('pass_yd', 'Gunslinger', 'Passing yards added up across all your starters — normally just your quarterback', { tier: 2, posTag: 'QB', agg: 'sum', keys: ['pass_yd'], unit: 'yd', core: true }),
  A('rush_yd', 'Ground Game', 'Rushing yards added up across all your starters, quarterback scrambles included', { tier: 2, agg: 'sum', keys: ['rush_yd'], unit: 'yd', core: true }),
  A('scrimmage', 'Yards From Scrimmage', 'Rushing plus receiving yards added up across all your starters', { tier: 2, agg: 'sum', keys: ['rush_rec_yd'], unit: 'yd', core: true }),
  A('pass_td', 'Touchdown Passes', 'Touchdown passes thrown by your starting quarterbacks', { tier: 2, posTag: 'QB', agg: 'sum', keys: ['pass_td'], unit: '' }),
  A('td_rush_rec', 'Touchdown Club', 'Rushing and receiving touchdowns added up across all your starters — passing touchdowns do not count', { tier: 2, agg: 'sum', keys: ['rush_td', 'rec_td'], unit: '', core: true }),
  A('rec', 'Stickies', 'Catches added up across all your starters', { tier: 2, agg: 'sum', keys: ['rec'], unit: '', core: true }),
  A('first_downs', 'Chain Movers', 'First downs your starters picked up, on the ground and through the air', { tier: 2, agg: 'sum', keys: ['rush_fd', 'rec_fd'], unit: '' }),
  A('rush_att', 'Bell Cow', 'Most carries by one starting running back — backs only', { tier: 2, agg: 'max', keys: ['rush_att'], pos: ['RB'], unit: '', core: true }),
  A('rush_yd_one', 'Workhorse', 'Most rushing yards by one starting running back — backs only', { tier: 2, agg: 'max', keys: ['rush_yd'], pos: ['RB'], unit: 'yd' }),
  A('rec_yd_one', 'Alpha Receiver', 'Most receiving yards by one starter — any position', { tier: 2, agg: 'max', keys: ['rec_yd'], unit: 'yd' }),
  A('rec_tgt_one', 'Target Hog', 'Most targets by one starter', { tier: 2, agg: 'max', keys: ['rec_tgt'], unit: '' }),
  A('rec_one', 'Possession Receiver', 'Most catches by one starter', { tier: 2, agg: 'max', keys: ['rec'], unit: '' }),
  A('qb_rush', 'Dual Threat', 'Rushing yards by your starting quarterbacks', { tier: 2, posTag: 'QB', pos: ['QB'], agg: 'sum', keys: ['rush_yd'], unit: 'yd' }),
  A('te_yd', 'Y Not', 'Receiving yards by your starting tight ends', { tier: 2, pos: ['TE'], agg: 'sum', keys: ['rec_yd'], unit: 'yd' }),
  A('rb_rec', 'Pass-Catching Back', 'Catches by your starting running backs', { tier: 2, pos: ['RB'], agg: 'sum', keys: ['rec'], unit: '' }),
  A('hundred', 'Century Club', 'How many of your starters went for 100 yards rushing or receiving', { tier: 2, agg: 'count', where: { key: 'rush_rec_yd', gte: 100 }, unit: '' }),
  A('scorers', 'Everybody Eats', 'How many of your starters scored a touchdown of any kind', { tier: 2, agg: 'count', where: { key: 'anytime_tds', gte: 1 }, posNot: ['DEF'], unit: '' }),

  // Longest plays. NEVER sum a *_lng key.
  //
  // No `pass_td_lng`. A 40-yard touchdown pass is one play but two stat lines — the thrower's
  // and the catcher's — so counting the throw would have the quarterback and the receiver post
  // the same number, and two teams holding either end of one score would tie. The ball
  // carrier scores it, so the catcher gets the credit and the passer gets none.
  A('td_lng', 'Longest Touchdown', 'Longest single touchdown by one of your starters, credited to whoever carried it in — a run or a catch, never the passer', { tier: 2, agg: 'max', keys: ['rush_td_lng', 'rec_td_lng'], unit: 'yd', core: true }),
  A('rec_lng_wr', 'Bombs Away: WR Edition', 'Longest single catch by one starting wide receiver — receivers only, not backs or tight ends', { tier: 2, agg: 'max', keys: ['rec_lng'], pos: ['WR'], unit: 'yd', core: true }),
  A('pass_lng', 'Bombs Away: QB Edition', 'Longest single completion by one starting quarterback, measured to where the play ended', { tier: 2, posTag: 'QB', agg: 'max', keys: ['pass_lng'], unit: 'yd', core: true }),
  A('rush_lng_rb', 'Breakaway', 'Longest single carry by one starting running back — backs only', { tier: 2, agg: 'max', keys: ['rush_lng'], pos: ['RB'], unit: 'yd', core: true }),
  // The only prize Sleeper cannot answer: drive length is not one of its 228 stat keys, so this
  // one alone reaches for play-by-play via drives.js. It therefore has a failure mode none of
  // the others have — a missing nflverse release voids this card while every other prize still
  // settles. `--no-drives` skips it.
  A('drive_lng', 'Now Watch This Drive', 'The longest touchdown drive your starting quarterback marched — measured from where his offense first got the ball', { tier: 2, posTag: 'QB', pos: ['QB'], agg: 'drive', unit: 'yd' }),

  // ---- Kickers & defense ---------------------------------------------------------------
  A('fgm_lng', 'Big Leg', 'Longest single field goal made by your starting kicker', { tier: 3, agg: 'max', keys: ['fgm_lng'], pos: ['K'], unit: 'yd', core: true }),
  A('fgm_yds', 'Leg Day', 'Every field goal your kicker made, distances added together', { tier: 3, agg: 'sum', keys: ['fgm_yds'], pos: ['K'], unit: 'yd', core: true }),
  A('fg_made', 'Automatic', 'Field goals made by your starting kicker', { tier: 3, agg: 'sum', keys: ['fgm'], pos: ['K'], unit: '' }),
  A('fg_50', 'Long Range', 'Field goals of 50 yards or more made by your starting kicker', { tier: 3, agg: 'sum', keys: ['fgm_50p'], pos: ['K'], unit: '' }),
  A('kick_pts', 'Leg Points', 'Every point your kicker put on the board — field goals and extra points together', { tier: 3, agg: 'sum', keys: ['kick_pts'], pos: ['K'], unit: '' }),
  A('def_takeaways', 'Turnover Machine', 'Interceptions plus fumble recoveries by your starting defense — ties go to the higher scoring defense', { tier: 3, agg: 'sum', keys: ['int', 'fum_rec'], pos: ['DEF'], unit: '', tiebreak: { agg: 'points', mode: 'max', keys: null }, core: true }),
  A('def_int', 'Ball Hawks', 'Interceptions by your starting defense', { tier: 3, agg: 'sum', keys: ['int'], pos: ['DEF'], unit: '' }),
  A('def_sack', 'Sack Attack', 'Sacks by your starting defense', { tier: 3, agg: 'sum', keys: ['sack'], pos: ['DEF'], unit: '', core: true }),
  A('def_td', 'Defense Wins Championships', 'Touchdowns scored by your starting defense', { tier: 3, agg: 'sum', keys: ['def_td'], pos: ['DEF'], unit: '' }),
  A('def_pts', 'Defensive Points', 'Fantasy points scored by your starting defense', { tier: 3, agg: 'points', mode: 'sum', pos: ['DEF'], unit: 'pts' }),
  A('pts_allow', 'Bend Don’t Break', 'Points your starting defense gave up — fewest wins', { tier: 3, agg: 'sum', keys: ['pts_allow'], pos: ['DEF'], dir: 'asc', unit: '' }),
  A('yds_allow', 'Brick Wall', 'Yards your starting defense gave up — fewest wins', { tier: 3, agg: 'sum', keys: ['yds_allow'], pos: ['DEF'], dir: 'asc', unit: 'yd' }),
  A('def_3out', 'Three And Out', 'Three-and-outs forced by your starting defense', { tier: 3, agg: 'sum', keys: ['def_3_and_out'], pos: ['DEF'], unit: '', void: true }),
  A('def_ret_yd', 'Return Game', 'Kick and punt return yards by your starting defense', { tier: 3, agg: 'sum', keys: ['def_kr_yd', 'def_pr_yd'], pos: ['DEF'], unit: 'yd' }),

  // ---- Fun & degenerate. Several draw on charting data that can go dark for a week. -------
  A('yac', 'YAC Attack', 'Yards gained after the catch, all your starters', { tier: 4, agg: 'sum', keys: ['rec_yar'], unit: 'yd', void: true }),
  A('rush_yac', 'Through Contact', 'Rushing yards gained after first contact — backs, receivers and quarterbacks all count', { tier: 4, pos: ['RB', 'WR', 'QB'], agg: 'sum', keys: ['rush_yac'], unit: 'yd', void: true }),
  A('btkl', 'Bulldozer', 'Tackles broken on running plays by your starting backs', { tier: 4, pos: ['RB'], agg: 'sum', keys: ['rush_btkl'], unit: '', void: true }),
  A('explosive', 'Explosive Plays', 'Plays that gained 40 yards or more, all your starters', { tier: 4, agg: 'sum', keys: ['rush_40p', 'rec_40p', 'pass_cmp_40p'], unit: '' }),
  A('rz', 'Red Zone Hogs', 'Carries and targets inside the opponent’s 20, all your starters', { tier: 4, agg: 'sum', keys: ['rush_rz_att', 'rec_rz_tgt', 'pass_rz_att'], unit: '' }),
  A('first_td', 'First Blood', 'How many of your starters scored the opening touchdown of their own game', { tier: 4, agg: 'sum', keys: ['first_td'], unit: '' }),
  A('two_pt', 'Going For Two', 'Two-point conversions by your starters — thrown, run or caught. Rare: most weeks nobody has one', { tier: 4, agg: 'sum', keys: ['pass_2pt', 'rush_2pt', 'rec_2pt'], unit: '' }),
  A('air_yd', 'Air Yards', 'Passing yards your quarterback threw through the air, before the catch', { tier: 4, posTag: 'QB', agg: 'sum', keys: ['pass_air_yd'], unit: 'yd', void: true }),
  A('kr_yd', 'Special Teamer', 'Kick and punt return yards by your offensive starters', { tier: 4, agg: 'sum', keys: ['kr_yd', 'pr_yd'], posNot: ['DEF'], unit: 'yd' }),
  A('snaps', 'Iron Men', 'Offensive snaps played, all your starters added together', { tier: 4, agg: 'sum', keys: ['off_snp'], unit: '', void: true }),
  A('idp_tkl', 'Accidental Defender', 'Tackles made by your offensive starters, usually right after a turnover', { tier: 4, agg: 'sum', keys: ['idp_tkl'], posNot: ['DEF'], unit: '' }),
  A('rating', 'Under Center', 'Passer rating of your starting quarterback — needs 10 attempts to qualify', { tier: 4, posTag: 'QB', agg: 'ratio', num: ['pass_rtg'], den: null, min: { key: 'pass_att', value: 10 }, unit: '' }),
  A('ypt', 'Yards Per Target', 'Your starting receivers’ yards divided by their targets — needs 20 targets', { tier: 4, pos: ['WR'], agg: 'ratio', num: ['rec_yd'], den: ['rec_tgt'], min: { key: 'rec_tgt', value: 20 }, unit: '' }),
  A('ypc', 'Yards Per Touch', 'Your starting backs’ yards divided by their touches — needs 10 carries', { tier: 4, pos: ['RB'], agg: 'ratio', num: ['rush_yd', 'rec_yd'], den: ['rush_att', 'rec'], min: { key: 'rush_att', value: 10 }, unit: '' }),

  // ---- Shame ---------------------------------------------------------------------------
  A('fum', 'Butterfingers', 'Fumbles, lost or recovered, all your starters', { tier: 5, agg: 'sum', keys: ['fum', 'fum_lost'], unit: '' }),
  A('drops', 'Stone Hands', 'Passes dropped by your starting wide receivers', { tier: 5, agg: 'sum', keys: ['rec_drop'], pos: ['WR'], unit: '', void: true }),
  A('sacked', 'Sack Sponge', 'Times your starting quarterback was sacked', { tier: 5, posTag: 'QB', agg: 'sum', keys: ['pass_sack'], unit: '' }),
  A('ints', 'Picked Off', 'Interceptions thrown by your starting quarterback', { tier: 5, posTag: 'QB', agg: 'sum', keys: ['pass_int'], unit: '' }),
  A('stuffed', 'Stuffed', 'Carries your starting backs were stopped behind the line on', { tier: 5, pos: ['RB'], agg: 'sum', keys: ['rush_tkl_loss'], unit: '', void: true }),
  A('fg_miss', 'Wide Right', 'Field goals and extra points your starting kicker missed', { tier: 5, agg: 'sum', keys: ['fgmiss', 'xpmiss'], pos: ['K'], unit: '' }),
  // The one award that catches a started bye-week or inactive player. Projection deltas do not.
  A('corpses', 'Corpse In The Lineup', 'The lowest scoring player anyone started — defenses excluded, they can go negative', { tier: 5, agg: 'points', mode: 'min', posNot: ['DEF'], dir: 'asc', unit: 'pts', zeroIsReal: true }),
  A('zeros', 'Goose Eggs', 'How many of your starters scored zero or less', { tier: 5, agg: 'count', where: { field: 'points', lte: 0 }, posNot: ['DEF'], unit: '', zeroIsReal: true }),

  // ---- Versus projection. Needs the projections endpoint. ------------------------------
  A('bust_team', 'Biggest Bust', 'Your lineup’s actual points minus its projection — furthest below', { tier: 6, agg: 'projDelta', mode: 'team', dir: 'asc', unit: 'pts', needsProj: true }),
  A('boom_team', 'Biggest Boom', 'Your lineup’s actual points minus its projection — furthest above', { tier: 6, agg: 'projDelta', mode: 'team', unit: 'pts', needsProj: true }),
  A('boom', 'Individual Boom', 'The one starter who beat their own projection by the most', { tier: 6, agg: 'projDelta', mode: 'max', unit: 'pts', needsProj: true }),
  A('bust_player', 'Individual Bust', 'The one starter who missed their own projection by the most', { tier: 6, agg: 'projDelta', mode: 'min', dir: 'asc', unit: 'pts', needsProj: true }),

  // ---- Lineup management ---------------------------------------------------------------
  A('bench_best', 'Unsung Hero', 'The single highest scoring player you left on your bench', { tier: 7, agg: 'bench', mode: 'beast', unit: 'pts', core: true }),
  A('bench_pts', 'Points Left On The Bench', 'What your best legal lineup would have scored, minus what you actually started', { tier: 7, agg: 'bench', mode: 'left', unit: 'pts' }),
  A('optimal', 'Perfect Lineup', 'What your best legal lineup would have scored, bench included', { tier: 7, agg: 'bench', mode: 'optimal', unit: 'pts' }),
  A('efficiency', 'Lineup IQ', 'What you actually started as a share of your best possible lineup', { tier: 7, agg: 'bench', mode: 'pct', unit: '%' }),
  A('bench_total', 'Deep Bench', 'Every point your bench scored, added up', { tier: 7, agg: 'bench', mode: 'total', unit: 'pts' }),
];

// ---------------------------------------------------------------------------
// WHAT THIS LEAGUE PLAYS FOR
//
// league.json names the house prizes, the rest of the prizes, and any names of its own. Applied
// here so that every other file keeps reading AWARDS / PLAYED / HOUSE exactly as before:
//
//   AWARDS   the whole glossary, custom names applied, house rows moved to tier 0, and every
//            prize the league does not play for marked `out`. A retired award has to stay in
//            AWARDS so /shortlist keeps showing it and /api/state keeps accepting its verdict.
//   PLAYED   what the rest of the project runs on: what gets computed, what gets rendered, and
//            — the one that matters — the only thing the wheel can draw. House first, in the
//            order league.json lists them, then the rest in glossary order.
//   HOUSE    the house prizes alone.
// ---------------------------------------------------------------------------

const byId = new Map(GLOSSARY.map((a) => [a.id, a]));

{
  const unknown = [...mentionedIds()].filter((id) => !byId.has(id));
  if (unknown.length) {
    const near = (id) => GLOSSARY.filter((a) => a.id.includes(id) || id.includes(a.id)).map((a) => a.id).slice(0, 3);
    const hints = unknown.map((id) => `  "${id}"${near(id).length ? `  (did you mean ${near(id).join(', ')}?)` : ''}`);
    throw new Error(`league.json names prizes that are not in the glossary:\n${hints.join('\n')}\nRun \`node setup.js --list\` to see every id.`);
  }
}

const houseIds = new Set(LEAGUE.house);
const playedIds = new Set([
  ...LEAGUE.house,
  ...(LEAGUE.prizes === 'all' ? GLOSSARY.map((a) => a.id) : LEAGUE.prizes),
]);

function applied(a) {
  const custom = LEAGUE.custom[a.id] || {};
  return {
    ...a,
    ...(typeof custom.name === 'string' && custom.name.trim() ? { name: custom.name.trim() } : {}),
    ...(typeof custom.blurb === 'string' && custom.blurb.trim() ? { blurb: custom.blurb.trim() } : {}),
    ...(houseIds.has(a.id) ? { tier: 0 } : {}),
    ...(playedIds.has(a.id) ? {} : { out: true }),
  };
}

export const HOUSE = LEAGUE.house.map((id) => applied(byId.get(id)));
const rest = GLOSSARY.filter((a) => !houseIds.has(a.id)).map(applied);
export const AWARDS = [...HOUSE, ...rest];
export const PLAYED = AWARDS.filter((a) => !a.out);

// ---------------------------------------------------------------------------
// WHAT PART OF THE GAME A PRIZE COMES OFF
//
// Grouped by the phase of play, not by position. `pos` is a hard filter on who can score it,
// NOT the phase: Through Contact is open to backs, receivers and quarterbacks and is, all
// three ways, a rushing prize. Where the filter matters the blurb already says so out loud —
// "backs only", "receivers only" — which is where that belongs, rather than in a chip.
//
// Read off the stat keys rather than declared per award, because the keys are the thing that
// cannot drift: a prize that starts summing `rec_yd` IS a receiving prize from that moment,
// whatever anyone remembered to write next to it.
// ---------------------------------------------------------------------------

/** Section order on /prizes. The three phases run together, then what spans them. */
export const PHASES = ['Team score', 'Passing', 'Rushing', 'Receiving', 'All-purpose', 'Kicking', 'Defense'];

// Short keys for the chip colours, so a stylesheet does not carry a space in a custom property.
export const PHASE_KEY = {
  Passing: 'pass', Rushing: 'rush', Receiving: 'rec', Kicking: 'kick', Defense: 'def',
};

/** Every stat key an award reads, wherever it declares it. */
export const statKeysOf = (a) => [
  ...(a.keys || []), ...(a.num || []), ...(a.den || []),
  ...(a.min?.key ? [a.min.key] : []), ...(a.where?.key ? [a.where.key] : []),
];

export function phaseOf(a) {
  const keys = statKeysOf(a).join(' ');
  // Defence and kicking are settled first, on the roster slot rather than the keys. A defence
  // that recovers a fumble scores `fum_rec`, which the receiving test below would otherwise
  // read as a catch.
  if (a.pos?.includes('DEF')) return 'Defense';
  if (a.pos?.includes('K')) return 'Kicking';
  const hit = [];
  if (/pass/.test(keys)) hit.push('Passing');
  if (/rush/.test(keys)) hit.push('Rushing');
  if (/rec(_|\b)/.test(keys)) hit.push('Receiving');
  if (hit.length === 1) return hit[0];
  // Yards From Scrimmage, Touchdown Club, Explosive Plays: it does not matter how you got it.
  if (hit.length > 1) return 'All-purpose';
  // No stat column to read. A quarterback-gated prize is still a passing prize however it is
  // computed — Now Watch This Drive walks the play-by-play instead of summing anything.
  if (a.posTag === 'QB' || a.pos?.[0] === 'QB') return 'Passing';
  // Stats that belong to no single phase. First Blood counts any opening touchdown, including
  // the ones the defence and the return team score.
  if (keys) return 'All-purpose';
  return 'Team score';
}

/**
 * The chip on a prize row, or null for the two groups that name no phase. A chip reading
 * "TEAM SCORE" next to a section headed Team score is just the heading again in a smaller box.
 */
export const phaseTag = (a) => (PHASE_KEY[phaseOf(a)] ? phaseOf(a).toUpperCase() : null);

/** The accent a prize is tinted with — its phase, or none for the two that have none. */
export const phaseHue = (a) => PHASE_KEY[phaseOf(a)] || null;
