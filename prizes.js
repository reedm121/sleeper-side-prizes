#!/usr/bin/env node
// The prize list — what the league plays for, for anyone in it to read.
//
// This is the reference sheet, not the scoreboard: /awards tracks which weeks have paid out,
// this just says what the prizes ARE. Two ways through the same 30, because managers ask two
// different questions of a list like this — "what can my quarterback win me" and "how many of
// these are just yardage" — and neither ordering answers both.
//
// Prizes the manager turned down are NOT here. They are still in the catalogue, still on
// /shortlist, and still reopenable; they are simply not what the league plays for, and a list
// of what we play for should not be half struck-through text.
//
// Output goes to public/, which site.js assembles and Vercel serves.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AWARDS, PLAYED, HOUSE, PHASES, phaseOf, phaseTag, phaseHue } from './awards.js';
import { badgeImg, badgeCSS } from './badges.js';
import { tiebreakRule } from './compute.js';
import { LEAGUE } from './lib/league.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const retiredCount = AWARDS.length - PLAYED.length;

// Which part of the game the prize comes off, defined once in awards.js so the week page, the
// prize board and the shortlist all tag a prize the same way this list groups it.

// What the prize actually measures. Ordered: the first rule that matches wins, so "Longest
// Touchdown" lands under longest-play rather than touchdowns, which is how people think of it.
const keysOf = (a) => (a.keys || []).concat(a.num || []).concat(a.where?.key ? [a.where.key] : []).join(' ');
const measureOf = (a) => {
  if (a.agg === 'ratio') return 'Efficiency';
  if (['delta', 'luckyLoser', 'luckyWinner', 'closest', 'shootout', 'margin', 'shareOfTeam', 'bench'].includes(a.agg)) return 'Team score and matchup';
  if (a.agg === 'points' || a.agg === 'slot' || a.agg === 'projDelta') return 'Fantasy points';
  if (a.agg === 'drive' || /_lng/.test(keysOf(a))) return 'Longest single play';
  if (/td/.test(keysOf(a))) return 'Touchdowns';
  if (a.pos && a.pos[0] === 'DEF') return 'Defense';
  if (a.unit === 'yd') return 'Yardage';
  return 'Volume and big plays';
};

const MEASURES = ['Fantasy points', 'Team score and matchup', 'Yardage', 'Longest single play',
  'Touchdowns', 'Volume and big plays', 'Efficiency', 'Defense'];

// Only the groups whose name leaves a real question get a note; the rest print none.
const NOTE = {
  'Team score': 'No single play in it — what your lineup scored, or what it scored against something else.',
  'All-purpose': 'Running, catching and throwing all count toward the same number.',
  'Fantasy points': 'Scored with the league’s own settings.',
  'Team score and matchup': 'Your score against something else: last week, the other guy, or your bench.',
  'Longest single play': 'One play, not a total.',
  Efficiency: 'Rate stats, gated by a minimum volume.',
};

function row(a) {
  const pos = phaseTag(a);
  const hue = phaseHue(a);
  return `<div class="row${hue ? ' haspos' : ''}"${hue ? ` style="--pc:var(--p-${hue})"` : ''}>
  ${badgeImg(a.id)}
  <div class="txt">
    <div class="nmline">
      <span class="nm">${esc(a.name)}</span>
      ${pos ? `<span class="pos">${esc(pos)}</span>` : ''}
    </div>
    <div class="bl">${esc(a.blurb)}</div>
    <div class="tb">${esc(tiebreakRule(a))}</div>
  </div>
  ${a.unit ? `<span class="unit">${esc(a.unit)}</span>` : ''}
</div>`;
}

