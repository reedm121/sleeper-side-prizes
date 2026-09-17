// Every aggregation in compute.js against one small, hand-built week, so a change to the
// scoring rules has to say what it changed. Four teams, two matchups, a bench, and stat lines
// chosen so each prize has an unambiguous answer.
import { buildTeams, computeAwards } from '../compute.js';
import { GLOSSARY } from '../awards.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const leagueInfo = {
  roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'K', 'DEF', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 0.5, rec_yd: 0.1, rush_td: 6, rec_td: 6, fgm: 3, sack: 1, int: 2, def_td: 6 },
};
const users = [1, 2, 3, 4].map((n) => ({ user_id: `u${n}`, display_name: `Team ${n}`, metadata: {} }));
const rosters = [1, 2, 3, 4].map((n) => ({ roster_id: n, owner_id: `u${n}` }));

// Player ids: q=QB r=RB w=WR k=K, DEF by abbreviation, b=bench. Points are what Sleeper would
// report in starters_points; the stat lines below are what each did.
const P = (pid, pos, first, team) => ({ player_id: pid, team, opponent: 'OPP', player: { first_name: first, last_name: pos, fantasy_positions: [pos] } });
const statRows = [
  { ...P('q1', 'QB', 'Alpha', 'BUF'), stats: { pass_yd: 300, pass_td: 3, pass_lng: 60, rush_yd: 20, pass_att: 30, pass_rtg: 110, pass_fd: 12, pass_int: 1, pass_sack: 2 } },
  { ...P('q2', 'QB', 'Bravo', 'KC'),  stats: { pass_yd: 200, pass_td: 1, pass_lng: 25, rush_yd: 55, pass_att: 25, pass_rtg: 80, pass_int: 0, pass_sack: 4, rush_2pt: 1 } },
  { ...P('q3', 'QB', 'Charlie', 'DAL'), stats: { pass_yd: 250, pass_td: 2, pass_lng: 40, pass_att: 28, pass_rtg: 95 } },
  { ...P('q4', 'QB', 'Delta', 'SF'),  stats: { pass_yd: 150, pass_td: 0, pass_lng: 18, pass_att: 9, pass_rtg: 60, pass_int: 3 } },
  { ...P('r1', 'RB', 'Echo', 'BUF'),  stats: { rush_att: 22, rush_yd: 120, rush_lng: 45, rush_td: 1, rush_td_lng: 45, rec: 3, rec_yd: 20, rush_rec_yd: 140, rush_fd: 6, anytime_tds: 1, rush_tkl_loss: 2 } },
  { ...P('r2', 'RB', 'Foxtrot', 'KC'), stats: { rush_att: 10, rush_yd: 30, rush_lng: 9, rec: 8, rec_yd: 70, rec_tgt: 10, rush_rec_yd: 100, fum: 2, fum_lost: 1 } },
  { ...P('r3', 'RB', 'Golf', 'DAL'),  stats: { rush_att: 18, rush_yd: 80, rush_lng: 22, rec: 1, rec_yd: 5, rush_rec_yd: 85 } },
  { ...P('r4', 'RB', 'Hotel', 'SF'),  stats: { rush_att: 5, rush_yd: 12, rush_lng: 6, rush_rec_yd: 12 } },
  { ...P('w1', 'WR', 'India', 'MIA'), stats: { rec: 6, rec_yd: 110, rec_lng: 50, rec_tgt: 9, rec_td: 1, rec_td_lng: 50, rec_yar: 40, rush_rec_yd: 110, anytime_tds: 1, rec_fd: 5, rec_40p: 1 } },
  { ...P('w2', 'WR', 'Juliet', 'NYJ'), stats: { rec: 4, rec_yd: 45, rec_lng: 20, rec_tgt: 7, rec_drop: 2, rush_rec_yd: 45 } },
  { ...P('w3', 'WR', 'Kilo', 'PHI'),  stats: { rec: 9, rec_yd: 130, rec_lng: 38, rec_tgt: 12, rush_rec_yd: 130, rec_yar: 60 } },
  { ...P('w4', 'WR', 'Lima', 'LAR'),  stats: { rec: 2, rec_yd: 15, rec_lng: 10, rec_tgt: 3, rush_rec_yd: 15 } },
  { ...P('f1', 'TE', 'Mike', 'BAL'),  stats: { rec: 5, rec_yd: 60, rec_lng: 30, rec_tgt: 6, rush_rec_yd: 60 } },
  { ...P('f2', 'WR', 'November', 'DET'), stats: { rec: 3, rec_yd: 35, rec_lng: 15, rec_tgt: 4, rush_rec_yd: 35 } },
  { ...P('f3', 'RB', 'Oscar', 'GB'),  stats: { rush_att: 12, rush_yd: 50, rush_lng: 14, rec: 2, rec_yd: 10, rush_rec_yd: 60 } },
  { ...P('f4', 'TE', 'Papa', 'CIN'),  stats: { rec: 1, rec_yd: 8, rec_lng: 8, rec_tgt: 2, rush_rec_yd: 8 } },
  { ...P('k1', 'K', 'Quebec', 'BUF'), stats: { fgm: 3, fga: 3, fgm_lng: 52, fgm_yds: 130, fgm_50p: 1, kick_pts: 12, xpm: 3 } },
  { ...P('k2', 'K', 'Romeo', 'KC'),   stats: { fgm: 1, fga: 3, fgm_lng: 38, fgm_yds: 38, kick_pts: 5, xpm: 2, fgmiss: 2 } },
  { ...P('k3', 'K', 'Sierra', 'DAL'), stats: { fgm: 2, fga: 2, fgm_lng: 44, fgm_yds: 85, kick_pts: 9, xpm: 3 } },
  { ...P('k4', 'K', 'Tango', 'SF'),   stats: { fgm: 0, fga: 1, fgm_lng: 0, fgm_yds: 0, kick_pts: 1, xpm: 1, fgmiss: 1, xpmiss: 1 } },
  { ...P('BUF', 'DEF', 'Buffalo', 'BUF'), stats: { sack: 4, int: 2, fum_rec: 1, def_td: 1, pts_allow: 10, yds_allow: 250, def_3_and_out: 3 } },
  { ...P('KC', 'DEF', 'Kansas City', 'KC'), stats: { sack: 2, int: 0, fum_rec: 0, pts_allow: 27, yds_allow: 400 } },
  { ...P('DAL', 'DEF', 'Dallas', 'DAL'), stats: { sack: 3, int: 1, fum_rec: 2, pts_allow: 17, yds_allow: 320, def_kr_yd: 80 } },
  { ...P('SF', 'DEF', 'San Francisco', 'SF'), stats: { sack: 1, int: 1, fum_rec: 0, pts_allow: 24, yds_allow: 350 } },
  { ...P('b1', 'RB', 'Uniform', 'TEN'), stats: { rush_yd: 90, rush_att: 15, rush_rec_yd: 90 } },
  { ...P('b2', 'WR', 'Victor', 'ATL'), stats: { rec: 2, rec_yd: 20, rush_rec_yd: 20 } },
];
const projRows = ['q1', 'q2', 'q3', 'q4', 'r1', 'r2', 'r3', 'r4', 'w1', 'w2', 'w3', 'w4', 'f1', 'f2', 'f3', 'f4', 'k1', 'k2', 'k3', 'k4', 'BUF', 'KC', 'DAL', 'SF']
  .map((pid) => ({ player_id: pid, stats: { pass_yd: 250, rush_yd: 50, rec: 4, rec_yd: 50, fgm: 2, sack: 2, int: 1 } }));

