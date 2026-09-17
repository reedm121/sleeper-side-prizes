// Turns raw Sleeper payloads into per-award leaderboards.
//
// The rules encoded here were each earned by a live observation; see PLAN.md §8.
// The big ones: Sleeper omits zero values entirely and gives a bye/inactive player no row
// at all, so every stat read needs two guards. Empty lineup slots are the literal string
// "0". And the stats payload carries TEAM_XXX rows holding whole-team yardage that would
// silently win every yardage award, so we only ever walk a team's own starters.

import { PLAYED, statKeysOf } from './awards.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const statOf = (stats, pid, key) => num(stats[pid]?.[key]);
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Does a starter satisfy a `count` award's `where`? Declared as data so a glossary row can say
 * `{ key: 'rush_rec_yd', gte: 100 }` (a stat) or `{ field: 'points', lte: 0 }` (a starter field)
 * without touching this file. A function is still accepted for anything data cannot say.
 */
function matches(s, where, stats) {
  if (typeof where === 'function') return where(s);
  const v = where.key ? statOf(stats, s.pid, where.key) : num(s[where.field]);
  if (where.gte !== undefined && !(v >= where.gte)) return false;
  if (where.gt !== undefined && !(v > where.gt)) return false;
  if (where.lte !== undefined && !(v <= where.lte)) return false;
  if (where.lt !== undefined && !(v < where.lt)) return false;
  if (where.eq !== undefined && v !== where.eq) return false;
  return true;
}
const whereValue = (s, where, stats) =>
  typeof where === 'function' ? s.points : where.key ? statOf(stats, s.pid, where.key) : num(s[where.field]);

/** Score a stat line with the league's own scoring settings rather than Sleeper's pts_half_ppr. */
export function scoreWith(settings, line) {
  let total = 0;
  for (const [key, mult] of Object.entries(settings)) total += num(mult) * num(line?.[key]);
  return Math.round(total * 100) / 100;
}

/** Lineup slots in order, excluding bench and reserve. Index i lines up with starters[i]. */
export const starterSlots = (rosterPositions) =>
  rosterPositions.filter((p) => p !== 'BN' && p !== 'IR' && p !== 'TAXI');

export function buildTeams({ leagueInfo, rosters, users, matchups, statRows, projRows, playersDex }) {
  const slots = starterSlots(leagueInfo.roster_positions);
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const rosterById = new Map(rosters.map((r) => [r.roster_id, r]));

  const stats = {}, proj = {}, meta = {};
  for (const row of statRows) {
    stats[row.player_id] = row.stats || {};
    meta[row.player_id] = { ...(row.player || {}), team: row.team, opponent: row.opponent };
  }
  for (const row of projRows || []) proj[row.player_id] = row.stats || {};

  const posOf = (pid) => {
    const fp = meta[pid]?.fantasy_positions || playersDex?.[pid]?.fantasy_positions;
    if (fp?.length) return fp;
    return playersDex?.[pid]?.position ? [playersDex[pid].position] : [];
  };
  const nameOf = (pid) => {
    const m = meta[pid] || playersDex?.[pid] || {};
    const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
    return full || m.full_name || (playersDex?.[pid]?.team ? `${pid} DEF` : pid);
  };

  const teams = [];
  for (const m of matchups) {
    const roster = rosterById.get(m.roster_id);
    const user = roster ? userById.get(roster.owner_id) : null;
    const label =
      (user?.metadata?.team_name || '').trim() || user?.display_name || `Team ${m.roster_id}`;

    // Both arrays can be JSON null on a real row.
    const rawStarters = m.starters || [];
    const pts = m.starters_points || [];
    const startersAll = rawStarters.map((pid, i) => ({
      pid, slot: slots[i] || '?', empty: pid === '0' || !pid,
      points: num(pts[i]), name: nameOf(pid), pos: posOf(pid),
      nflTeam: meta[pid]?.team || playersDex?.[pid]?.team || null,
      opponent: meta[pid]?.opponent || null,
      played: Boolean(stats[pid]),
    }));
    const starters = startersAll.filter((s) => !s.empty);

    const allPlayers = m.players || [];
    const startedIds = new Set(starters.map((s) => s.pid));
    const playerPts = m.players_points || {};
    const bench = allPlayers
      .filter((pid) => !startedIds.has(pid) && pid !== '0')
      .map((pid) => ({ pid, points: num(playerPts[pid]), name: nameOf(pid), pos: posOf(pid),
        nflTeam: meta[pid]?.team || playersDex?.[pid]?.team || null }));

    teams.push({
      rosterId: m.roster_id, name: label, ownerId: roster?.owner_id || null, matchupId: m.matchup_id,
      points: num(m.points), starters, startersAll, bench,
      emptySlots: startersAll.filter((s) => s.empty).length,
    });
  }
  // Pair rosters by matchup_id so win/loss, opponent and margin are available to awards.
  const byMatchup = new Map();
  for (const t of teams) {
    if (t.matchupId === null || t.matchupId === undefined) continue;
    if (!byMatchup.has(t.matchupId)) byMatchup.set(t.matchupId, []);
    byMatchup.get(t.matchupId).push(t);
  }
  for (const pair of byMatchup.values()) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    a.opponentTeam = b; b.opponentTeam = a;
    a.margin = Math.round((a.points - b.points) * 100) / 100;
    b.margin = -a.margin;
    a.won = a.points > b.points; b.won = b.points > a.points;
    a.tiedGame = b.tiedGame = a.points === b.points;
  }

  return { teams, stats, proj, meta, slots, posOf, nameOf, byMatchup };
}