function sections(order, keyOf, cls) {
  const by = {};
  for (const a of PLAYED) (by[keyOf(a)] ||= []).push(a);
  return order
    .filter((name) => by[name]?.length)
    .map((name) => `<section class="grp ${cls}">
  <h2 class="sec">${esc(name)} <span class="n">${by[name].length}</span></h2>
  ${NOTE[name] ? `<p class="secnote">${NOTE[name]}</p>` : ''}
  ${by[name].map(row).join('\n  ')}
</section>`)
    .join('\n');
}

const CSS = `
:root{
  --ground:#070B16; --panel:#101827; --panel-2:#162034;
  --line:#22304C; --line-2:#2E4066;
  --ink:#EDF2FF; --muted:#94A5C9; --faint:#61729A;
  --gold:#FFC93C; --cyan:#3FD8F0;
  /* Sleeper's own position colours, carried over to the phase each one used to stand for.
     DEF was lifted from their #d26200 to stay legible on this ground. */
  --p-pass:#FF80AD; --p-rush:#49E8CC; --p-rec:#49D0EE; --p-kick:#B7C1EE; --p-def:#E8751A;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,sans-serif;font-size:17px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
#app{max-width:960px;margin:0 auto;padding-inline:20px;padding-block:0 72px}
h1,h2{margin:0;text-wrap:balance}
a{color:inherit}
.mast{position:relative;margin-inline:-20px;padding:38px 20px 26px;overflow:hidden;
  background:linear-gradient(103deg,var(--panel-2),var(--panel) 60%,var(--ground));
  border-bottom:3px solid var(--gold)}
.mast::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:repeating-linear-gradient(90deg,transparent 0 59px,rgba(148,165,201,.09) 59px 60px);
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 80%);mask-image:linear-gradient(180deg,transparent,#000 80%)}
.mast>*{position:relative}
.sitenav{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px;font-size:15px;font-weight:600;letter-spacing:.03em}
.sitenav a{color:var(--muted);text-decoration:none;border-bottom:1px solid transparent}
.sitenav a:hover{color:var(--ink);border-bottom-color:currentColor}
.sitenav a:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.eyebrow{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:18px;
  letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
h1{font-family:"Big Shoulders Display",sans-serif;font-weight:800;
  font-size:clamp(36px,8vw,62px);line-height:.92;text-transform:uppercase;margin-block:4px 10px}
.lede{color:var(--muted);max-width:64ch;margin:0}
.lede b{color:var(--ink);font-weight:600}
.switch{display:flex;flex-wrap:wrap;gap:2px;margin-block:22px 4px;background:var(--line);
  border:2px solid var(--line)}
.switch button{flex:1 1 200px;font-family:"Big Shoulders Display",sans-serif;font-weight:700;
  font-size:19px;letter-spacing:.1em;text-transform:uppercase;padding:11px 14px;cursor:pointer;
  background:var(--panel);color:var(--muted);border:none}
.switch button:hover{color:var(--ink)}
.switch button[aria-pressed="true"]{background:var(--gold);color:#241A00}
.switch button:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}
h2.sec{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:29px;
  letter-spacing:.03em;text-transform:uppercase;color:var(--cyan);
  border-bottom:2px solid var(--cyan);padding-bottom:8px;margin:34px 0 4px;
  display:flex;align-items:center;gap:12px}
h2.sec .n{font-size:17px;color:var(--faint);border:1px solid var(--line-2);border-radius:3px;
  padding:1px 8px;letter-spacing:.08em}
.secnote{color:var(--muted);font-size:15.5px;margin:0 0 14px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:var(--panel);
  border:1px solid var(--line);border-radius:3px;padding:11px 13px;margin-bottom:7px}
.row.haspos{border-left:3px solid var(--pc)}
/* Big enough to tell two badges apart at a glance while scrolling a list of thirty. */
.row .badge{--badge-size:116px}
.row .txt{flex:1;min-width:0}
.nmline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nm{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:21px;
  letter-spacing:.03em;text-transform:uppercase;line-height:1.1}
.bl{color:var(--muted);font-size:15.5px;margin-top:2px}
.tb{color:var(--faint);font-size:13px;margin-top:4px}
.pos{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:13px;font-weight:600;
  letter-spacing:.1em;padding:2px 7px;border-radius:3px;color:var(--pc);flex:none;
  background:color-mix(in srgb,var(--pc) 15%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pc) 45%,transparent)}
.tag{font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);
  border:1px solid color-mix(in srgb,var(--gold) 40%,transparent);border-radius:3px;padding:1px 6px}
.unit{flex:none;align-self:center;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;
  font-size:13px;color:var(--faint);border:1px solid var(--line);border-radius:3px;padding:2px 8px}
.grp.measure{display:none}
body[data-by="measure"] .grp.measure{display:block}
body[data-by="measure"] .grp.phase{display:none}
footer{margin-top:44px;padding-top:18px;border-top:2px solid var(--line-2);
  color:var(--faint);font-size:14.5px}
footer p{margin:0 0 7px;max-width:74ch}
footer a{color:var(--muted)}
@media (max-width:560px){
  #app{padding-inline:16px}
  .mast{margin-inline:-16px;padding-inline:16px}
  .unit{align-self:flex-start}
}
${badgeCSS()}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`.trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(LEAGUE.name)} — The Prize List</title>
<meta name="description" content="The ${PLAYED.length} side prizes ${esc(LEAGUE.name)} plays for, grouped by part of the game and by what they measure.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Big+Shoulders+Display:wght@700;800&family=IBM+Plex+Mono:wght@600&display=swap">
<style>${CSS}</style>
</head>
<body data-by="phase">
<div id="app">
  <header class="mast">
    <nav class="sitenav">
      <a href="/">This week</a>
      <a href="/awards">Prize board</a>
      <a href="/archive">All weeks</a>
    </nav>
    <div class="eyebrow">${esc(LEAGUE.name)}</div>
    <h1>The Prize List</h1>
    <p class="lede">All <b>${PLAYED.length} prizes</b> the league plays for &mdash; one drawn each
      week, after the games, from whichever of these scored.${HOUSE.length ? ` <b>${HOUSE.length}</b> are the
      house prizes; <b>${PLAYED.length - HOUSE.length}</b> more were voted in.` : ''}</p>
  </header>

  <div class="switch" role="group" aria-label="How to group the prizes">
    <button type="button" data-by="phase" aria-pressed="true">By part of the game</button>
    <button type="button" data-by="measure" aria-pressed="false">By what it measures</button>
  </div>

