# Before making this repository public

A checklist for the maintainer. Everything on this branch already assumes the code is read by
strangers; this is the rest.

## Done on this branch

- [x] `league.json` holds the league id, name, timezone and prize selection. No file outside it
      names a league.
- [x] `awards.js` is a generic glossary; the league's names for prizes live in `league.json`.
- [x] `npm run setup` writes `league.json` for a new league from a Sleeper id.
- [x] No credentials anywhere in the tree or in git history (checked 2026-09-14). `.env` is
      ignored.
- [x] `LICENSE` (MIT for the code; badge art excluded), `CONTRIBUTING.md`, this file.
- [x] The weekly workflow reads the league from `league.json`.

## Decided (2026-09-17)

- Template repository plus private instance. The template is `reedm121/sleeper-side-prizes`:
  a fresh single-commit history with no `weeks/`, an empty `wheel.json` and `league.example.json`
  in place of `league.json`, so no team name or embedded headshot is in the tree or its history.
  New Ro's private repository merges the template's first commit and pulls it thereafter.
- Badge art is MIT with the code.
- No message to the league is needed: nothing of theirs is in the public repository.
- LICENSE names Reed Gantz.

## Still to do by hand

- [ ] Flip the template repository public: `gh repo edit reedm121/sleeper-side-prizes --visibility public --accept-visibility-change-consequences`
- [ ] Turn on secret scanning and push protection on it (Settings -> Code security).
- [ ] Push New Ro's main after checking the merged tree builds; that push deploys the live site.
- [ ] Scheduled workflows on public repositories are disabled after 60 days without a commit. The
      template has no weekly commits, so its copy of the workflow is a fork's to enable.
