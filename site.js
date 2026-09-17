#!/usr/bin/env node
// Assembles public/ — what Vercel serves. Run by `npm run build`, which is the project's
// Vercel build command.
//
// The weekly reports themselves are NOT built here. They come from Sleeper, take a couple of
// minutes and must never run against an unfinished week, so they are built once by the
// Tuesday workflow and committed to weeks/. A deploy only ever copies them.
//
// `/` IS the newest week — the same bytes, served twice. Opening the site on a Tuesday has to
// put you on this week's spin without a click, because that is the thing everyone is there for
// and the manager is there to do. The archive that used to live at `/` moved to `/archive`.
//
// A copy rather than a redirect: a redirect costs a round trip before anything renders, and a
// meta-refresh shows a blank page first. The week page is already in public/ either way.

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as api from './sleeper.js';
import { WEB_DIR, badgeImg, badgeCSS } from './badges.js';
import { LEAGUE } from './lib/league.js';

const NAME = LEAGUE.name;

const WEEKS = 'weeks';
const LEDGER = 'wheel.json';
const OUT = 'public';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function weeks() {
  let names = [];
  try { names = await readdir(WEEKS); } catch { return []; }

  const found = [];
  for (const f of names) {
    const m = /^(\d{4})-week-(\d+)\.html$/.exec(f);
    if (!m) continue;
    const { mtime, size } = await stat(join(WEEKS, f));
    // A demo page is one built with --demo, and the honest tell is on the page itself: only a
    // demo's wheel band carries `isdemo`. Cheaper than a second file to keep in step, and it
    // cannot drift out of agreement with what the page actually does.
    //
    // Matched on the class token, not anywhere in the file: render.js emits the demo spinner's
    // JS — `data-demospin` and all — into EVERY page and leaves it inert when there is nothing
    // to bind to, so searching for that string calls every week a demo.
    const demo = /class="[^"]*\bisdemo\b/.test(await readFile(join(WEEKS, f), 'utf8'));
    found.push({ file: f, season: Number(m[1]), week: Number(m[2]), built: mtime, size, demo });
  }
  // Newest first: latest season, then latest week.
  return found.sort((a, b) => b.season - a.season || b.week - a.week);
}

const day = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: LEAGUE.timezone });

// The prize each week actually paid out, so the index says what happened rather than just when.
//
// A live week has no prize here by design — it is sealed server-side until the manager spins,
// so the index cannot name it and says that instead of falling back to a build date, which
// would read as though nothing were waiting.
async function draws() {
  const out = new Map();
  try {
    const { AWARDS } = await import('./awards.js');
    const name = new Map(AWARDS.map((a) => [a.id, a.name]));
    const led = JSON.parse(await readFile(LEDGER, 'utf8'));
    for (const p of led.pending || []) out.set(`${p.season}-${p.week}`, { sealed: true });
    for (const d of led.draws || []) out.set(`${d.season}-${d.week}`, { id: d.pick, name: name.get(d.pick) || d.pick });
  } catch { /* no ledger yet */ }
  return out;
}