/**
 * The league's standing tiebreak rule, applied to every award unless it overrides.
 *
 *   a prize that adds up across the lineup  ->  higher scoring fantasy team
 *   a prize about one named position        ->  highest scoring player in that slot
 *
 * The discriminator is whether the award resolves to a single position: an explicit
 * single-entry `pos` filter, or a `posTag` (Gunslinger sums pass yards over the whole
 * lineup, but the league thinks of it as the quarterback prize, so its ties go to the
 * better quarterback rather than the better team).
 *
 * Two notes on the edges. Where the prize IS team score (Scoreboard, The Basement) the
 * tiebreak is the same number as the prize, so it resolves nothing and the board stays a
 * dead heat — correctly, since there is nothing left to separate them. And on the shame
 * tier this hands the blame to the higher scoring team, which is the rule applied evenly
 * rather than a special case.
 */
export function tiebreakFor(award) {
  const only = award.pos?.length === 1 ? award.pos[0] : award.posTag || null;
  const label = only ? `${only} points` : 'team score';
  if (award.tiebreak) return { label, ...award.tiebreak };
  return only
    ? { label, agg: 'points', mode: 'max', pos: [only], posNot: null, keys: null, min: null }
    : { label, agg: 'points', mode: 'sum', pos: null, posNot: null, keys: null, min: null };
}

