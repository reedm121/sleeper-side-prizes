# Weekly Incentive Report — Plan

**Status:** design settled and API fully verified. Not yet built.
**Last updated:** 2026-09-10.

New Ro FFL hands out an arbitrary side-prize each week on top of the normal matchup — most
rushing yards, longest field goal, whatever gets invented that week. Settling it by hand means
scrolling twelve rosters in the Sleeper app and adding numbers up.

Goal: **one command, once a week, producing per-team leaderboards across a broad award catalog**,
so whichever prize the league picks is already computed.

---

## 1. League facts

| | |
|---|---|
| League | New Ro FFL — `1385073235753717760` (2026) |
| 2025 league | `1257418044087472128` — same roster shape, used as a test fixture |
| Teams | 12 |
| Scoring | half PPR (`rec` 0.5), `pass_td` 4.0 — read at runtime, never hardcode |
| Starters (10) | `QB, RB, RB, WR, WR, TE, FLEX, FLEX, K, DEF` |
| Bench | 5 |
| Playoffs | start week 15, 6 teams |

Slot indices in the `starters` array: FLEX = **6, 7**; K = **8**; DEF = **9**.

---

## 2. Decision: REST API, not Playwright

Reed floated driving sleeper.com with Playwright. **Dropped — the API strictly dominates.**

Scraping loses on every axis. `sleeper.com/leagues/{id}/*` serves an 8,275-byte JS shell with zero
league data (byte-identical for a real league and a fabricated one). The web client's own lineup
query `matchup_legs` returns `unauthorized` without a login token. The one server-rendered page
that exists, `sleeper.com/roster/{league_id}/{roster_id}`, **ignores `?week=`** — it can only show
the *current* lineup, which is precisely the bug we need to avoid.

Meanwhile the public REST API is unauthenticated, needs no key, and exposes **more than the UI does**:
228 raw box-score stat keys per player per week.

**Accuracy is settled.** Across all 16 games of 2025 week 1, Sleeper vs ESPN produced 1,939
field-level comparisons with exactly one mismatch (an omitted-negative artifact, not an error).
`rush_lng` 136/136, `rec_lng` 253/253, `fgm_lng` 31/31 all matched. A third source, nflverse/nflfastR,
agreed on 1,007 joined players with zero mismatches on counting stats. Good enough to settle money.

**Ops envelope:** no auth of any kind (bogus `Authorization` headers are silently ignored), no
User-Agent policing, no rate-limit headers, and a 40-call burst at ~60 req/s returned 40/40 HTTP 200
with no throttling. A once-a-week run of six calls is nothing.

---

## 3. The finding that shapes everything

**`matchups/{week}` is an immutable historical snapshot.** It is not recomputed from current rosters.

Proven on your own 2025 league: **50 of 120** week-2 starters were no longer on their end-of-season
rosters — dropped mid-season — yet week 2 still returns them with frozen `starters_points` and
correct totals. Week 15 showed 5/120, the exact gradient you'd expect as rosters converge. Refetches
are byte-identical (stable md5). History survives at least four seasons back.

Consequences:

- **Your "while rosters are still locked" constraint is wrong in your favor — drop it.**
- No snapshot files, no database, no weekly state. **Sleeper is the database.**
- The report is a **pure function of `(league_id, week)`**. Missing a week costs nothing;
  `node report.js 4` backfills correctly, in December if you want.
- All of 2025 is backfillable.

**The one hard caveat.** An *unplayed* week returns HTTP 200 with a full, plausible lineup mirroring
the current roster and 0.0 points, **with no flag distinguishing it**. Verified across four live 2026
leagues at weeks 2, 3, 8, 15, 18. This is the most dangerous shape in the system and is why the
completeness gate below is non-negotiable.

---

## 4. Data flow

Six unauthenticated GETs, ~250 KB gzipped, ~3 seconds.

```
1. GET /v1/state/nfl                          -> {season, week}   UPPER BOUND only, not "done"
2. GET /schedule/nfl/regular/{season}         -> THE COMPLETENESS GATE
                                                 status ∈ {pre_game, complete, canceled}
3. GET /v1/league/{id}                        -> roster_positions, scoring_settings
4. GET /v1/league/{id}/rosters  +  /users     -> roster_id -> owner_id -> team label
5. GET /v1/league/{id}/matchups/{W}           -> starters[], starters_points[], players_points{}
6. GET /stats/nfl/{season}/{W}?season_type=regular -> raw stats + embedded player metadata
```

The join is a **direct dict lookup** — `matchups[].starters[i]` is the same string `player_id` that
keys the stats payload. Zero name matching. Verified end-to-end on your league: 120 starter slots,
**0 missing stat lookups**.

### Why step 6 uses the query-param form

