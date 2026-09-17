# Sleeper Side Prizes

Weekly side-prize leaderboards, a sealed prize wheel and a season prize board for any
[Sleeper](https://sleeper.com) fantasy football league. Give it your league id, pick the prizes
you want to play for out of a glossary of 84, and every Tuesday it publishes a page that says who
won what — computed from each team's **locked starters** for that week, off Sleeper's public
read-only API. No key, no login, no dependencies.

Built for one twelve-team league (New Ro FFL) and used there since 2025. Anything about that
league now lives in one file, `league.json`, so it can be yours instead.

## What you get

| Path | What |
|---|---|
| `/` | **This week** — the newest finished week: the wheel, what it paid, and every board; a holding card while a week is still being played |
| `/weeks/2026-week-3` | One week's stat sheet: every prize you play for, ranked, with the players who put the number there |
| `/awards` | The prize board: everything in play this season, which week each one paid, and who took it |
| `/prizes` | The prize list: what you play for, grouped by part of the game or by what it measures |
| `/archive` | Every week, newest first |
| `/shortlist` | A checklist of every prize in the glossary you do *not* play for, for the league to vote on |

One prize a week is drawn **by a wheel**, from the prizes that actually scored that week, and
never drawn twice in a season. The pick is sealed on the server behind a published hash before
anyone can see it, and opened when someone spins. See [The wheel](#the-wheel).

## Quick start

You need Node 20+ and, optionally, Python 3 with Pillow for player headshots.

```sh
git clone https://github.com/reedm121/sleeper-side-prizes.git && cd sleeper-side-prizes
npm run setup            # asks for your league id, shows the glossary, writes league.json (or copy league.example.json)
node build.js --latest   # the newest finished week -> weeks/<season>-week-<n>.html
npm run build            # assembles public/
npm run dev              # http://localhost:3000
```

`npm run setup` looks your league up on Sleeper, prints its name, lineup and scoring so you can
see you typed the right id, then lists every prize by group and asks which to play for. Answer
with numbers, ranges or ids (`1-8, 14, rec_yd`), or `core` for the twenty-odd that settle
cleanly and rarely tie, or `all`. It also asks which of those are **house prizes** — the ones
your league has always played for — which are pinned at the top of every page under their own
heading. Optional.

To see it working before your season has a finished week, build one from last season. Sleeper
gives each season its own league id; setup prints the command with the previous one filled in:

```sh
node build.js --season 2025 --week 1 --league <last season's id> --demo
```

A `--demo` page reports the week honestly but its wheel spins to a random prize on demand and
records nothing. Every 2025 week in this repository's `weeks/` is one of those.

## league.json

Everything that makes a deployment *your* league:

```json
{
  "league":     "123456789012345678",
  "name":       "New Ro FFL",
  "timezone":   "America/New_York",
  "houseLabel": "The House Prizes",
  "house":      ["house_high", "house_closest"],
  "prizes":     ["rec_yd", "pass_yd", "td_lng"],
  "custom":     { "house_forrest": { "name": "Run Forrest Run" } }
}
```

- `league` — this season's Sleeper league id. The `LEAGUE_ID` environment variable overrides it,
  so a workflow variable can point a deploy at next season without a commit, and `--league` on
  `build.js` overrides both for a backfill.
- `name`, `timezone` — the masthead and the clock the pages read dates in.
- `house` — prizes listed first under `houseLabel`. Can be empty.
- `prizes` — the rest of what you play for, or the string `"all"`.
- `custom` — your own `name` and/or `blurb` for any prize. The glossary calls `house_forrest`
  "Ground Game"; the league it was built for calls it "Run Forrest Run".

Edit it by hand or re-run `npm run setup`, which keeps your `custom` names.

## The glossary

`node setup.js --list` prints all 84. They are rows in [`awards.js`](awards.js), grouped:

| Group | Examples |
|---|---|
| Team score & matchup | Scoreboard, Not Dead Yet (biggest week-over-week climb), Unlucky Schedule (best losing score), Photo Finish (closest matchup, split), Curb Stomp, Shootout, Carried (one starter's share of the team), Flex Appeal |
| The big ones | Air Raid, Gunslinger, Ground Game, Yards From Scrimmage, Touchdown Club, Bell Cow, Longest Touchdown, Bombs Away (longest catch / longest completion), position rooms (QB / RB / WR / TE points), Century Club, Everybody Eats |
| Kickers & defense | Big Leg, Leg Day, Long Range, Turnover Machine, Sack Attack, Ball Hawks, Bend Don't Break, Brick Wall, Three And Out |
| Fun & degenerate | YAC Attack, Through Contact, Explosive Plays, Red Zone Hogs, First Blood, Going For Two, passer rating and yards-per rates with volume gates |
| Shame | The Basement, Butterfingers, Stone Hands, Sack Sponge, Picked Off, Wide Right, Corpse In The Lineup, Goose Eggs |
| Versus projection | Biggest Bust / Boom, Individual Bust / Boom — projections rescored with your league's settings |
| Lineup management | Unsung Hero (best benched player), Points Left On The Bench, Perfect Lineup, Lineup IQ, Deep Bench |

A prize is one row: how it aggregates (`sum`, `max`, `count`, `points`, `slot`, …), which stat
keys it reads, who is eligible, and when it should refuse to publish. Adding one is one row and
one test — see [CONTRIBUTING.md](CONTRIBUTING.md). **Ids are permanent**: they key the season
ledger, the sealed draws, the badge art and every shortlist vote. Names are free to change.

Every prize is computed from Sleeper's per-player box scores for the week, joined to each team's
starters *as they were locked that week* — not the current roster. Ties go to the higher team
score, or on a one-position prize to the higher-scoring player at that position; the prize list
prints the rule under each one. A stat that Sleeper did not chart league-wide that week voids
the prize rather than crowning everyone at zero.

## The wheel

One prize a week, drawn from the prizes that actually scored that week. Nobody sees it until
someone spins for it, and nobody can have swapped it afterwards:

1. The Tuesday build publishes the **pool** — every prize that scored — and what each would pay.
   Not the answer.
2. The first person to open the page **seals** the week: the server picks, salts it with a
   nonce, stores both, and publishes only `sha256(pick|nonce)`. The pick never leaves the server
   and never passes through CI.
3. Anyone can press **Spin the wheel**. That opens the week for everyone. The page can record the
   spin as a video with your camera in the corner, to drop in the group chat.
4. Anyone can hash the revealed pick and nonce and match the commitment that was public hours
   earlier.

There is no login, on purpose: the pick exists and is committed before anyone can press
anything, so a spin cannot choose it, change it or reroll it. The only thing a password would
decide is who gets to look first, which is a question about your group chat, not your server.

Without replacement: a prize drawn in week 3 is off the wheel for the rest of the season, and
`/awards` shows what is still up.

## Deploying

The site is static pages plus two tiny API routes, built for [Vercel](https://vercel.com) with
an [Upstash](https://upstash.com) Redis store for the shortlist votes and the sealed draws.

1. Push your repository (with your `league.json`) to GitHub and import it at
   [vercel.com/new](https://vercel.com/new). `vercel.json` sets the build command and output
   directory; take the defaults.
2. In the project's **Storage** tab, create an Upstash Redis store (free tier) and connect it.
   That injects the REST URL and token; `lib/store.js` finds them by shape, whatever Vercel
   names them.
3. Redeploy. Without a store, `/api/state` and `/api/wheel` return 503 and both pages say so
   rather than pretending to save.

### The Tuesday workflow

[`.github/workflows/weekly.yml`](.github/workflows/weekly.yml) runs at 09:05 ET every Tuesday:
find the newest finished week, fetch headshots, build the page, commit it to `weeks/`. The push
triggers the Vercel deploy, so there is no deploy hook or token to keep in sync. It reads the
league from `league.json`; set a repository variable `LEAGUE_ID` to override it when the season
rolls over. `workflow_dispatch` takes a week and season to backfill by hand.

GitHub disables scheduled workflows on public repositories after 60 days without a commit.
Re-enable it each August.

### Local

```sh
npm run build && npm run dev    # public/ + the real API handlers against a file store in .data/
HTTPS=1 npm run dev             # a self-signed https address on your LAN, so a phone will grant a camera
npm test                        # glossary shape, every aggregation, the shortlist merge, the wheel, the seal
```

## Data and credit

- **Sleeper's public API.** The documented league endpoints on `api.sleeper.app` and the
  undocumented stats, projections and schedule endpoints on `api.sleeper.com`. Read-only, no
  key. The undocumented ones could change without notice; a finished week is cached forever in
  `.cache/` so a backfill never depends on them twice.
- **nflverse** ([nflverse-data](https://github.com/nflverse/nflverse-data), CC BY 4.0) for
  play-by-play — one prize, Now Watch This Drive, needs drive length, which Sleeper does not
  carry — and for kickoff times. Both are optional: without them that prize voids and the race
  under the wheel runs by game day.
- **DynastyProcess** ([db_playerids](https://github.com/dynastyprocess/data)) to map nflverse
  player ids to Sleeper's.
- Player headshots and club marks are fetched from Sleeper's CDN at build time by `assets.py`,
  which is optional. They are inlined into a week's page, not committed on their own.
- The badge artwork in `output/badges/` was drawn for the original league and is MIT like the
  code. Prizes without art render without it.

## Layout

```
league.json     your league: id, name, timezone, which prizes           <- the only file you edit
setup.js        writes league.json by asking questions
build.js        one week -> weeks/<season>-week-<n>.html
  sleeper.js      API client; a finished week caches forever, an unfinished one never
  drives.js       nflverse play-by-play, for the one prize Sleeper cannot answer
  compute.js      rosters + raw stats -> per-team boards for every prize
  awards.js       the glossary, and what this league plays for out of it (from league.json)
  render.js       boards -> one HTML page per week
  wheelui.js      the wheel and the race under it (client-side, inlined by render.js)
  badges.js       badge art, for every page that names a prize
  lib/league.js   reads league.json
assets.py       headshots and club marks -> assets.json (optional; needs Pillow)
badges.py       badge art -> output/badges/web/ (committed)

site.js         weeks/ + the other pages -> public/; newest week becomes /
master.js       the prize board: what is in play, what has been won
prizes.js       the prize list
shortlist.js    the checklist of prizes not yet played for
api/wheel.js    seal a week's prize; open it when someone spins
api/state.js    the shortlist's shared votes
lib/store.js    Upstash in production, a file in dev
dev.js          local preview with working API routes
wheel.json      the season ledger: what each week drew and who won it
test/           npm test
```

[PLAN.md](PLAN.md) is the original design investigation — why the API beats scraping, and the
Sleeper quirks every rule in `compute.js` was earned against. Worth reading before touching the
scoring.

## Keeping up with the template

If you cloned this to run your own league, your repository is the template plus three things of
your own: `league.json`, `weeks/`, and `wheel.json`. Pull the template to pick up new prizes and
fixes; those three files are never in it, so the merge cannot touch them:

```sh
git remote add template https://github.com/reedm121/sleeper-side-prizes.git   # once
git pull template main
```

## License

MIT. See [LICENSE](LICENSE).