/** The same rule as a sentence, for the prize list and the cards. */
const POS_WORD = { QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end', K: 'kicker', DEF: 'defense' };
export function tiebreakRule(award) {
  const only = award.pos?.length === 1 ? award.pos[0] : award.posTag || null;
  if (award.agg === 'closest' || award.agg === 'shootout') return 'Both teams split it';
  // The prize IS team score, so the rule has nothing left to separate them.
  if (award.agg === 'points' && award.mode === 'sum' && !only) return 'A tie stays a dead heat';
  return only ? `Ties go to the higher-scoring ${POS_WORD[only] || only}` : 'Ties go to the higher team score';
}

/** A stat can vanish league-wide for an entire week and never backfill (2025 wk18). */
const leagueWideHas = (stats, keys) =>
  keys.some((k) => Object.values(stats).some((line) => num(line[k]) !== 0));

const eligible = (s, award) =>
  (!award.pos || award.pos.length === 0 || s.pos.some((p) => award.pos.includes(p))) &&
  (!award.posNot || !s.pos.some((p) => award.posNot.includes(p)));

function teamValue(award, team, ctx) {
  const { stats, proj, scoring } = ctx;
  const pool = team.starters.filter((s) => eligible(s, award));

  switch (award.agg) {
    // Week-over-week swing. Needs the prior week's matchups; week 1 has none.
    case 'delta': {
      const prev = ctx.prevPoints?.get(team.rosterId);
      if (prev === undefined) return { value: null, detail: [], reason: 'needs a previous week' };
      const v = Math.round((team.points - prev) * 100) / 100;
      return { value: v, detail: [{ name: `${prev} \u2192 ${team.points}`, value: v > 0 ? `+${v}` : v }] };
    }
    // Highest score among teams that still lost their matchup.
    case 'luckyLoser': {
      if (team.won !== false || team.tiedGame) return { value: null, detail: [], reason: 'did not lose' };
      return {
        value: team.points,
        detail: [{ name: `lost to ${team.opponentTeam.name}`, value: team.opponentTeam.points }],
      };
    }
    // Lowest score among teams that still won. The mirror of the one above; `dir: 'asc'`.
    case 'luckyWinner': {
      if (team.won !== true) return { value: null, detail: [], reason: 'did not win' };
      return {
        value: team.points,
        detail: [{ name: `beat ${team.opponentTeam.name}`, value: team.opponentTeam.points }],
      };
    }
    // The widest winning margin. Only winners have one worth counting.
    case 'margin': {
      if (team.won !== true) return { value: null, detail: [], reason: 'did not win' };
      return {
        value: team.margin,
        detail: [{ name: `beat ${team.opponentTeam.name}`, value: `${team.points} – ${team.opponentTeam.points}` }],
      };
    }
    // Points from named lineup slots only — the flex spots, say. A league without the slot has
    // no number for it, not a zero, so the prize voids rather than crowning everybody at 0.
    case 'slot': {
      const picks = pool.filter((s) => award.slots.includes(s.slot));
      if (!picks.length) return { value: null, detail: [], reason: 'no such slot in this league' };
      return {
        value: round2(picks.reduce((a, s) => a + s.points, 0)),
        detail: picks.slice().sort((a, b) => b.points - a.points).slice(0, 3).map((s) => ({ pid: s.pid, name: s.name, value: s.points })),
      };
    }
    // The single starter who carried the largest share of their team's score.
    case 'shareOfTeam': {
      if (!team.points) return { value: null, detail: [], reason: 'team scored nothing' };
      const best = pool.reduce((a, s) => (a && a.points >= s.points ? a : s), null);
      if (!best || best.points <= 0) return { value: null, detail: [] };
      return {
        value: Math.round((best.points / team.points) * 1000) / 10,
        detail: [{ pid: best.pid, name: best.name, value: best.points }],
      };
    }
    case 'sum': {
      // A starter with no stat line scores zero, which is harmless when more is better and
      // wrong when less is. Bend Don't Break asks who ALLOWED the fewest points: a defence on
      // bye allows nothing at all, so a lineup that did not field one would win it outright.
      // No pooled starter played means this team has no number for this prize, not a zero.
      if (!pool.some((s) => s.played)) return { value: null, detail: [], reason: 'nobody in the slot played' };
      let total = 0; const contrib = [];
      for (const s of pool) {
        const v = award.keys.reduce((a, k) => a + statOf(stats, s.pid, k), 0);
        if (v !== 0) contrib.push({ pid: s.pid, name: s.name, value: v });
        total += v;
      }
      return { value: total, detail: contrib.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3) };
    }
    case 'max': {
      let best = 0, who = null;
      for (const s of pool) {
        const v = Math.max(...award.keys.map((k) => statOf(stats, s.pid, k)));
        if (who === null || v > best) { best = v; who = s; }
      }
      return { value: best, detail: who && best !== 0 ? [{ pid: who.pid, name: who.name, value: best }] : [] };
    }
    case 'count': {
      // Same guard as `sum`: a lineup nobody in played has no count, not a count of zero.
      if (!pool.some((s) => s.played)) return { value: null, detail: [], reason: 'nobody in the slot played' };
      const hits = pool.filter((s) => matches(s, award.where, stats));
      return { value: hits.length, detail: hits.slice(0, 3).map((s) => ({ pid: s.pid, name: s.name, value: whereValue(s, award.where, stats) })) };
    }
    case 'ratio': {
      const n = pool.reduce((a, s) => a + award.num.reduce((b, k) => b + statOf(stats, s.pid, k), 0), 0);
      const d = award.den ? pool.reduce((a, s) => a + award.den.reduce((b, k) => b + statOf(stats, s.pid, k), 0), 0) : 1;
      const gate = award.min ? pool.reduce((a, s) => a + statOf(stats, s.pid, award.min.key), 0) : Infinity;
      if (award.min && gate < award.min.value) return { value: null, detail: [], reason: `under ${award.min.value} ${award.min.key}` };
      if (d === 0) return { value: null, detail: [], reason: 'no attempts' };
      return { value: Math.round((n / d) * 100) / 100, detail: [] };
    }
    case 'points': {
      if (award.mode === 'max' || award.mode === 'min') {
        const pick = pool.reduce((a, s) => {
          if (!a) return s;
          return award.mode === 'max' ? (a.points >= s.points ? a : s) : (a.points <= s.points ? a : s);
        }, null);
        return { value: pick ? pick.points : null,
                 detail: pick ? [{ pid: pick.pid, name: pick.name, value: pick.points }] : [] };
      }
      return { value: Math.round(pool.reduce((a, s) => a + s.points, 0) * 100) / 100, detail: [] };
    }
    case 'projDelta': {
      const deltas = pool.map((s) => ({
        pid: s.pid, name: s.name,
        value: Math.round((s.points - scoreWith(scoring, proj[s.pid])) * 100) / 100,
      }));
      if (!deltas.length) return { value: null, detail: [] };
      if (award.mode === 'team') {
        const t = deltas.reduce((a, d) => a + d.value, 0);
        return { value: Math.round(t * 100) / 100, detail: deltas.sort((a, b) => b.value - a.value).slice(0, 2) };
      }
      const pick = award.mode === 'max'
        ? deltas.reduce((a, d) => (a.value >= d.value ? a : d))
        : deltas.reduce((a, d) => (a.value <= d.value ? a : d));
      return { value: pick.value, detail: [pick] };
    }
    // The one award sourced from play-by-play rather than Sleeper (drives.js). A team with
    // no quarterback, or a quarterback whose offense never scored, returns null and simply
    // does not appear on the board; if the source is missing every team returns null and the
    // award voids, which is the whole point of keeping it isolated here.
    case 'drive': {
      if (!ctx.drives) return { value: null, detail: [], reason: 'play-by-play unavailable' };
      let best = null, who = null;
      for (const s of pool) {
        const d = ctx.drives.byPid[s.pid];
        if (d && (!best || d.yards > best.yards)) { best = d; who = s; }
      }
      if (!best) return { value: null, detail: [], reason: 'no touchdown drive' };
      const shape = [best.plays ? `${best.plays} plays` : null, best.top].filter(Boolean).join(', ');
      return { value: best.yards, detail: [{ pid: who.pid, name: who.name, value: shape || '\u2014' }] };
    }
    case 'bench': {
      if (award.mode === 'beast') {
        const best = team.bench.reduce((a, b) => (a && a.points >= b.points ? a : b), null);
        return { value: best ? best.points : 0, detail: best ? [{ pid: best.pid, name: best.name, value: best.points }] : [] };
      }
      if (award.mode === 'total') {
        const top = team.bench.slice().sort((a, b) => b.points - a.points).slice(0, 3);
        return { value: round2(team.bench.reduce((a, b) => a + b.points, 0)), detail: top.map((b) => ({ pid: b.pid, name: b.name, value: b.points })) };
      }
      const optimal = optimalLineup(team, ctx.slots);
      const actual = round2(team.starters.reduce((a, s) => a + s.points, 0));
      if (award.mode === 'optimal') return { value: optimal.total, detail: optimal.swaps.slice(0, 2) };
      if (award.mode === 'pct') {
        if (!optimal.total) return { value: null, detail: [], reason: 'no lineup to measure against' };
        return { value: Math.round((actual / optimal.total) * 1000) / 10, detail: [{ name: `${actual} of a possible ${optimal.total}`, value: '' }] };
      }
      return { value: round2(optimal.total - actual), detail: optimal.swaps.slice(0, 2) };
    }
    default:
      return { value: null, detail: [] };
  }
}

