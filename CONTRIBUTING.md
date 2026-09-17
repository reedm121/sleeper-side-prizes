# Contributing

Thanks for looking. This is a small project with no dependencies, and it should stay that way.

## Adding a prize to the glossary

Most contributions will be new prizes. A prize is one row in [`awards.js`](awards.js), in the
`GLOSSARY` array, under the tier it belongs to. If it uses an aggregation `compute.js` already
has — `sum`, `max`, `count`, `points`, `slot`, and the rest listed at the top of `awards.js` —
that one row is the whole change.

Rules:

1. **Ids are permanent.** They key the season ledger, the sealed draws in Redis, the badge art
   and every saved shortlist verdict. Pick a short lowercase `snake_case` id and never rename it.
   The name and blurb are yours to change any time.
2. **Only read stat keys Sleeper returns.** `test/fixtures/sleeper-stat-keys.json` is the list;
   `npm test` fails on a key that is not in it. If you know a real key that is missing from the
   fixture, add it with a note saying which week it appeared in.
3. **Never `sum` a `_lng` key.** Longest plays are `max`.
4. **Say who can win it in the blurb** — "backs only", "receivers only" — rather than trusting a
   reader to know what `pos` does.
5. **Mark the fragile ones.** `void: true` if the stat can go unrecorded league-wide for a week
   (charting stats do). `needsProj: true` if it reads projections. `dir: 'asc'` if lowest wins.
6. **Give it a test.** `test/compute.test.mjs` runs every glossary row against one hand-built
   week. Add a line asserting who wins yours and with what number. If the fixture gives nobody a
   number for it, add the id to `mayVoid` there and say why.

Then `npm test`, and try it on a real week:

```sh
node setup.js --list                                  # see it in the glossary
node build.js --season 2025 --week 3 --league <a finished league> --text --demo
```

## Adding an aggregation

If a prize needs a new way of aggregating, add a `case` to `teamValue()` in `compute.js`, a
matching `case` to `contributions()` (return `null` if the race under the wheel cannot replay it
player by player), document the new `agg` at the top of `awards.js`, and add it to `AGGS` in
`test/awards.test.mjs`. Keep the guards the others have: a team nobody in played gets `null`, not
`0`, or a bye week wins every lowest-wins prize.

## Everything else

- Pages are plain template strings with inline CSS and no framework, one script per page.
  Keep it that way.
- `npm run build && npm run dev` serves the site locally against a file-backed store in `.data/`.
- Comments in this codebase explain *why*. If you find yourself writing *what*, the code should
  say it instead.
- Run `npm test` before opening a pull request.