${sections(PHASES, phaseOf, 'phase')}
${sections(MEASURES, measureOf, 'measure')}

  <footer>
    <p>Computed from your <b>locked starters</b> for that week, not your current roster. The unit
       on the right is what the prize is measured in.</p>
    <p>${retiredCount} more prizes were turned down and are not listed. <a href="/awards">The prize
       board</a> shows which of these have been won this season.</p>
  </footer>
</div>
<script>
(function(){
  // Both groupings are already on the page; this only swaps which one is showing, so there is
  // nothing to re-render and nothing to fetch.
  var btns=document.querySelectorAll('.switch button');
  btns.forEach(function(b){
    b.addEventListener('click',function(){
      document.body.dataset.by=b.dataset.by;
      btns.forEach(function(o){ o.setAttribute('aria-pressed', String(o===b)); });
      try { localStorage.setItem('prizes-by', b.dataset.by); } catch(e){}
    });
  });
  try {
    var saved=localStorage.getItem('prizes-by');
    if(saved==='measure'||saved==='phase'){
      document.body.dataset.by=saved;
      btns.forEach(function(o){ o.setAttribute('aria-pressed', String(o.dataset.by===saved)); });
    }
  } catch(e){}
})();
</script>
</body>
</html>`;

const out = process.argv[2] || 'public/prizes.html';
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.error(`  prize list: ${PLAYED.length} prizes, two groupings -> ${out}`);