/**
 * The same number as teamValue, broken back out into the players who put it there — every
 * starter's line, not the top three the card shows. The wheel's race replays the week with it,
 * landing each line in the window its game was played in, so it only exists for prizes that
 * really are a sum or a best-of across players. A ratio, a swing from last week, the closest
 * matchup: none of those is one player's doing, and the race skips them. The share of a team
 * is the one exception — see the case below for what its race is and is not.
 *
 *   sum  the running total is the lines that have landed so far
 *   max  the running value is the best line that has landed so far
 */
export function contributions(award, team, ctx) {
  if (award.dir === 'asc') return null;   // a race to the bottom reads backwards
  const { stats, proj, scoring } = ctx;
  const pool = team.starters.filter((s) => eligible(s, award));
  const one = (s, value, label) => ({ pid: s.pid, name: s.name, value, nflTeam: s.nflTeam || null, ...(label !== undefined ? { label } : {}) });
  const nonzero = (c) => c.value !== 0;
  const positive = (c) => c.value > 0;
  switch (award.agg) {
    case 'sum':
      return { mode: 'sum', list: pool.map((s) => one(s, award.keys.reduce((a, k) => a + statOf(stats, s.pid, k), 0))).filter(nonzero) };
    case 'count':
      return { mode: 'sum', list: pool.filter((s) => matches(s, award.where, stats)).map((s) => one(s, 1, whereValue(s, award.where, stats))) };
    case 'slot':
      return { mode: 'sum', list: pool.filter((s) => award.slots.includes(s.slot)).map((s) => one(s, s.points)).filter(nonzero) };
    case 'luckyWinner':   // dir 'asc' already returned null above; kept explicit
    case 'margin':        // a margin is two teams' doing, not one player's
      return null;
    case 'max':
      return { mode: 'max', list: pool.map((s) => one(s, Math.max(...award.keys.map((k) => statOf(stats, s.pid, k))))).filter(positive) };
    case 'shareOfTeam': {
      // Every starter's share of the team's FINAL score, landing in the window he played in,
      // the best share so far in front. The denominator is the whole week from the first tick
      // — a share of a score still being posted is 100% for whoever played first and means
      // nothing — so this is the shape of the week rather than a replay of it. It moves, the
      // lead changes hands as the big games land, and it settles on exactly the card's number.
      // The label is the starter's points, which is what the card prints beside his name.
      if (!team.points) return null;
      return { mode: 'max', list: pool.filter((s) => s.points > 0).map((s) => one(s, Math.round((s.points / team.points) * 1000) / 10, s.points)) };
    }
    case 'points':
      if (award.mode === 'max') return { mode: 'max', list: pool.map((s) => one(s, s.points)).filter(positive) };
      if (award.mode === 'min') return null;
      return { mode: 'sum', list: pool.map((s) => one(s, s.points)).filter(nonzero) };
    case 'luckyLoser':
      if (team.won !== false || team.tiedGame) return null;
      return { mode: 'sum', list: team.starters.map((s) => one(s, s.points)).filter(nonzero) };
    case 'projDelta': {
      const d = pool.map((s) => one(s, Math.round((s.points - scoreWith(scoring, proj[s.pid])) * 100) / 100));
      if (award.mode === 'team') return { mode: 'sum', list: d.filter(nonzero) };
      if (award.mode === 'max') return { mode: 'max', list: d.filter(positive) };
      return null;
    }
    case 'bench':
      if (award.mode === 'beast') return { mode: 'max', list: team.bench.map((b) => one(b, b.points)).filter(positive) };
      if (award.mode === 'total') return { mode: 'sum', list: team.bench.map((b) => one(b, b.points)).filter(nonzero) };
      if (award.mode === 'optimal') return { mode: 'sum', list: optimalLineup(team, ctx.slots).chosen.map((p) => one(p, p.points)).filter(nonzero) };
      return null;
    case 'drive': {
      if (!ctx.drives) return null;
      const list = pool.map((s) => { const d = ctx.drives.byPid[s.pid]; return d ? one(s, d.yards) : null; }).filter(Boolean);
      return { mode: 'max', list };
    }
    default:
      return null;
  }
}