Each row embeds a `player` object plus the **historical** team/opponent/game_id. That eliminates the
14.65 MB `/v1/players/nfl` download entirely. `/v1/players/nfl` reports each player's *current* team —
46% of 2025 wk6 stat rows have a different team today — so using it for attribution mislabels history
and breaks bye-week logic. (Still needed for `fantasy_positions` on the bench-optimization awards.)

### Join footguns

- **Defenses.** In `starters`, a DEF is the bare abbrev (`"BAL"`). In stats, the bare abbrev is the
  DEF unit while **`TEAM_BAL` is a separate team-offense row**. Join on bare; `TEAM_*` are decoys
  carrying whole-team `rush_yd`/`rec_yd` that would silently win every yardage award.
- **Empty slots** are the literal string `"0"`. Filter before every lookup. Never `set()` the
  starters array — it collapses repeated `"0"`s and destroys slot alignment.
- **Omitting `season_type` is a silent trap:** `/v1/stats/nfl/2026/1` returns HTTP 200 with ~7,630
  keys whose values are all empty dicts. No error.

---

## 5. Architecture

A single node script, matching the pattern this repo already used for the draft board:

```
fetch.js      # the six GETs, with the completeness gate
awards.js     # the catalog: stat keys, aggregation, eligibility, void conditions
build.js      # compute leaderboards -> self-contained HTML
report.html   # generated output, published as a shareable artifact
```

Run `node build.js --week 1`, publish `report.html` as an artifact, drop the link in the league chat.

No cache directory, no database, no committed data — everything is re-fetchable and immutable.
The only thing needing persistence is data no API has: **which prize the league actually declared
that week**. That's a one-line-per-week text file, human-maintained.

---

## 6. Award catalog

~50 awards. Aggregation is `sum` for totals, `max` for "longest" — **never sum a `*_lng`**.
Tie frequencies below were measured over 17 played weeks of a structurally similar 12-team half-PPR league.

