#!/usr/bin/env node
// Generates the prize shortlist page — a checklist the league manager marks up.
//
// Counts shown in the copy are read from AWARDS.house at render time rather than written
// out here, so promoting a prize into the house list (as "Now Watch This Drive" was) cannot
// leave the page claiming a number it no longer has.
//
// The page is a static shell. Verdicts and notes live server-side behind /api/state, so
// anyone holding the link can mark it up without an account — which the artifact version
// could not do, since only the artifact's owner was ever a writer.
//
// Output goes to public/, which site.js assembles and Vercel serves.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AWARDS, HOUSE, TIERS, phaseTag, phaseHue } from './awards.js';
import { badgeCSS, hasBadge } from './badges.js';
import { LEAGUE } from './lib/league.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const houseIds = new Set(HOUSE.map((a) => a.id));
const candidates = AWARDS.filter((a) => !houseIds.has(a.id));

const byTier = {};
for (const a of candidates) (byTier[a.tier] ||= []).push(a);

// One chip, naming the phase, so the browser has nothing left to work out. `pos` no longer
// travels: who is eligible is in the blurb, and it was only ever sent here to be printed.
const slim = (a) => ({ id: a.id, name: a.name, blurb: a.blurb, tag: phaseTag(a), hue: phaseHue(a), art: hasBadge(a.id) });

const data = {
  league: LEAGUE.name,
  house: HOUSE.map(slim),
  tiers: Object.keys(byTier).map((t) => ({
    key: t, name: TIERS[t].name, note: TIERS[t].note,
    awards: byTier[t].map(slim),
  })),
};