/** Best legal lineup over everyone rostered, used only for the two bench awards. */
function optimalLineup(team, slots) {
  const FLEX = { FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'] };
  const pool = [...team.starters, ...team.bench].map((p) => ({ ...p }));
  const used = new Set();
  let total = 0; const chosen = [];
  // Fill the most constrained slots first so a FLEX cannot steal a slot-only player.
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => (FLEX[a.s] ? 1 : 0) - (FLEX[b.s] ? 1 : 0));
  for (const { s } of order) {
    const allowed = FLEX[s] || [s];
    const best = pool
      .filter((p) => !used.has(p.pid) && p.pos.some((x) => allowed.includes(x)))
      .sort((a, b) => b.points - a.points)[0];
    if (best) { used.add(best.pid); total += best.points; chosen.push(best); }
  }
  const startedIds = new Set(team.starters.map((s) => s.pid));
  const swaps = chosen.filter((c) => !startedIds.has(c.pid)).map((c) => ({ pid: c.pid, name: c.name, value: c.points }));
  return { total: Math.round(total * 100) / 100, swaps, chosen };
}

/**
 * The matchups of the week as pairs, each with the number a pair prize reads off it. The
 * result of such a prize is a PAIR of teams who split it.
 *
 *   closest   the smallest gap between the two scores
 *   shootout  the largest combined score
 */