**Tier A — settle money, no caveats (0 ties in 17 weeks).**
Most rushing yards (`rush_yd`, sum) · receiving yards (`rec_yd`) · passing yards (`pass_yd`) ·
yards from scrimmage (`rush_rec_yd`, a single exact key — don't add the parts) · carries (`rush_att`) ·
receptions (`rec`) · longest run (`rush_lng`, **max**) · yards after contact (`rush_yac`) ·
air yards (`rec_air_yd`) · passer rating (`pass_rtg`, min 10 `pass_att`) · YAC (`rec_yar` — note
`yar`, not `yac`) · highest-scoring starter (`starters_points`, free, no stats join).

**Tier B — ties are common, and the standing rule settles them.**

> **The league tiebreak rule** (implemented as the default in `compute.js`, `tiebreakFor`):
> a prize that adds up across the lineup goes to the **higher scoring fantasy team**; a prize
> about one named position goes to the **highest scoring player in that slot** — the kicker,
> the defense, the quarterback. No award needs to declare its own tiebreak any more.
> Where the prize *is* team score (Scoreboard, The Basement) the tiebreak is the same number
> as the prize, so it resolves nothing and the board stays an honest dead heat. Measured over
> 2025 weeks 1-5 of the fixture league this broke 5-7 ties a week and left none standing.
> Cards say which basis decided them, so a winner the numbers do not explain never looks like a bug.

Longest catch (`rec_lng`, 3/17 weeks tied) · longest completion (`pass_lng`, 3/17) ·
targets (`rec_tgt`, 3/17) · most TDs (`anytime_tds`, **6/17 tied, 12/17 decided by ≤1**).

> ⚠️ **`anytime_tds` ≠ `rush_td + rec_td`.** An early research pass claimed zero exceptions; the
> adversarial check refuted it. 45 of 1,151 rows disagree across 15 of 18 weeks, because it also counts
> `st_td`, `idp_def_td`, `fum_rec_td` (e.g. a kick-return TD with no rush/rec TD). If the league means
> rush+rec, compute it explicitly.

**Tier C — kicker and defense.** *(See §7 — this tier exists only because your league starts a K and DEF.)*
Longest FG (`fgm_lng`, **max**) · FGs made (`fgm`) · 50+ bombs (`fgm_50p`) · 60+ (`fgm_60p`) ·
kicking points (`kick_pts`) · FG accuracy (`fgm_pct`, min 2 `fga`) · total FG yardage (`fgm_yds`) ·
missed kicks, as shame (`fgmiss`, `xpmiss`) · sacks (`sack`) · takeaways (`int` + `fum_rec`) ·
points allowed (`pts_allow`, ascending) · defensive TDs (`def_td`).

**Tier D — fun / degenerate.**
Explosive plays 40+ (`rec_40p`+`rush_40p`+`pass_cmp_40p`) · lowest aDOT (`rec_air_yd/rec_tgt`,
min 15 team targets) · yards per touch · yards per target · broken tackles (`rush_btkl`) ·
red-zone hogs (`rec_rz_tgt`+`rush_rz_att`+`pass_rz_att`) · offensive snaps (`off_snp`) ·
snap share · return yards (`kr_yd`+`pr_yd`) · accidental defender (`idp_tkl` — a skill player
recording a tackle, pure comedy) · longest TD (`max` of `rush_td_lng`/`rec_td_lng`/`pass_td_lng`) ·
first blood (`first_td` — exactly 16 exist league-wide per week).

**Tier E — shame.**
Lowest team score · fumbles (`fum`+`fum_lost`) · drops (`rec_drop`) · drop rate ·
sacks taken (`pass_sack`) · stuffed at the line (`rush_tkl_loss_yd`, stored **negative**, sort asc) ·
**corpse in the lineup** (count of starters scoring exactly 0.00 — this is the one that catches a
started bye/inactive player) · empty calories (high targets, low yards per target).

**Tier F — vs projections.** Needs `/v1/projections/nfl/regular/{season}/{week}` (verified, and
retrievable for past weeks so backfill works). Score projections with the league's own
`scoring_settings`, **not** the projection's own `pts_half_ppr`.
Overachiever · biggest bust · individual boom · individual bust · % of projection.
Projections carry **no** `*_lng`, `anytime_tds`, `first_td`, or charting keys — so deltas work on
points and volume only, never longest-play categories.

**Tier G — lineup management.**
**Points left on the bench** (optimal legal lineup over `matchups[].players` minus actual — filter
IR/taxi or you'll build an illegal optimum) · **bench beast** (highest-scoring benched player).
The most shareable shame stat in the whole set.

---

## 7. Correction: the K/DEF tier the research wrongly excluded

The research workflow was seeded with stale context from an old memory note saying "8 skill starters."
Its agents therefore validated against a clone league with **no K and no DEF slot** and concluded that
longest FG — the exact example Reed named — was *uncomputable, refuse to generate*.

**That conclusion does not apply to this league.** `roster_positions` includes `K` and `DEF` in both
2026 and 2025. Verified by direct computation on 2025 week 2:

```
LONGEST FG — 2025 wk2, New Ro FFL        MOST RUSH YARDS — same week
  64 yd  Team A        318  Team A
  58 yd  Team B        256  Team C
  56 yd  Team D        251  Team E
  53 yd  Team F        236  Team G
   0 yd  Team E         70  Team H
```

120 starter slots, 0 missing stat lookups. Kicker and defense awards are fully in scope.

*Lesson for future runs: seed research agents from the live league config, not from memory.*

---

## 8. Mandatory implementation rules

Each was earned by a live observation, not a guess.

1. **Two `.get()`s, always** — `stats.get(pid, {}).get(key, 0.0)`. Sleeper **omits zero values
   entirely** (0 zeros in 32,089 values) and a bye/inactive player has **no row at all**.
   Direct indexing raises on 4–12% of starter slots in a normal week.
2. **Filter `pid != "0"`** before every lookup.
3. **Null-guard `starters` and `players`** — both can be JSON `null` on a real row.
4. **Iterate `starters`, never `stats.items()`** — the `TEAM_XXX` rows would win every yardage award.
5. **Gate the run.** Require every week-`W` game in the schedule endpoint to be
   `complete` or `canceled`. `state.week` is the *current in-progress* week, not the last completed one.
6. **Run Tuesday, not Monday night.** Charting stats and snaps land Monday evening→Tuesday;
   ~1% of rows are still corrected 4–12 days out. Publish "final as of `<timestamp>`".
7. **Every award needs a void condition.** Print *category unavailable* when a key is league-wide
   empty — never publish a 12-way tie at zero. Real precedent: 2025 week 18 has `rush_yac` on
   **zero** rows and `off_snp` collapsed from ~600 to 68, and it has never backfilled.
8. **Declare a tiebreak cascade.** Suggested: higher team `points` → higher `rush_rec_yd` → co-winners split.
9. **Awards are config, not code** — `{id, name, keys, agg, direction, min_qualifier, positions, void_if, tier}`.
   Ad-hoc weekly prizes should be a config edit.
10. Use `fantasy_positions`, not `position` (Travis Hunter is `position:"DB"`, `fantasy_positions:["WR","DB"]`).

---

## 9. Open questions

- Which prizes the league actually rotates through — worth seeding the catalog with the real ones.
- Backfill 2025 for a season-long "who won the most side-prizes" board?
- A second delivery channel (iMessage) came up via another session; the artifact is the decided route
  and any second channel should be confirmed, not assumed.

## 10. Deliberately not doing

- Playwright / browser scraping — the API strictly dominates it.
- A local database or per-week snapshot files — the API is immutable and free to re-fetch.
- Downloading `/v1/players/nfl` on every run — the stats rows embed what we need.
