#!/usr/bin/env node
// The prize board — every prize the league is playing for this season, and which week each
// one paid out.
//
// This page is the season's running ledger, so it is built from wheel.json and the catalogue
// alone. It never touches Sleeper and never opens a built week page: a prize is "won" because
// the wheel recorded it, and the winner's name is the one build.js wrote down at the time.
// That keeps the board honest about history — editing a blurb next season cannot rewrite what
// week 2 paid.
//
// The wheel draws without replacement within a season (see wheel.js), so "still on the wheel"
// is a real statement about what can come up next, not decoration. One season per board for
// the same reason.
//
// Output goes to public/, which site.js assembles and Vercel serves.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AWARDS, PLAYED, HOUSE, TIERS, phaseTag, phaseHue } from './awards.js';
import { badgeImg, badgeCSS, hasBadge } from './badges.js';
import { LEAGUE } from './lib/league.js';
import { canonicalLedger } from './lib/ids.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const LEDGER = 'wheel.json';
let draws = [];
let pending = [];
try {
  const led = canonicalLedger(JSON.parse(await readFile(LEDGER, 'utf8')));
  draws = led.draws || [];
  pending = led.pending || [];
} catch { draws = []; pending = []; }

// One board per season, newest first, because the wheel's no-repeat rule is per season.
const season = draws.length || pending.length
  ? Math.max(...[...draws, ...pending].map((d) => d.season))
  : new Date().getFullYear();
const thisSeason = draws.filter((d) => d.season === season).sort((a, b) => a.week - b.week);

// Weeks that are built and sealed but not yet spun. Their prize does not exist anywhere on
// this page — it exists only server-side, so the card below is filled in by asking /api/wheel
// once the page loads, and says so plainly until then.
const sealedWeeks = pending
  .filter((p) => p.season === season && !draws.some((d) => d.season === p.season && d.week === p.week))
  .sort((a, b) => a.week - b.week);
const wonBy = new Map(thisSeason.map((d) => [d.pick, d]));

// A prize retired after it had already paid out still belongs on this season's board — it was
// played for and somebody took it. It is shown struck through rather than silently dropped.
const board = [...PLAYED];
for (const d of thisSeason) {
  if (board.some((a) => a.id === d.pick)) continue;
  const retired = AWARDS.find((a) => a.id === d.pick);
  if (retired) board.push(retired);
}

const houseIds = new Set(HOUSE.map((a) => a.id));
const byTier = {};
for (const a of board) (byTier[a.tier] ||= []).push(a);

const drawn = thisSeason.length;
const remaining = board.length - drawn;
const retiredCount = AWARDS.length - PLAYED.length;


// Values are recorded as numbers; a points total wants its decimals and a yardage does not.
const fmt = (v, unit) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = unit === 'pts' || unit === '%' ? n.toFixed(2) : String(Math.round(n * 100) / 100);
  return unit ? `${s} ${unit}` : s;
};

function winnerLine(d) {
  if (!d.winner) return '<span class="nowin">winner not recorded &mdash; rebuild the week</span>';
  const { teams, value, unit, tied, split } = d.winner;
  const who = teams.map(esc).join(' &amp; ');
  const tag = split ? ' <i>split</i>' : tied ? ' <i>tied</i>' : '';
  return `<b>${who}</b>${tag} <span class="val">${esc(fmt(value, unit))}</span>`;
}

