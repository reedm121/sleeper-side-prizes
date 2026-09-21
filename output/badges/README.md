# New Ro FFL — Badge Catalog

Open **index.html** directly in a browser to browse all 30 awards and the shrimp alternate (31 badges). No server or build step required. Search by award or rule, filter color families, click a badge to enlarge it, and switch its backdrop to inspect transparency.

- **images/** — 31 individual flat, SVG-like PNG badges, named by the award IDs in `awards.js`.
- **catalog-overview.png** — a labeled overview of all 31 selected badge designs.
- **catalog.json** — the complete award list, original rules, color families, and file mapping.
- **concepts.json** — the symbol concept for each badge.
- **prompts.json** — exact prompts used with the built-in image generation tool.
- **drafts/scoreboard-metallic.png** — the initial metallic direction, kept separately from the flat collection.

These are raster PNG images with a vector-like visual style, not SVG source files. The color families are visual groupings, not eligibility rules; the award descriptions state who qualifies. Names and rules were copied from the 30 active prizes in the project, including “Now Watch This Drive” as it appears in the catalog.

## Awards

1. **Scoreboard** — Every one of your ten starters added up — highest team score of the week. [PNG](images/high_score.png)
2. **Crash and Burn** — Your team score this week minus last week — the biggest fall. [PNG](images/swing_down.png)
3. **Not Dead Yet** — Your team score this week minus last week — the biggest climb. [PNG](images/swing_up.png)
4. **Unlucky Schedule** — Of the six teams that lost their matchup, the one that scored most. [PNG](images/best_loser.png)
5. **Photo Finish** — The matchup decided by the smallest margin — both teams split it. [PNG](images/closest.png)
6. **Run Forrest Run** — Rushing yards added up across all ten starters, quarterback scrambles included. [PNG](images/rush_yd.png)
7. **Unsung Hero** — The single highest scoring player you left on your bench. [PNG](images/bench_best.png)
8. **Bombs Away: WR Edition** — Longest single catch by one starting wide receiver — receivers only, not backs or tight ends. [PNG](images/rec_lng_wr.png)
9. **Big Leg** — Longest single field goal made by your starting kicker. [PNG](images/fgm_lng.png)
10. **Turnover Machine** — Interceptions plus fumble recoveries by your starting defense — ties go to the higher scoring defense. [PNG](images/def_takeaways.png)
11. **Sack Attack** — Sacks by your starting defense. [PNG](images/def_sack.png)
12. **Stickies** — Catches added up across all ten starters. [PNG](images/rec.png)
13. **6 God(s)** — Rushing and receiving touchdowns added up across all ten starters — passing touchdowns do not count. [PNG](images/td_rush_rec.png)
14. **Bombs Away: QB Edition** — Longest single completion by one starting quarterback, measured to where the play ended. [PNG](images/pass_lng.png)
15. **Put The Team On My Back (Greg Jennings)** — One starter’s points as a share of their whole team’s score. [PNG](images/share_of_team.png)
16. **Running From The Cops Speed** — Longest single carry by one starting running back — backs only. [PNG](images/rush_lng_rb.png)
17. **Now Watch This Drive** — The longest touchdown drive your starting quarterback marched — measured from where his offense first got the ball. [PNG](images/drive_lng.png)
18. **Air Raid** — Receiving yards added up across all ten starters. [PNG](images/rec_yd.png)
19. **Gunslinger** — Passing yards added up across all ten starters — normally just your quarterback. [PNG](images/pass_yd.png)
20. **Yards From Scrimmage** — Rushing plus receiving yards added up across all ten starters. [PNG](images/scrimmage.png)
21. **Bell Cow** — Most carries by one starting running back — backs only. [PNG](images/rush_att.png)
22. **Longest Touchdown** — Longest single touchdown scored by one of your starters, measured by who carried it in — a run or a catch. Throwing it does not count, so a touchdown pass goes to the receiver who caught it and never to the quarterback, though a quarterback who runs one in wins it like anyone else. [PNG](images/td_lng.png)
23. **Highest-Scoring Starter** — Fantasy points of your single best starter. [PNG](images/top_starter.png)
24. **Leg Day** — Every field goal your kicker made, distances added together. [PNG](images/fgm_yds.png)
25. **Defense Wins Championships** — Touchdowns scored by your starting defense. [PNG](images/def_td.png)
26. **Bend Don’t Break** — Points your starting defense gave up — fewest wins. [PNG](images/pts_allow.png)
27. **YAC Attack** — Yards gained after the catch, all ten starters. [PNG](images/yac.png)
28. **Explosive Plays** — Plays that gained 40 yards or more, all ten starters. [PNG](images/explosive.png)
29. **First Blood** — How many of your starters scored the opening touchdown of their own game. [PNG](images/first_td.png)
30. **Yards Per Touch** — Your starting backs’ yards divided by their touches — needs 10 carries. [PNG](images/ypc.png)

## Run Forrest Run alternate

[The shrimp version](images/rush_yd_shrimp.png) wraps a curled shrimp around a football as a Forrest Gump movie reference. The original cleat design is also included.

## Revised concepts

- **Put The Team On My Back:** Atlas kneeling under an enormous football.
- **Photo Finish:** a photo camera, football shutter lens, and checkered finish stripe.
- **Now Watch This Drive:** George W. Bush swinging a golf driver, referencing the clip behind the title.

Earlier directions are kept in `drafts/`; `images/` and the main catalog use the revised selections.

## Earlier directions

- [Metallic Scoreboard](drafts/scoreboard-metallic.png)
- [Photo Finish chevrons](drafts/photo-finish-chevrons.png)
- [Team On My Back stars](drafts/team-on-my-back-stars.png)
- [Now Watch This Drive field](drafts/now-watch-this-drive-field.png)