const CSS = `
:root{
  --ground:#070B16; --panel:#101827; --panel-2:#162034;
  --line:#22304C; --line-2:#2E4066;
  --ink:#EDF2FF; --muted:#94A5C9; --faint:#61729A;
  --gold:#FFC93C; --yes:#C9FF3D; --no:#FF6B6B; --cyan:#3FD8F0;
  /* Sleeper's position colours, carried over to the phase each one used to stand for.
     DEF was lifted from their #d26200 to stay legible here. */
  --p-pass:#FF80AD; --p-rush:#49E8CC; --p-rec:#49D0EE; --p-kick:#B7C1EE; --p-def:#E8751A;
}
.pos{
  font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:13px; font-weight:600;
  letter-spacing:.1em; padding:2px 7px; border-radius:3px; color:var(--pc); flex:none;
  background:color-mix(in srgb,var(--pc) 15%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pc) 45%,transparent);
}
.row.haspos{border-left:3px solid var(--pc)}
.lock.haspos{border-left-color:var(--pc)}
.nmline{display:flex; align-items:center; gap:8px; flex-wrap:wrap}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,sans-serif;font-size:17px;line-height:1.5;
  -webkit-font-smoothing:antialiased}
#app{max-width:1000px;margin:0 auto;padding-inline:20px;padding-block:0 72px}
h1,h2,h3{margin:0;text-wrap:balance}
.mast{position:relative;margin-inline:-20px;padding:38px 20px 26px;overflow:hidden;
  background:linear-gradient(103deg,var(--panel-2),var(--panel) 60%,var(--ground));
  border-bottom:3px solid var(--gold)}
.mast::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:repeating-linear-gradient(90deg,transparent 0 59px,rgba(148,165,201,.09) 59px 60px);
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 80%);mask-image:linear-gradient(180deg,transparent,#000 80%)}
.mast>*{position:relative}
.sitenav{display:flex;gap:18px;margin-bottom:18px;font-size:15px;font-weight:600;letter-spacing:.03em}
.sitenav a{color:var(--muted);text-decoration:none;border-bottom:1px solid transparent}
.sitenav a:hover{color:var(--ink);border-bottom-color:currentColor}
.sitenav a:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.eyebrow{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:18px;
  letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
h1{font-family:"Big Shoulders Display",sans-serif;font-weight:800;
  font-size:clamp(36px,8vw,62px);line-height:.92;letter-spacing:.01em;text-transform:uppercase;margin-block:4px 10px}
.lede{color:var(--muted);max-width:62ch;margin:0}
.lede b{color:var(--ink);font-weight:600}
.tally{display:flex;flex-wrap:wrap;gap:2px;background:var(--line);border:2px solid var(--line);border-top:none;margin-bottom:10px}
.tcell{flex:1 1 120px;background:var(--panel);padding:13px 15px}
.tcell .k{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:15px;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.tcell .v{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:34px;line-height:1}
.tcell.y .v{color:var(--yes)} .tcell.n .v{color:var(--no)} .tcell.u .v{color:var(--faint)}
.status{min-height:22px;font-size:15px;color:var(--faint);padding-block:6px}
.status.saving{color:var(--cyan)} .status.saved{color:var(--yes)} .status.ro{color:var(--gold)}
h2.sec{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:29px;
  letter-spacing:.03em;text-transform:uppercase;color:var(--cyan);
  border-bottom:2px solid var(--cyan);padding-bottom:8px;margin:34px 0 4px}
h2.sec.locked{color:var(--gold);border-color:var(--gold)}
.secnote{color:var(--muted);font-size:15.5px;margin:0 0 14px}
.locked-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:8px;margin-bottom:8px}
.lock{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);
  border-radius:3px;padding:9px 12px;font-size:16px;display:flex;align-items:flex-start;gap:10px}
/* Top-aligned: these cards are a four-across grid and their blurbs run to five lines, so a
   centred badge would float halfway down a tall card with its own name far above it. */
.lock .txt{min-width:0}
.lock .badge{--badge-size:76px;margin-top:2px}
.lock b{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:18px;
  letter-spacing:.03em;text-transform:uppercase}
.lock span{color:var(--faint);font-size:14.5px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:var(--panel);
  border:1px solid var(--line);border-radius:3px;padding:11px 13px;margin-bottom:7px}
.row .badge{--badge-size:104px}
.row.yes{border-color:color-mix(in srgb,var(--yes) 45%,var(--line));background:color-mix(in srgb,var(--yes) 6%,var(--panel))}
.row.no{opacity:.5}
.row .txt{flex:1;min-width:0}
.row .nm{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:20px;
  letter-spacing:.03em;text-transform:uppercase;line-height:1.1}
.row .bl{color:var(--muted);font-size:15px;margin-top:1px}
.btns{display:flex;gap:6px;flex:none}
.btns button{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:19px;
  width:42px;height:36px;border-radius:3px;cursor:pointer;background:none;
  border:1px solid var(--line-2);color:var(--faint);line-height:1}
.btns button:hover{border-color:var(--ink);color:var(--ink)}
.btns button:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.btns button.on-yes{background:var(--yes);border-color:var(--yes);color:#16210A}
.btns button.on-no{background:var(--no);border-color:var(--no);color:#2A0A0A}
.btns button[disabled]{cursor:default;opacity:.45}
.anote{flex-basis:100%}
.anote .ntext{margin:0 0 7px;padding:8px 11px;font-size:15.5px;color:var(--ink);
  background:var(--panel-2);border-left:2px solid var(--cyan);border-radius:0 3px 3px 0;
  white-space:pre-wrap;overflow-wrap:anywhere}
.anote button{font-family:inherit;font-size:14px;font-weight:600;letter-spacing:.04em;
  color:var(--faint);background:none;border:1px dashed var(--line-2);border-radius:3px;
  padding:3px 9px;cursor:pointer}
.anote button:hover{color:var(--ink);border-color:var(--ink);border-style:solid}
.anote button:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.anote button[disabled]{cursor:default;opacity:.45}
.nta{width:100%;min-height:64px;padding:9px 11px;font:inherit;font-size:15.5px;color:var(--ink);
  background:var(--panel-2);border:1px solid var(--line-2);border-radius:3px;resize:vertical}
.nta:focus-visible{outline:2px solid var(--cyan);outline-offset:1px}
.ndone{margin-top:6px}
.notebox{margin-top:30px}
.notebox label{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:17px;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px}
#note{width:100%;min-height:84px;padding:11px 13px;font:inherit;font-size:16px;color:var(--ink);
  background:var(--panel);border:1px solid var(--line-2);border-radius:3px;resize:vertical}
#note:focus-visible{outline:2px solid var(--cyan);outline-offset:1px}
footer{margin-top:40px;padding-top:18px;border-top:2px solid var(--line-2);color:var(--faint);font-size:15px}
footer p{margin:0 0 7px;max-width:74ch}
@media (max-width:560px){
  #app{padding-inline:16px}.mast{margin-inline:-16px;padding-inline:16px}
  .locked-grid{grid-template-columns:1fr}
  .row{flex-wrap:wrap}.btns{width:100%;justify-content:flex-end}
}
${badgeCSS()}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`.trim();