// starters_points chosen by hand; team totals: 1=150, 2=100, 3=120, 4=118 (matchup 1: 1 v 2, matchup 2: 3 v 4).
const M = (roster_id, matchup_id, starters, pts, bench, benchPts) => ({
  roster_id, matchup_id, starters, starters_points: pts, points: pts.reduce((a, b) => a + b, 0),
  players: [...starters, ...bench], players_points: Object.fromEntries([...starters.map((p, i) => [p, pts[i]]), ...bench.map((p, i) => [p, benchPts[i]])]),
});
const matchups = [
  M(1, 1, ['q1', 'r1', 'w1', 'f1', 'k1', 'BUF'], [30, 32, 28, 11, 12, 37], ['b1', 'b2'], [9, 3]),
  M(2, 1, ['q2', 'r2', 'w2', 'f2', 'k2', 'KC'],  [20, 18, 8, 6, 5, 43], ['b1', 'b2'], [24, 2]),
  M(3, 2, ['q3', 'r3', 'w3', 'f3', 'k3', 'DAL'], [22, 14, 25, 8, 9, 42], [], []),
  M(4, 2, ['q4', 'r4', 'w4', 'f4', 'k4', 'SF'],  [6, 2, 3, 1, 1, 105], [], []),
];

const ctx = buildTeams({ leagueInfo, rosters, users, matchups, statRows, projRows, playersDex: null });
ctx.scoring = leagueInfo.scoring_settings;
ctx.hasProjections = true;
ctx.prevPoints = new Map([[1, 100], [2, 130], [3, 120], [4, 90]]);
ctx.drives = { byPid: { q1: { yards: 92, plays: 9, top: '4:51' }, q3: { yards: 75, plays: 6 } } };