// The week the league is in the middle of watching, if there is one: the newest week that has
// kicked off and has not finished. Deliberately NOT Sleeper's state.week, which rolls forward
// partway through a week — by Tuesday afternoon it already says 2, and answering "what is on
// right now" with 2 would push the week-1 spin off the front door on the very morning the
// league is there to watch it. The schedule is the thing that knows a ball is in the air.
//
// Networked, and this runs inside the Vercel build, so any failure has to leave the deploy
// exactly as it would have been: no in-progress week, newest built week stays the front door.
async function inProgress() {
  try {
    const st = await api.state();
    const sched = await api.schedule(st.season, true);
    const settled = (g) => g.status === 'complete' || g.status === 'canceled';

    // Whether a week has kicked off is a question about the calendar, not about statuses.
    // Sleeper marks games canceled long before they would have been played — 2026 week 6
    // carries one in September — so "some game is not pre_game" reads a week in October as
    // live. Both sides of this comparison are plain YYYY-MM-DD in the league's own timezone.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: LEAGUE.timezone });

    // Ascending: the week the league is waiting on is the EARLIEST one still open, not the
    // latest. Scanning down would have to special-case every future week individually.
    for (const w of [...new Set(sched.map((g) => g.week))].sort((a, b) => a - b)) {
      const games = sched.filter((g) => g.week === w);
      if (games.every(settled)) continue;
      if (games.map((g) => g.date).sort()[0] > today) break;  // this week, and every later one, is ahead
      return { season: Number(st.season), week: w, games: games.length, done: games.filter(settled).length,
               pending: games.filter((g) => !settled(g)).map((g) => ({ away: g.away, home: g.home, date: g.date })) };
    }
  } catch (e) { console.error(`  could not reach Sleeper (${e.message}); front door stays on the newest built week`); }
  return null;
}