const JS = String.raw`
(function(){
  var AWARDS = JSON.parse(document.getElementById('awards').textContent);
  var NAME = AWARDS.league;
  var state = { verdicts: {}, notes: {}, note: '', updatedAt: null };
  var version = null;              // null until the first load lands
  var readOnly = true;             // nothing is editable until it does
  var roMessage = 'Loading saved marks...';
  var timer = null, dirty = false, retried = false;

  // Which ids this view has changed since it last agreed with the server. Needed only to
  // resolve a conflict: without it, folding in someone else's marks would resurrect one
  // this view had just cleared.
  var touched = blankTouched();
  function blankTouched(){ return { verdicts: {}, notes: {}, note: false }; }
  // Which note editors are open. Deliberately NOT part of state: whether you happen to have
  // a box open is yours, not something to publish to everyone else's screen.
  var editing = {};

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function counts(){
    var y=0,n=0,total=0;
    AWARDS.tiers.forEach(function(t){ t.awards.forEach(function(a){
      total++; if(state.verdicts[a.id]==='yes') y++; else if(state.verdicts[a.id]==='no') n++; }); });
    return {yes:y,no:n,untouched:total-y-n,total:total};
  }

  // A note is the manager clarifying a prize, so everyone reads it; only writers edit it.
  function noteBlock(a){
    var note = state.notes[a.id] || '';
    if (readOnly) return note ? '<div class="anote"><p class="ntext">'+esc(note)+'</p></div>' : '';
    if (editing[a.id]) {
      return '<div class="anote">'
        + '<textarea class="nta" data-id="'+a.id+'" aria-label="Note on '+esc(a.name)+'" '
        +   'placeholder="What needs clarifying?">'+esc(note)+'</textarea>'
        + '<button class="ndone" data-note="done" data-id="'+a.id+'">Done</button></div>';
    }
    return '<div class="anote">'
      + (note ? '<p class="ntext">'+esc(note)+'</p>' : '')
      + '<button data-note="edit" data-id="'+a.id+'">'
      +   (note ? 'Edit note' : '+ Add note') + '</button></div>';
  }

  function focusNote(id){
    var ta = document.querySelector('.nta[data-id="'+id+'"]');
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function render(){
    var c = counts();
    var h = '';
    h += '<header class="mast">'
      + '<nav class="sitenav"><a href="/">This week</a><a href="/awards">Prize board</a><a href="/prizes">The prize list</a></nav>'
      + '<div class="eyebrow">'+esc(NAME)+' &middot; Side Prizes</div>'
      + '<h1>Prize Shortlist</h1>'
      + '<p class="lede">The <b>' + AWARDS.house.length + ' we already run</b> are locked in below. Everything under them is a '
      + 'prize the stat feed can compute but we do not currently hand out. Mark anything you want added '
      + '&mdash; <b>&check;</b> for yes, <b>&times;</b> for no, and <b>add a note</b> on anything that needs '
      + 'pinning down. It all saves for everyone automatically.</p>'
      + '</header>';

    h += '<div class="tally">'
      + '<div class="tcell y"><div class="k">Wants</div><div class="v">'+c.yes+'</div></div>'
      + '<div class="tcell n"><div class="k">Passed</div><div class="v">'+c.no+'</div></div>'
      + '<div class="tcell u"><div class="k">Not yet marked</div><div class="v">'+c.untouched+'</div></div>'
      + '<div class="tcell"><div class="k">Currently run</div><div class="v">'+AWARDS.house.length+'</div></div>'
      + '</div>';
    h += '<div class="status" id="status"></div>';

    // Only the prizes that were illustrated have one; the candidates below mostly have not
    // been, and a row without a badge simply starts at its name.
    var art = function(a, cls){
      return a.art ? '<img class="badge'+(cls?' '+cls:'')+'" src="/badges/'+a.id+'.webp" alt="" '
        + 'width="320" height="320" loading="lazy" decoding="async">' : '';
    };

    h += '<h2 class="sec locked">Already In</h2>'
      + '<p class="secnote">The ' + AWARDS.house.length + ' the league plays for now. Nothing to decide here.</p>'
      + '<div class="locked-grid">'
      + AWARDS.house.map(function(a){
          var pc = a.hue ? ' haspos" style="--pc:var(--p-'+a.hue+')' : '';
          return '<div class="lock'+pc+'">'+art(a)+'<div class="txt"><div class="nmline"><b>'+esc(a.name)+'</b>'
            + (a.tag ? '<span class="pos" style="--pc:var(--p-'+a.hue+')">'+esc(a.tag)+'</span>' : '')
            + '</div><span>'+esc(a.blurb)+'</span></div></div>'; }).join('')
      + '</div>';

    AWARDS.tiers.forEach(function(t){
      h += '<h2 class="sec">'+esc(t.name)+'</h2><p class="secnote">'+esc(t.note)+'</p>';
      t.awards.forEach(function(a){
        var v = state.verdicts[a.id] || '';
        var pc = a.hue ? ' haspos" style="--pc:var(--p-'+a.hue+')' : '';
        h += '<div class="row '+v+pc+'">' + art(a)
          + '<div class="txt"><div class="nmline"><span class="nm">'+esc(a.name)+'</span>'
          + (a.tag ? '<span class="pos" style="--pc:var(--p-'+a.hue+')">'+esc(a.tag)+'</span>' : '')
          + '</div><div class="bl">'+esc(a.blurb)+'</div></div>'
          + '<div class="btns">'
          + '<button data-id="'+a.id+'" data-v="yes" aria-pressed="'+(v==='yes')+'" '
          +   'aria-label="Yes to '+esc(a.name)+'" class="'+(v==='yes'?'on-yes':'')+'">&check;</button>'
          + '<button data-id="'+a.id+'" data-v="no" aria-pressed="'+(v==='no')+'" '
          +   'aria-label="No to '+esc(a.name)+'" class="'+(v==='no'?'on-no':'')+'">&times;</button>'
          + '</div>' + noteBlock(a) + '</div>';
      });
    });

    h += '<div class="notebox"><label for="note">Anything else you want counted</label>'
      + '<textarea id="note" placeholder="Ideas the list does not cover...">'+esc(state.note||'')+'</textarea></div>';

    h += '<footer><p>Every prize here is computed from each team\'s actual locked starters for the week, '
      + 'so anything marked yes can go live immediately &mdash; no manual scoring.</p>'
      + '<p id="stamp"></p></footer>';

    document.getElementById('app').innerHTML = h;
    if (state.updatedAt) {
      document.getElementById('stamp').textContent =
        'Last marked ' + new Date(state.updatedAt).toLocaleString();
    }
    if (readOnly) {
      Array.prototype.forEach.call(document.querySelectorAll('.btns button,#note,.nta,.anote button'),
        function(el){ el.disabled = true; });
      setStatus(roMessage, 'ro');
    }
  }

  function setStatus(msg, cls){
    var el = document.getElementById('status');
    if (el) { el.textContent = msg; el.className = 'status' + (cls ? ' ' + cls : ''); }
  }

  function stamp(){
    var el = document.getElementById('stamp');
    if (el && state.updatedAt) el.textContent = 'Last marked ' + new Date(state.updatedAt).toLocaleString();
  }

  // Someone else's document is now the truth. Take it wholesale, then re-apply only what
  // this view has changed since it last agreed with the server — including clearings, which
  // is why a bare object-spread of local over remote will not do.
  function merge(remote){
    var out = { verdicts: {}, notes: {}, note: remote.note || '', updatedAt: remote.updatedAt }, k;
    for (k in remote.verdicts) out.verdicts[k] = remote.verdicts[k];
    for (k in remote.notes) out.notes[k] = remote.notes[k];
    for (k in touched.verdicts) {
      if (state.verdicts[k]) out.verdicts[k] = state.verdicts[k]; else delete out.verdicts[k];
    }
    for (k in touched.notes) {
      if (state.notes[k]) out.notes[k] = state.notes[k]; else delete out.notes[k];
    }
    if (touched.note) out.note = state.note;
    return out;
  }

  // Several quick marks collapse into one write.
  function save(){
    if (readOnly) return;
    clearTimeout(timer);
    dirty = true;
    retried = false;
    setStatus('Saving...', 'saving');
    timer = setTimeout(push, 700);
  }

  function push(){
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: version, state: state })
    }).then(function(r){
      return r.json().then(function(b){ return { status: r.status, body: b }; },
                           function(){ return { status: r.status, body: {} }; });
    }).then(function(r){
      if (r.status === 200) {
        version = r.body.version;
        state.updatedAt = r.body.state.updatedAt;
        touched = blankTouched();
        dirty = false;
        setStatus('Saved for everyone.', 'saved');
        stamp();
        return;
      }
      if (r.status === 409) {
        version = r.body.version;
        state = merge(r.body.state);
        render();
        // One retry only. A second conflict means something is writing in a loop, and
        // hammering the store would be worse than telling the user to reload.
        if (retried) { dirty = false; setStatus('Someone else is marking at the same time — reload to catch up.'); return; }
        retried = true;
        push();
        return;
      }
      setStatus('Could not save (' + ((r.body && (r.body.message || r.body.error)) || r.status) + ').');
    }, function(){
      setStatus('Could not save — you look offline. Your marks are still on screen; try again.');
    });
  }

  document.addEventListener('click', function(e){
    var nb = e.target.closest('.anote button');
    if (nb && !readOnly) {
      var nid = nb.dataset.id;
      if (nb.dataset.note === 'edit') { editing[nid] = true; render(); focusNote(nid); }
      else {
        delete editing[nid];
        // An emptied box is a deleted note, not a blank one — but opening and closing an
        // empty box changed nothing, and must not burn a publish saying so.
        if (!(state.notes[nid] || '').trim() && nid in state.notes) {
          delete state.notes[nid]; touched.notes[nid] = true; save();
        }
        render();
      }
      return;
    }
    var b = e.target.closest('.btns button');
    if (!b || readOnly) return;
    var id = b.dataset.id, v = b.dataset.v;
    if (state.verdicts[id] === v) delete state.verdicts[id]; else state.verdicts[id] = v;
    touched.verdicts[id] = true;
    render(); save();
  });
  document.addEventListener('input', function(e){
    if (readOnly) return;
    if (e.target.id === 'note') { state.note = e.target.value; touched.note = true; save(); return; }
    // No render() here — rebuilding the DOM mid-keystroke would drop focus and the caret.
    if (e.target.classList.contains('nta')) {
      state.notes[e.target.dataset.id] = e.target.value;
      touched.notes[e.target.dataset.id] = true;
      save();
    }
  });
  window.addEventListener('beforeunload', function(e){
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // Another view may have marked something since this page loaded. Nothing is adopted while
  // this one has unsaved edits or an open note editor, so a poll can never eat a keystroke.
  //
  // A hidden tab does not poll at all. Left in, a forgotten background tab would spend about
  // 130k Redis commands a month watching a page nobody is looking at, which is several times
  // the free tier on its own. Coming back to the tab polls immediately, so this costs nothing.
  function poll(){
    if (document.hidden) return;
    if (readOnly || dirty || Object.keys(editing).length) return;
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    fetch('/api/state').then(function(r){ return r.ok ? r.json() : null; }).then(function(b){
      if (!b || b.version === version) return;
      version = b.version;
      state = b.state;
      touched = blankTouched();
      render();
    }, function(){});
  }

  render();

  fetch('/api/state').then(function(r){
    return r.json().then(function(b){
      if (!r.ok) throw new Error(b.message || b.error || ('HTTP ' + r.status));
      return b;
    });
  }).then(function(b){
    version = b.version;
    state = b.state;
    if (!state.notes) state.notes = {};
    readOnly = false;
    render();
    setStatus('');
    setInterval(poll, 30000);
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) poll(); });
  }, function(e){
    roMessage = 'Could not load the saved marks (' + e.message + '), so nothing here will save.';
    render();
  });
})();
`.trim();

// As an Artifact this page got its doctype, <html> and viewport meta from the runtime wrapper.
// Served raw it gets none of them, so a phone lays it out at a virtual 980px and shrinks it,
// and the missing doctype drops the document into quirks mode.
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(LEAGUE.name)} — Prize Shortlist</title>
<meta name="description" content="Side prizes ${esc(LEAGUE.name)} could add — mark the ones worth playing for.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Big+Shoulders+Display:wght@700;800&display=swap">
<style id="appcss">${CSS}</style>
</head>
<body>
<div id="app"></div>
<script id="awards" type="application/json">${JSON.stringify(data)}</script>
<script id="appjs">${JS}</script>
</body>
</html>`;

const out = process.argv[2] || 'public/shortlist.html';
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.error(`${HOUSE.length} locked in, ${candidates.length} to decide on -> ${out}`);