const results = computeAwards(ctx, GLOSSARY);
const R = Object.fromEntries(results.map((r) => [r.id, r]));
const top = (id) => R[id]?.rows?.[0];
const win = (id) => top(id)?.team;
const val = (id) => top(id)?.value;

ok('every glossary award computes without throwing', results.length === GLOSSARY.length);
const voided = results.filter((r) => r.voided).map((r) => `${r.id} (${r.voided})`);
// Only prizes this fixture gives nobody a number for may void.
const mayVoid = new Set(['two_pt', 'first_td', 'kr_yd', 'idp_tkl', 'snaps', 'rz', 'explosive', 'btkl', 'rush_yac', 'air_yd', 'def_ret_yd', 'yac', 'drops', 'stuffed', 'ypt', 'ypc', 'rating', 'def_3out', 'fg_50', 'def_td', 'fum', 'fg_miss', 'sacked', 'ints', 'zeros', 'escape', 'hundred']);
const badVoid = voided.filter((v) => !mayVoid.has(v.split(' ')[0]));
ok('nothing voids that the fixture gives an answer for', !badVoid.length, badVoid.join(', '));

// Team score & matchup
ok('Scoreboard: highest total', win('house_high') === 'Team 1' && val('house_high') === 150);
ok('The Basement: lowest total', win('low_score') === 'Team 2' && val('low_score') === 100);
ok('Not Dead Yet: biggest climb', win('house_notdead') === 'Team 1' && val('house_notdead') === 50);
ok('Crash and Burn: biggest fall', win('house_crash') === 'Team 2' && val('house_crash') === -30);
ok('Unlucky Schedule: best loser', win('house_unlucky') === 'Team 4' && val('house_unlucky') === 118);
ok('Escape Artist: worst winner', win('escape') === 'Team 3' && val('escape') === 120);
ok('Photo Finish: smallest gap, split', val('house_closest') === 2 && top('house_closest').split.length === 2 && top('house_closest').split.includes('Team 3'));
ok('Curb Stomp: widest margin', win('blowout') === 'Team 1' && val('blowout') === 50);
ok('Shootout: most combined, split', val('shootout') === 250 && top('shootout').split.includes('Team 1'));
ok('Carried: biggest share', win('house_onmyback') === 'Team 4' && val('house_onmyback') === 89);
ok('Flex Appeal: flex slot points only', win('flex') === 'Team 1' && val('flex') === 11);

// Big ones
ok('Highest-Scoring Starter', win('top_starter') === 'Team 4' && val('top_starter') === 105);
ok('Quarterback Room: QB points', win('qb_pts') === 'Team 1' && val('qb_pts') === 30);
ok('Air Raid: rec yards summed', win('rec_yd') === 'Team 1' && val('rec_yd') === 190);
ok('Gunslinger: pass yards', win('pass_yd') === 'Team 1' && val('pass_yd') === 300);
ok('Ground Game: rush yards incl. QB', win('house_forrest') === 'Team 1' && val('house_forrest') === 140);
ok('Touchdown Passes', win('pass_td') === 'Team 1' && val('pass_td') === 3);
ok('Touchdown Club: rush+rec TDs', win('house_6god') === 'Team 1' && val('house_6god') === 2);
ok('Chain Movers: rush+rec first downs', win('first_downs') === 'Team 1' && val('first_downs') === 11);
ok('Bell Cow: most carries by one RB', win('rush_att') === 'Team 1' && val('rush_att') === 22);
ok('Workhorse: most rush yards by one RB', win('rush_yd_one') === 'Team 1' && val('rush_yd_one') === 120);
ok('Alpha Receiver: most rec yards by one starter', win('rec_yd_one') === 'Team 3' && val('rec_yd_one') === 130);
ok('Target Hog', win('rec_tgt_one') === 'Team 3' && val('rec_tgt_one') === 12);
ok('Dual Threat: QB rush yards only', win('qb_rush') === 'Team 2' && val('qb_rush') === 55);
ok('Y Not: TE rec yards', win('te_yd') === 'Team 1' && val('te_yd') === 60);
ok('Pass-Catching Back: RB catches (flex RB counts)', win('rb_rec') === 'Team 2' && val('rb_rec') === 8);
ok('Century Club: 100-yard starters', win('hundred') === 'Team 1' && val('hundred') === 2);
ok('Everybody Eats: starters who scored', win('scorers') === 'Team 1' && val('scorers') === 2);
ok('Longest Touchdown: carrier credited', win('td_lng') === 'Team 1' && val('td_lng') === 50);
ok('Bombs Away WR', win('house_bombs_wr') === 'Team 1' && val('house_bombs_wr') === 50);
ok('Bombs Away QB', win('house_bombs_qb') === 'Team 1' && val('house_bombs_qb') === 60);
ok('Breakaway', win('house_forrest_cops') === 'Team 1' && val('house_forrest_cops') === 45);
ok('Now Watch This Drive: from play-by-play', win('house_drive') === 'Team 1' && val('house_drive') === 92);