// "2026-09-14" is a calendar date, not an instant. Parsing it lands on UTC midnight, which
// formats as the 13th anywhere west of Greenwich, so it is formatted in UTC and left alone.
const gameDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US',
    { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/**
 * The front door while a week is still being played.
 *
 * This is the honest answer to "what is happening" between kickoff and Tuesday: the week is not
 * over, so there is no stat sheet to publish and — the part the league cares about — no prize
 * has been drawn. Showing last week's already-spun wheel under a nav item reading "This week"
 * implies a spin that has not happened.
 *
 * No scores on purpose. A week's numbers are still moving, and a provisional board is exactly
 * the thing every other gate in this repo exists to keep off the site.
 *
 * It refreshes itself. A deploy only happens when Tuesday's workflow pushes, so a count baked
 * in at build time would be hours stale by Sunday night; the page re-reads the schedule from
 * Sleeper on load and rewrites its own count, and says so when the week goes final.
 */
function holdingHTML(live, list, prize) {
  // A real week to point at if there is one, and only a demo to fall back on if there is not.
  const real = list.filter((w) => !w.demo);
  const last = real[0] || list[0];
  // Not for a demo: its wheel re-spins on demand, so naming the prize it happens to hold
  // would contradict the line right under it saying the thing settles nothing.
  const lastPrize = last && !last.demo && prize.get(`${last.season}-${last.week}`);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${live.week} — ${esc(NAME)}</title>
<meta name="description" content="Week ${live.week} of ${esc(NAME)} is still being played. The week's bonus prize is sealed until the games end.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Big+Shoulders+Display:wght@700;800&display=swap">
<style>
:root{
  --ground:#070B16; --panel:#101827; --panel-2:#162034; --raise:#1B2740;
  --line:#22304C; --line-2:#2E4066;
  --ink:#EDF2FF; --muted:#94A5C9; --faint:#61729A;
  --gold:#FFC93C; --cyan:#3FD8F0; --live:#4ADE80;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding-inline:20px;padding-block:0 72px}
h1,h2{margin:0;text-wrap:balance}
a{color:inherit}
.mast{position:relative;margin-inline:-20px;padding:44px 20px 30px;overflow:hidden;
  background:linear-gradient(103deg,var(--panel-2),var(--panel) 60%,var(--ground));
  border-bottom:3px solid var(--gold)}
.mast::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:repeating-linear-gradient(90deg,transparent 0 59px,rgba(148,165,201,.09) 59px 60px);
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 80%);mask-image:linear-gradient(180deg,transparent,#000 80%)}
.mast>*{position:relative}
.sitenav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:16px;font-size:15px;font-weight:600;letter-spacing:.03em}
.sitenav a{color:var(--muted);text-decoration:none;border-bottom:1px solid transparent}
.sitenav a[aria-current]{color:var(--ink);border-bottom-color:var(--gold)}
.sitenav a:hover{color:var(--ink);border-bottom-color:currentColor}
.sitenav a:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.eyebrow{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:16px;
  letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
h1{font-family:"Big Shoulders Display",sans-serif;font-weight:800;
  font-size:clamp(38px,8vw,66px);line-height:.92;text-transform:uppercase;margin-block:4px 12px}
.lede{color:var(--muted);max-width:62ch;margin:0}
.pill{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:7px 14px;border-radius:999px;
  background:rgba(74,222,128,.09);border:1px solid rgba(74,222,128,.35);
  font-size:14px;font-weight:600;letter-spacing:.02em;color:var(--live)}
.pill .dot{width:8px;height:8px;border-radius:50%;background:var(--live);flex:none;
  animation:pulse 2.4s ease-in-out infinite}
.pill.done{background:rgba(255,201,60,.09);border-color:rgba(255,201,60,.4);color:var(--gold)}
.pill.done .dot{background:var(--gold);animation:none}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
h2.sec{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:17px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--muted);
  margin-block:38px 14px;padding-bottom:7px;border-bottom:1px solid var(--line)}
.seal{margin-top:28px;padding:26px 24px;border-radius:4px;
  background:linear-gradient(120deg,var(--raise),var(--panel));
  border:1px solid var(--line-2);border-left:4px solid var(--gold)}
.seal .k{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:14px;
  letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.seal .t{font-family:"Big Shoulders Display",sans-serif;font-weight:800;
  font-size:clamp(28px,5vw,40px);line-height:1;text-transform:uppercase;margin-block:6px 10px}
.seal p{margin:0;color:var(--muted);max-width:60ch}
.seal p+p{margin-top:10px}
.left{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.left li{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:12px 15px;border-radius:3px;
  background:var(--panel);border:1px solid var(--line)}
.left .g{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:21px;
  letter-spacing:.04em;text-transform:uppercase}
.left .w{color:var(--faint);font-size:14px}
.side{display:flex;gap:14px;align-items:flex-start;padding:20px 22px;border-radius:4px;
  text-decoration:none;background:var(--panel);border:1px solid var(--line-2);border-left:4px solid var(--cyan);
  margin-bottom:10px}
.side:hover{border-color:var(--cyan)}
.side.board{border-left-color:var(--gold)}
.side.board:hover{border-color:var(--gold)}
.side:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.side .t{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:28px;
  line-height:1;text-transform:uppercase;margin-bottom:5px}
.side p{margin:0;color:var(--muted);font-size:14px;max-width:56ch}
.side .p{color:var(--gold);font-weight:600;display:flex;align-items:center;gap:9px}
.side .p .badge{--badge-size:80px}
footer{margin-top:44px;padding-top:18px;border-top:2px solid var(--line-2);
  color:var(--faint);font-size:13px}
footer p{margin:0 0 7px;max-width:74ch}
@media (max-width:560px){.wrap{padding-inline:16px}.mast{margin-inline:-16px;padding-inline:16px}}
${badgeCSS()}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head><body>
<div class="wrap">
  <header class="mast">
    <nav class="sitenav">
      <a href="/" aria-current="page">This week</a>
      <a href="/awards">Prize board</a>
      <a href="/prizes">What we play for</a>
      <a href="/archive">Every week</a>
    </nav>
    <div class="eyebrow">${esc(NAME)} &middot; ${live.season}</div>
    <h1>Week ${live.week} is still<br>being played</h1>
    <p class="lede">No stat sheet and <b>no prize drawn</b> yet. Both land Tuesday morning.</p>
    <div class="pill" id="pill" data-season="${live.season}" data-week="${live.week}">
      <span class="dot"></span><span id="pilltext">${live.done} of ${live.games} games final</span>
    </div>
  </header>

  <div class="seal">
    <div class="k">The wheel</div>
    <div class="t">Sealed until the week ends</div>
    <p>The prize is drawn from whatever actually <em>scored</em> this week, so it cannot be
      chosen until the last whistle. Nobody has spun.</p>
    <p>Tuesday morning the sheet posts, the server seals the pick behind a published hash, and
      whoever gets there first spins for it.</p>
  </div>

  <h2 class="sec">Still to play</h2>
  <ul class="left" id="left">
${live.pending.map((g) => `    <li><span class="g">${esc(g.away)} @ ${esc(g.home)}</span><span class="w">${esc(gameDay(g.date))}</span></li>`).join('\n')}
  </ul>

  <h2 class="sec">While you wait</h2>
${last ? `  <a class="side board" href="/weeks/${last.season}-week-${last.week}">
    <div>
      <div class="t">${last.demo ? `A demo week` : `Week ${last.week}`}</div>
      ${lastPrize?.name ? `<p class="p">${badgeImg(lastPrize.id)}<span>The wheel landed on ${esc(lastPrize.name)}</span></p>` : ''}
      <p>${last.demo
        ? `A real ${last.season} week, rebuilt as a demo. Its wheel spins on demand and decides nothing.`
        : `Last week's stat sheet and the spin that settled it.`}</p>
    </div>
  </a>` : ''}
  <a class="side" href="/prizes">
    <div>
      <div class="t">The Prize List</div>
      <p>All the prizes, grouped by part of the game or by what they measure.</p>
    </div>
  </a>

  <footer>
    <p>Sleeper's public read-only API. A week publishes only once all its games are final.
       Rebuilt each Tuesday morning.</p>
  </footer>
</div>
<script>
// The page outlives its deploy — the next one is Tuesday's push — so it re-reads the schedule
// rather than trusting a count baked in on Sunday. Failure is silent and leaves the built-in
// numbers standing, which are wrong only by however many games have ended since.
(function(){
  var pill=document.getElementById('pill'), text=document.getElementById('pilltext'), left=document.getElementById('left');
  if(!pill) return;
  var season=pill.dataset.season, week=Number(pill.dataset.week);
  fetch('https://api.sleeper.com/schedule/nfl/regular/'+season).then(function(r){
    return r.ok?r.json():Promise.reject();
  }).then(function(sched){
    var games=sched.filter(function(g){return g.week===week});
    if(!games.length) return;
    var settled=games.filter(function(g){return g.status==='complete'||g.status==='canceled'});
    var pend=games.filter(function(g){return g.status!=='complete'&&g.status!=='canceled'});
    if(settled.length===games.length){
      pill.className='pill done';
      text.textContent='All '+games.length+' games final — the sheet posts Tuesday morning';
      left.innerHTML='<li><span class="w">Nothing left. The week is in the books.</span></li>';
      return;
    }
    text.textContent=settled.length+' of '+games.length+' games final';
    left.innerHTML=pend.map(function(g){
      var p=g.date.split('-');
      var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2])).toLocaleDateString('en-US',
        {weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});
      var e=function(s){return String(s).replace(/[&<>"]/g,function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
      return '<li><span class="g">'+e(g.away)+' @ '+e(g.home)+'</span><span class="w">'+e(d)+'</span></li>';
    }).join('');
  }).catch(function(){});
})();
<\/script>
</body></html>
`;
}

// This page is built from wheel.json, which learns a live week's answer only when the NEXT
// Tuesday's build rewrites it — the spin itself happens in Redis. Left alone, the front door
// would go on saying a week was "waiting on the spin" for the six days after the league spun
// it. So anything still marked sealed asks the wheel directly, exactly as /awards does.
// Silent on failure: the built-in text is stale, not wrong, and a dead fetch must not blank it.
const SEALED_JS = `<script>
(function(){
  var marks=document.querySelectorAll('[data-sealed]');
  Array.prototype.forEach.call(marks,function(el){
    var parts=String(el.dataset.sealed).split(':');
    fetch('/api/wheel?season='+parts[0]+'&week='+parts[1])
      .then(function(r){ return r.json(); })
      .then(function(doc){
        if(!doc||!doc.revealed||!doc.pick) return;
        el.textContent='';
        var b=document.createElement('b'); b.textContent='Spun';
        el.appendChild(document.createTextNode('The wheel has been ')); el.appendChild(b);
        el.appendChild(document.createTextNode(' \\u2014 open the week to see it'));
      })
      .catch(function(){});
  });
})();
<\/script>`;

function archiveHTML(list, prize) {
  const [latest, ...rest] = list;
  const bySeason = {};
  for (const w of rest) (bySeason[w.season] ||= []).push(w);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(NAME)} — Every Week</title>
<meta name="description" content="Every week's side-prize leaderboard for ${esc(NAME)}, computed from each team's locked starters.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Big+Shoulders+Display:wght@700;800&display=swap">
<style>
:root{
  --ground:#070B16; --panel:#101827; --panel-2:#162034; --raise:#1B2740;
  --line:#22304C; --line-2:#2E4066;
  --ink:#EDF2FF; --muted:#94A5C9; --faint:#61729A;
  --gold:#FFC93C; --cyan:#3FD8F0;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding-inline:20px;padding-block:0 72px}
h1,h2{margin:0;text-wrap:balance}
a{color:inherit}
.mast{position:relative;margin-inline:-20px;padding:44px 20px 30px;overflow:hidden;
  background:linear-gradient(103deg,var(--panel-2),var(--panel) 60%,var(--ground));
  border-bottom:3px solid var(--gold)}
.mast::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:repeating-linear-gradient(90deg,transparent 0 59px,rgba(148,165,201,.09) 59px 60px);
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 80%);mask-image:linear-gradient(180deg,transparent,#000 80%)}
.mast>*{position:relative}
.sitenav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:16px;font-size:15px;font-weight:600;letter-spacing:.03em}
.sitenav a{color:var(--muted);text-decoration:none;border-bottom:1px solid transparent}
.sitenav a:hover{color:var(--ink);border-bottom-color:currentColor}
.sitenav a:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.eyebrow{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:16px;
  letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
h1{font-family:"Big Shoulders Display",sans-serif;font-weight:800;
  font-size:clamp(38px,8vw,66px);line-height:.92;text-transform:uppercase;margin-block:4px 12px}
.lede{color:var(--muted);max-width:62ch;margin:0}
h2.sec{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:17px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--muted);
  margin-block:38px 14px;padding-bottom:7px;border-bottom:1px solid var(--line)}
.hero{display:block;margin-top:28px;padding:26px 24px;text-decoration:none;border-radius:4px;
  background:linear-gradient(120deg,var(--raise),var(--panel));
  border:1px solid var(--line-2);border-left:4px solid var(--gold)}
.hero:hover{border-color:var(--gold)}
.hero:focus-visible,.card:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.hero .k{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:14px;
  letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.hero .t{font-family:"Big Shoulders Display",sans-serif;font-weight:800;
  font-size:clamp(30px,5.5vw,44px);line-height:1;text-transform:uppercase;margin-block:6px 8px}
.hero .m,.card .m{color:var(--faint);font-size:15px}
.hero .prize{color:var(--muted);font-size:16px;margin-bottom:6px;
  display:flex;align-items:center;gap:10px}
.hero .prize .badge{--badge-size:92px}
.hero .prize b{color:var(--gold);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}
.card{display:flex;align-items:center;gap:11px;padding:15px 16px;text-decoration:none;border-radius:3px;
  background:var(--panel);border:1px solid var(--line)}
.card:hover{border-color:var(--line-2);background:var(--panel-2)}
/* A demo is a different KIND of thing, not a lesser week, so it reads in the cyan the rest of
   the site spends on "this is machinery, not money" rather than in a dimmed gold. */
.hero.demo{border-left-color:var(--cyan)}
.hero.demo:hover{border-color:var(--cyan)}
.hero.demo .k{color:var(--cyan)}
.hero.demo .prize{color:var(--faint)}
.card.demo{border-left:3px solid var(--cyan)}
.card.demo .m{color:var(--cyan);opacity:.75}
.secnote{margin:-4px 0 14px;color:var(--faint);font-size:14px;max-width:66ch}
.card .txt{min-width:0}
.card .t{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:24px;
  line-height:1;text-transform:uppercase;margin-bottom:4px}
.side{display:flex;gap:14px;align-items:flex-start;padding:20px 22px;border-radius:4px;
  text-decoration:none;background:var(--panel);border:1px solid var(--line-2);border-left:4px solid var(--cyan)}
.side:hover{border-color:var(--cyan)}
.side.board{border-left-color:var(--gold);margin-bottom:10px}
.side.board:hover{border-color:var(--gold)}
.side:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.side .t{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:28px;
  line-height:1;text-transform:uppercase;margin-bottom:5px}
.side p{margin:0;color:var(--muted);font-size:14px;max-width:56ch}
.empty{padding:26px;border:1px dashed var(--line-2);border-radius:4px;color:var(--muted)}
.empty code{color:var(--gold);font-family:ui-monospace,Menlo,monospace;font-size:13px}
footer{margin-top:44px;padding-top:18px;border-top:2px solid var(--line-2);
  color:var(--faint);font-size:13px}
footer p{margin:0 0 7px;max-width:74ch}
@media (max-width:560px){.wrap{padding-inline:16px}.mast{margin-inline:-16px;padding-inline:16px}}
${badgeCSS()}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head><body>
<div class="wrap">
  <header class="mast">
    <nav class="sitenav">
      <a href="/">This week</a>
      <a href="/awards">Prize board</a>
    </nav>
    <div class="eyebrow">${esc(NAME)}</div>
    <h1>Every Week</h1>
    <p class="lede">Every week's prize, already settled. Each board is computed from every
      team's <b>locked starters</b> for that week, not their current rosters.</p>
  </header>

${latest ? `  <a class="hero${latest.demo ? ' demo' : ''}" href="/weeks/${latest.season}-week-${latest.week}">
    <div class="k">${latest.demo ? `Demo &middot; ${latest.season}` : `Latest &middot; ${latest.season}`}</div>
    <div class="t">Week ${latest.week}</div>
    ${(() => {
      // A demo's draw is replayed from the ledger, but its wheel re-spins on demand — so
      // naming the prize here would be announcing an answer the page itself contradicts.
      if (latest.demo) return `<div class="prize">A spin you can take yourself &mdash; it settles nothing</div>`;
      const p = prize.get(`${latest.season}-${latest.week}`);
      if (!p) return '';
      return p.sealed
        ? `<div class="prize" data-sealed="${latest.season}:${latest.week}">The wheel is <b>sealed</b> &mdash; waiting on the spin</div>`
        : `<div class="prize">${badgeImg(p.id)}<span>The wheel landed on <b>${esc(p.name)}</b></span></div>`;
    })()}
    <div class="m">Built ${esc(day(latest.built))}</div>
  </a>` : `  <div class="empty"><p>No weekly report has been built yet. Run
    <code>node build.js --latest</code> and commit what lands in <code>weeks/</code>.</p></div>`}

  <h2 class="sec">The season so far</h2>
  <a class="side board" href="/awards">
    <div>
      <div class="t">Prize Board</div>
      <p>Every prize in play this season, which week it paid and who took it. The wheel never
         draws the same prize twice, so this is also what is still up.</p>
    </div>
  </a>

  <h2 class="sec">What we play for</h2>
  <a class="side" href="/prizes">
    <div>
      <div class="t">The Prize List</div>
      <p>All the prizes, grouped by part of the game or by what they measure.</p>
    </div>
  </a>

${Object.keys(bySeason).sort((a, b) => b - a).map((season) => {
  const all = bySeason[season].every((w) => w.demo);
  return `  <h2 class="sec">${season}${all ? ' &mdash; demo weeks' : ' archive'}</h2>
${all ? `  <p class="secnote">Real ${season} weeks, rebuilt as demos. Each wheel spins on demand,
     lands somewhere new every time, and settles nothing &mdash; these are not ${esc(NAME)} results.</p>
` : ''}  <div class="grid">
${bySeason[season].map((w) => {
  const p = prize.get(`${w.season}-${w.week}`);
  return `    <a class="card${w.demo ? ' demo' : ''}" href="/weeks/${w.season}-week-${w.week}">
${w.demo || !p?.id ? '' : `      ${badgeImg(p.id)}\n`}      <div class="txt">
        <div class="t">Week ${w.week}</div>
        <div class="m"${!w.demo && p?.sealed ? ` data-sealed="${w.season}:${w.week}"` : ''}>${w.demo ? 'Demo &middot; spin it yourself'
          : esc(p?.name || (p?.sealed ? 'Sealed' : day(w.built)))}</div>
      </div>
    </a>`;
}).join('\n')}
  </div>`;
}).join('\n\n')}

  <footer>
    <p>Sleeper's public read-only API. A week publishes only once all its games are final.
       Rebuilt each Tuesday morning.</p>
  </footer>
</div>
${SEALED_JS}
</body></html>
`;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'weeks'), { recursive: true });

const list = await weeks();
for (const w of list) await cp(join(WEEKS, w.file), join(OUT, 'weeks', w.file));

// The badge art, shared by every page that names a prize. Copied rather than generated:
// badges.py needs Pillow and this runs on Vercel's build box, so the 320px set is committed
// (see badges.js). A repository without it deploys fine and the pages simply show no badges.
let badgeCount = 0;
try {
  await cp(WEB_DIR, join(OUT, 'badges'), { recursive: true });
  badgeCount = (await readdir(join(OUT, 'badges'))).filter((f) => f.endsWith('.webp')).length;
} catch { /* no badge art committed */ }

execFileSync(process.execPath, ['shortlist.js', join(OUT, 'shortlist.html')], { stdio: 'inherit' });
execFileSync(process.execPath, ['master.js', join(OUT, 'awards.html')], { stdio: 'inherit' });
execFileSync(process.execPath, ['prizes.js', join(OUT, 'prizes.html')], { stdio: 'inherit' });

const prize = await draws();
const archive = archiveHTML(list, prize);
await writeFile(join(OUT, 'archive.html'), archive);

// The front door, in order of what is actually true:
//
//   a week is being played   the holding card. There is no sheet for it yet and, more to the
//                            point, no prize has been drawn — so landing on last week's spun
//                            wheel under a nav item reading "This week" would imply one.
//   otherwise                the newest built week, which is the spin everyone came for.
//   nothing built at all     the archive, which says so rather than 404ing on the site root.
//
// Written to public/ only. The holding card must never become a file in weeks/, or Tuesday's
// workflow would find the week already committed and skip the real build.
const [newest] = list;
const live = await inProgress();
const holding = live && !list.some((w) => w.season === live.season && w.week === live.week) ? live : null;

let door;
if (holding) {
  await writeFile(join(OUT, 'index.html'), holdingHTML(holding, list, prize));
  door = `week ${holding.week} is still being played (${holding.done}/${holding.games} final), so the holding card`;
} else if (newest) {
  await cp(join(WEEKS, newest.file), join(OUT, 'index.html'));
  door = `week ${newest.week} (${newest.season})`;
} else {
  await writeFile(join(OUT, 'index.html'), archive);
  door = 'no weeks yet, the archive';
}

const mb = (list.reduce((a, w) => a + w.size, 0) / 1e6).toFixed(1);
const demos = list.filter((w) => w.demo).length;
console.error(`  ${list.length} week${list.length === 1 ? '' : 's'}${demos ? ` (${demos} demo)` : ''} ` +
  `(${mb} MB)${badgeCount ? `, ${badgeCount} badges` : ', no badge art'}; ${door} is the landing page -> ${OUT}/`);