function awardRow(a) {
  const d = wonBy.get(a.id);
  const pos = phaseTag(a);
  const hue = phaseHue(a);
  const retired = Boolean(a.out);
  const cls = ['row', d ? 'won' : '', hue ? 'haspos' : '', retired ? 'retired' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-award="${esc(a.id)}"${hue ? ` style="--pc:var(--p-${hue})"` : ''}>
  ${badgeImg(a.id)}
  <div class="txt">
    <div class="nmline">
      <span class="nm">${esc(a.name)}</span>
      ${pos ? `<span class="pos">${esc(pos)}</span>` : ''}
      ${retired ? '<span class="tag">retired since</span>' : ''}
    </div>
    <div class="bl">${esc(a.blurb)}</div>
    ${d ? `<div class="won-by">${winnerLine(d)}</div>` : ''}
  </div>
  ${d
    ? `<a class="chip hit" href="/weeks/${d.season}-week-${d.week}">Week ${d.week}</a>`
    : '<span class="chip open">On the wheel</span>'}
</div>`;
}

function section(title, note, awards, locked) {
  if (!awards?.length) return '';
  const won = awards.filter((a) => wonBy.has(a.id)).length;
  return `<h2 class="sec${locked ? ' locked' : ''}">${esc(title)}</h2>
<p class="secnote">${note ? `${esc(note)} ` : ''}<span class="secn">${won} of ${awards.length} drawn</span></p>
${awards.map(awardRow).join('\n')}`;
}

const CSS = `
:root{
  --ground:#070B16; --panel:#101827; --panel-2:#162034; --raise:#1B2740;
  --line:#22304C; --line-2:#2E4066;
  --ink:#EDF2FF; --muted:#94A5C9; --faint:#61729A;
  --gold:#FFC93C; --cyan:#3FD8F0; --yes:#C9FF3D;
  /* Sleeper's position colours, carried over to the phase each one used to stand for.
     DEF was lifted from their #d26200 to stay legible here. */
  --p-pass:#FF80AD; --p-rush:#49E8CC; --p-rec:#49D0EE; --p-kick:#B7C1EE; --p-def:#E8751A;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,sans-serif;font-size:17px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
#app{max-width:1000px;margin:0 auto;padding-inline:20px;padding-block:0 72px}
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
  font-size:clamp(36px,8vw,62px);line-height:.92;letter-spacing:.01em;text-transform:uppercase;margin-block:4px 10px}
.lede{color:var(--muted);max-width:64ch;margin:0}
.lede b{color:var(--ink);font-weight:600}
.tally{display:flex;flex-wrap:wrap;gap:2px;background:var(--line);border:2px solid var(--line);border-top:none;margin-bottom:18px}
.tcell{flex:1 1 120px;background:var(--panel);padding:13px 15px}
.tcell .k{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:15px;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.tcell .v{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:34px;line-height:1}
.tcell.w .v{color:var(--gold)} .tcell.o .v{color:var(--cyan)}
h2.sec{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:29px;
  letter-spacing:.03em;text-transform:uppercase;color:var(--cyan);
  border-bottom:2px solid var(--cyan);padding-bottom:8px;margin:34px 0 4px}
h2.sec.locked{color:var(--gold);border-color:var(--gold)}
.secnote{color:var(--muted);font-size:15.5px;margin:0 0 14px}
.secn{color:var(--faint);white-space:nowrap}
.secn::before{content:"\\00b7";margin-inline:6px}

/* The settled-weeks strip: the season read as a story, newest last. */
.weeks{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:8px;margin-bottom:6px}
.wk{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);
  border-radius:3px;padding:11px 13px;text-decoration:none;display:flex;align-items:center;gap:11px}
.wk .txt{min-width:0}
.wk .badge{--badge-size:92px}
.wk:hover{border-color:var(--line-2);border-left-color:var(--gold);background:var(--panel-2)}
.wk:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.wk .k{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:15px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
.wk .t{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:21px;
  line-height:1.05;text-transform:uppercase;margin-block:2px 3px}
.wk .w{color:var(--muted);font-size:14.5px}
.wk .w b{color:var(--ink);font-weight:600}
.wk.sealed{border-left-color:var(--cyan)}
.wk.sealed .t{color:var(--cyan)}
.wk.sealed .w{color:var(--faint)}

.row{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:var(--panel);
  border:1px solid var(--line);border-radius:3px;padding:11px 13px;margin-bottom:7px}
/* The board's whole question is which prizes have paid and which are still out there, so a
   badge that has not been drawn this season is held back rather than lit. Not hidden — the
   art is how you recognise the prize, and these are the ones that could come up next. */
.row .badge{--badge-size:112px; opacity:.42; filter:grayscale(.65) drop-shadow(0 2px 6px rgba(0,0,0,.45))}
.row.won .badge{opacity:1; filter:drop-shadow(0 2px 8px rgba(0,0,0,.5))}
.row.haspos{border-left:3px solid var(--pc)}
.row.won{background:color-mix(in srgb,var(--gold) 7%,var(--panel));
  border-color:color-mix(in srgb,var(--gold) 40%,var(--line))}
.row.retired .nm{text-decoration:line-through;text-decoration-thickness:1px;color:var(--muted)}
.row .txt{flex:1;min-width:0}
.nmline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nm{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:20px;
  letter-spacing:.03em;text-transform:uppercase;line-height:1.1}
.bl{color:var(--muted);font-size:15px;margin-top:1px}
.pos{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:13px;font-weight:600;
  letter-spacing:.1em;padding:2px 7px;border-radius:3px;color:var(--pc);flex:none;
  background:color-mix(in srgb,var(--pc) 15%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pc) 45%,transparent)}
.tag{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);
  border:1px dashed var(--line-2);border-radius:3px;padding:1px 6px}
.won-by{margin-top:6px;font-size:15.5px;color:var(--muted)}
.won-by b{color:var(--ink);font-weight:600}
.won-by i{font-style:normal;color:var(--faint);font-size:14px}
.won-by .val{color:var(--gold);font-variant-numeric:tabular-nums}
.won-by .nowin{color:var(--faint);font-size:14.5px}
.chip{flex:none;align-self:center;font-family:"Big Shoulders Display",sans-serif;font-weight:700;
  font-size:16px;letter-spacing:.1em;text-transform:uppercase;padding:5px 11px;border-radius:3px;
  text-decoration:none;white-space:nowrap}
.chip.hit{background:var(--gold);color:#241A00}
.chip.hit:hover{filter:brightness(1.12)}
.chip.hit:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.chip.open{color:var(--faint);border:1px solid var(--line-2)}
footer{margin-top:44px;padding-top:18px;border-top:2px solid var(--line-2);
  color:var(--faint);font-size:14.5px}
footer p{margin:0 0 7px;max-width:74ch}
footer a{color:var(--muted)}
@media (max-width:560px){
  #app{padding-inline:16px}
  .mast{margin-inline:-16px;padding-inline:16px}
  .chip{align-self:flex-start}
}
${badgeCSS()}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`.trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(LEAGUE.name)} — Prize Board</title>
<meta name="description" content="Every side prize ${esc(LEAGUE.name)} is playing for this season, and which week each one paid out.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Big+Shoulders+Display:wght@700;800&family=IBM+Plex+Mono:wght@600&display=swap">
<style>${CSS}</style>
</head>
<body>
<div id="app">
  <header class="mast">
    <nav class="sitenav">
      <a href="/">This week</a>
      <a href="/archive">All weeks</a>
      <a href="/prizes">The prize list</a>
    </nav>
    <div class="eyebrow">${esc(LEAGUE.name)} &middot; ${season}</div>
    <h1>The Prize Board</h1>
    <p class="lede">All <b>${board.length} prizes in play</b> this season. One is drawn each week
      by <a href="/">the wheel</a> from whatever scored that week, and never drawn twice.</p>
  </header>

  <div class="tally">
    <div class="tcell"><div class="k">In play</div><div class="v">${board.length}</div></div>
    <div class="tcell w"><div class="k">Won</div><div class="v">${drawn}</div></div>
    <div class="tcell o"><div class="k">Still up</div><div class="v">${remaining}</div></div>
  </div>

${thisSeason.length || sealedWeeks.length ? `  <h2 class="sec locked">Settled weeks</h2>
  <div class="weeks">
${thisSeason.map((d) => `    <a class="wk" href="/weeks/${d.season}-week-${d.week}">
      ${badgeImg(d.pick)}
      <div class="txt">
        <div class="k">Week ${d.week}</div>
        <div class="t">${esc(d.winner?.name || AWARDS.find((a) => a.id === d.pick)?.name || d.pick)}</div>
        <div class="w">${winnerLine(d)}</div>
      </div>
    </a>`).join('\n')}
${sealedWeeks.map((p) => `    <a class="wk sealed" href="/weeks/${p.season}-week-${p.week}" data-season="${p.season}" data-week="${p.week}">
      <div class="txt">
        <div class="k">Week ${p.week}</div>
        <div class="t">Sealed</div>
        <div class="w">Waiting on the spin &mdash; one of ${p.pool.length}</div>
      </div>
    </a>`).join('\n')}
  </div>` : `  <p class="secnote">No week has settled yet &mdash; every prize below is still up.</p>`}

${section(TIERS[0].name, TIERS[0].note, byTier[0], true)}

${Object.keys(TIERS).map(Number).filter((t) => t > 0).map((t) => section(TIERS[t].name, TIERS[t].note, byTier[t], false)).filter(Boolean).join('\n\n')}

  <footer>
    <p>The house prizes are permanent; everything under them was voted in, and ${retiredCount}
       more were left out. <a href="/prizes">The full list</a> has all of them.</p>
    <p>A prize is marked won from what the wheel recorded that week, with the winner as it stood
       when the week went final &mdash; nothing here is recomputed.</p>
  </footer>
</div>
${sealedWeeks.length ? `<script id="sealed" type="application/json">${
  JSON.stringify(sealedWeeks.map((p) => ({ season: p.season, week: p.week, winners: p.winners }))).replace(/</g, '\\u003c')
}<\/script>
<script>
(function(){
  // A sealed week's prize lives only on the server until the manager spins for it, so this
  // page cannot have been built knowing it. Ask, and fill the card in if the answer is out —
  // otherwise the board would keep saying "sealed" until the next deploy happened to run.
  var weeks=JSON.parse(document.getElementById('sealed').textContent);
  var total=${board.length};

  // The counters were rendered when nothing had been spun. Recount from the rows themselves
  // once a week comes in, or the board says "0 won" for the whole season.
  var retally=function(){
    var won=document.querySelectorAll('.row.won').length;
    var w=document.querySelector('.tcell.w .v'), o=document.querySelector('.tcell.o .v');
    if(w) w.textContent=won;
    if(o) o.textContent=total-won;
    document.querySelectorAll('h2.sec').forEach(function(h){
      var note=h.nextElementSibling, n=note && note.querySelector('.secn');
      if(!n) return;
      var rows=[], el=note.nextElementSibling;
      while(el && el.classList && el.classList.contains('row')){ rows.push(el); el=el.nextElementSibling; }
      if(rows.length) n.textContent=rows.filter(function(r){ return r.classList.contains('won'); }).length+' of '+rows.length+' drawn';
    });
  };
  weeks.forEach(function(w){
    fetch('/api/wheel?season='+w.season+'&week='+w.week)
      .then(function(r){ return r.json(); })
      .then(function(doc){
        if(!doc || !doc.revealed) return;
        var win=w.winners[doc.pick];
        var card=document.querySelector('.wk.sealed[data-week="'+w.week+'"][data-season="'+w.season+'"]');
        if(card && win){
          card.classList.remove('sealed');
          // The card was built without knowing the prize, so its badge has to arrive with the
          // answer. Dropped silently if there is no art for this one — a missing badge must
          // never leave a torn-image icon on the card that just announced a winner.
          var img=document.createElement('img');
          img.className='badge'; img.alt=''; img.width=320; img.height=320;
          img.onerror=function(){ img.remove(); };
          img.src='/badges/'+doc.pick+'.webp';
          card.insertBefore(img, card.firstChild);
          card.querySelector('.t').textContent=win.name;
          var line=card.querySelector('.w');
          line.textContent='';
          var b=document.createElement('b'); b.textContent=win.teams.join(' & '); line.appendChild(b);
          var v=document.createElement('span'); v.className='val';
          v.textContent=' '+win.value+(win.unit?' '+win.unit:''); line.appendChild(v);
        }
        var row=document.querySelector('.row[data-award="'+doc.pick+'"]');
        if(row && win){
          row.classList.add('won');
          var chip=row.querySelector('.chip');
          if(chip){
            var a=document.createElement('a');
            a.className='chip hit'; a.href='/weeks/'+w.season+'-week-'+w.week;
            a.textContent='Week '+w.week;
            chip.replaceWith(a);
          }
          retally();
        }
      })
      .catch(function(){});
  });
})();
<\/script>` : ''}
</body>
</html>`;

const out = process.argv[2] || 'public/awards.html';
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.error(`  prize board: ${board.length} in play, ${drawn} won, ${remaining} up -> ${out}`);