// Kickers & defense
ok('Big Leg', win('house_bigleg') === 'Team 1' && val('house_bigleg') === 52);
ok('Leg Day', win('fgm_yds') === 'Team 1' && val('fgm_yds') === 130);
ok('Automatic', win('fg_made') === 'Team 1' && val('fg_made') === 3);
ok('Leg Points', win('kick_pts') === 'Team 1' && val('kick_pts') === 12);
ok('Turnover Machine: level on 3, settled by DEF points', win('house_turnover') === 'Team 3' && val('house_turnover') === 3);
ok('Turnover Machine: tie goes to the higher-scoring DEF', R.house_turnover.tieBroken === 'DEF points' && R.house_turnover.rows[1].team === 'Team 1');
ok('Ball Hawks', win('def_int') === 'Team 1' && val('def_int') === 2);
ok('Sack Attack', win('house_sack') === 'Team 1' && val('house_sack') === 4);
ok('Defensive Points', win('def_pts') === 'Team 4' && val('def_pts') === 105);
ok('Bend Don’t Break: fewest allowed', win('pts_allow') === 'Team 1' && val('pts_allow') === 10);
ok('Brick Wall: fewest yards allowed', win('yds_allow') === 'Team 1' && val('yds_allow') === 250);

// Shame
ok('Butterfingers', win('fum') === 'Team 2' && val('fum') === 3);
ok('Sack Sponge', win('sacked') === 'Team 2' && val('sacked') === 4);
ok('Picked Off', win('ints') === 'Team 4' && val('ints') === 3);
ok('Wide Right', win('fg_miss') === 'Team 2' && val('fg_miss') === 2);
ok('Corpse In The Lineup: lowest non-DEF starter', win('corpses') === 'Team 4' && val('corpses') === 1);

// Versus projection (every starter projected to the same line, so deltas are just points minus that)
ok('Biggest Bust is the lowest team minus its projection', win('bust_team') === 'Team 2');
ok('Biggest Boom is the highest team minus its projection', win('boom_team') === 'Team 1');
ok('Individual Boom', win('boom') === 'Team 4' && top('boom').detail[0].name === 'San Francisco DEF');

// Lineup management. Team 2 benched a 24-point RB: the best lineup starts him at RB and moves the
// 18-point back to FLEX over the 6-point receiver, so it left 18 on the bench (118 possible).
ok('Unsung Hero: best bench score', win('house_unsung') === 'Team 2' && val('house_unsung') === 24);
ok('Points Left On The Bench', win('bench_pts') === 'Team 2' && val('bench_pts') === 18);
ok('Perfect Lineup', win('optimal') === 'Team 1' && val('optimal') === 150);
ok('Lineup IQ: share of the best lineup', val('efficiency') === 100 && R.efficiency.rows.find((r) => r.team === 'Team 2').value === 84.7);
ok('Deep Bench: total bench points', win('bench_total') === 'Team 2' && val('bench_total') === 26);

// The race data rides along for sums and bests, and not for things one player did not do.
ok('a sum carries race contributions', Array.isArray(top('rec_yd').race) && top('rec_yd').raceMode === 'sum');
ok('a slot prize carries race contributions', top('flex').raceMode === 'sum');
ok('a margin carries none', top('blowout').race === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