const PAIR_AGG = {
  closest:  { value: (a, b) => round2(Math.abs(a.points - b.points)), order: (x, y) => x.value - y.value },
  shootout: { value: (a, b) => round2(a.points + b.points),           order: (x, y) => y.value - x.value },
};
function matchupPairs(ctx, agg) {
  const pairs = [...ctx.byMatchup.values()].filter((p) => p.length === 2);
  if (!pairs.length) return null;
  const spec = PAIR_AGG[agg];
  return pairs.map(([a, b]) => ({ a, b, value: spec.value(a, b) })).sort(spec.order);
}

// `list` defaults to the awards the league currently plays for, not the whole catalogue.
// build.js widens it by exactly one when an old week's recorded prize has since been retired:
// rebuilding that week still has to produce the page it published.
export function computeAwards(ctx, list = PLAYED) {
  const { teams, stats } = ctx;
  const out = [];
  for (const award of list) {
    if (PAIR_AGG[award.agg]) {
      const pairs = matchupPairs(ctx, award.agg);
      if (!pairs?.length) { out.push({ ...award, voided: 'no matchups this week', rows: [] }); continue; }
      const rows = pairs.map((p) => ({
        value: p.value,
        team: `${p.a.name} v ${p.b.name}`,
        rosterId: p.a.rosterId,
        split: [p.a.name, p.b.name],
        detail: [
          { name: p.a.name, value: p.a.points },
          { name: p.b.name, value: p.b.points },
        ],
      }));
      out.push({ ...award, rows, tied: false, margin: rows.length > 1 ? round2(Math.abs(rows[1].value - rows[0].value)) : null });
      continue;
    }
    if (award.needsProj && !ctx.hasProjections) {
      out.push({ ...award, voided: 'projections unavailable', rows: [] });
      continue;
    }
    // A `void` award reads a stat that can go unrecorded league-wide for a week. Wherever the
    // row declares that stat — `keys`, or a count's `where` — it is the same check.
    const voidKeys = statKeysOf(award);
    if (award.void && voidKeys.length && !leagueWideHas(stats, voidKeys)) {
      out.push({ ...award, voided: 'not charted this week', rows: [] });
      continue;
    }
    let rows = teams.map((t) => ({ team: t.name, rosterId: t.rosterId, ...teamValue(award, t, ctx) }));
    const scored = rows.filter((r) => r.value !== null);
    if (!scored.length) {
      const why = rows.find((r) => r.reason)?.reason || 'no qualifying teams';
      out.push({ ...award, voided: why, rows: [] });
      continue;
    }
    // A rate prize that half the league failed to qualify for is a prize for whoever happened
    // to get the volume, so it needs at least half of them on the board.
    if (award.agg === 'ratio' && scored.length < Math.ceil(teams.length / 2)) { out.push({ ...award, voided: 'too few teams qualified', rows: [] }); continue; }
    if (!award.zeroIsReal && scored.every((r) => r.value === 0)) { out.push({ ...award, voided: 'nobody recorded one', rows: [] }); continue; }

    // Every award gets a tiebreak; see tiebreakFor for the rule and its edges.
    const tbSpec = tiebreakFor(award);
    const tb = (r) => {
      const t = teams.find((x) => x.rosterId === r.rosterId);
      return teamValue({ ...award, ...tbSpec, tiebreak: null }, t, ctx).value ?? 0;
    };
    rows = scored.sort((a, b) => {
      const primary = award.dir === 'asc' ? a.value - b.value : b.value - a.value;
      return primary !== 0 ? primary : tb(b) - tb(a);
    });
    rows.forEach((r) => { r.tb = tb(r); });
    // What the race replays. Attached to the rows rather than recomputed at render time, so
    // the page's standings and the race that arrives at them come off one call.
    for (const r of rows) {
      const c = contributions(award, teams.find((x) => x.rosterId === r.rosterId), ctx);
      if (c) { r.race = c.list; r.raceMode = c.mode; }
    }
    const top = rows[0].value;
    // `level` is how many tied on the prize itself; `winners` how many survive the tiebreak.
    const level = rows.filter((r) => r.value === top).length;
    const winners = rows.filter((r) => r.value === top && r.tb === rows[0].tb).length;
    out.push({ ...award, rows, tied: winners > 1,
      // Say so on the card when a tiebreak decided the prize, or a winner looks arbitrary.
      tieBroken: level > winners ? tbSpec.label : null,
      // Rounded like every other margin. Subtracting two scored floats gives 0.2999999999
      // rather than 0.3, and the page prints this straight into "By ...".
      margin: rows.length > winners ? Math.round(Math.abs(top - rows[winners].value) * 100) / 100 : null });
  }
  return out;
}
