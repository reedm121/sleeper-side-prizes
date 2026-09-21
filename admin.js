#!/usr/bin/env node
// The manager's dashboard — /admin. Pick the prizes the league plays for, mark the house ones,
// rename any of them, set the name on the masthead, and save. What it saves is the same shape
// as league.json, kept in the site's store; `config.js pull` writes it over league.json before
// every build, so the next build follows it. Nothing here touches Sleeper.
//
// Who may save is decided in lib/admin.js: a password from the environment on a deployed site,
// or whoever is at the keyboard on a laptop. Reading is open — what a league plays for is on
// /prizes anyway. The shortlist's votes show beside each prize so the manager can see what the
// league asked for while deciding.
//
// Output goes to public/, which site.js assembles and Vercel serves.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GLOSSARY, TIERS, phaseTag, phaseHue } from './awards.js';
import { badgeCSS, hasBadge } from './badges.js';
import { LEAGUE } from './lib/league.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The glossary as the page needs it: generic names (the league's own are in the config), the
// tier it lists under, and the things a manager should know before ticking it.
const caveat = (a) => [
  a.void ? 'stat can go dark for a week' : null,
  a.needsProj ? 'needs projections' : null,
  a.agg === 'drive' ? 'needs play-by-play' : null,
  a.agg === 'ratio' ? 'rate stat' : null,
  a.dir === 'asc' ? 'lowest wins' : null,
].filter(Boolean).join(' · ');
const glossary = GLOSSARY.map((a) => ({ id: a.id, name: a.name, blurb: a.blurb, tier: a.tier, core: Boolean(a.core),
  tag: phaseTag(a), hue: phaseHue(a), art: hasBadge(a.id), note: caveat(a) }));
const tiers = Object.keys(TIERS).map(Number).filter((t) => t > 0).map((t) => ({ key: t, name: TIERS[t].name, note: TIERS[t].note }));

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];

const CSS = `
:root{
  --ground:#070B16; --panel:#101827; --panel-2:#162034; --raise:#1B2740;
  --line:#22304C; --line-2:#2E4066;
  --ink:#EDF2FF; --muted:#94A5C9; --faint:#61729A;
  --gold:#FFC93C; --yes:#C9FF3D; --no:#FF6B6B; --cyan:#3FD8F0;
  --p-pass:#FF80AD; --p-rush:#49E8CC; --p-rec:#49D0EE; --p-kick:#B7C1EE; --p-def:#E8751A;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.5;
  -webkit-font-smoothing:antialiased;padding-bottom:110px}
#app{max-width:1000px;margin:0 auto;padding-inline:20px;padding-block:0 40px}
h1,h2,h3{margin:0;text-wrap:balance}
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
.eyebrow{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:18px;
  letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
h1{font-family:"Big Shoulders Display",sans-serif;font-weight:800;
  font-size:clamp(36px,8vw,62px);line-height:.92;letter-spacing:.01em;text-transform:uppercase;margin-block:4px 10px}
.lede{color:var(--muted);max-width:64ch;margin:0}
.lede b{color:var(--ink);font-weight:600}
.gate{margin-top:18px;padding:16px 18px;border-radius:4px;background:var(--panel);border:1px solid var(--line-2);
  border-left:4px solid var(--gold);display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.gate p{margin:0;color:var(--muted);flex:1 1 320px}
.gate input{font:inherit;padding:9px 12px;border-radius:3px;background:var(--panel-2);border:1px solid var(--line-2);color:var(--ink);min-width:220px}
.gate.ok{border-left-color:var(--yes)}
.gate.locked{border-left-color:var(--no)}
.gate code{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:14px;color:var(--gold)}
button{font:inherit;cursor:pointer}
.btn{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:18px;letter-spacing:.08em;text-transform:uppercase;
  padding:9px 16px;border-radius:3px;border:2px solid var(--gold);background:var(--gold);color:#241A00}
.btn:hover{filter:brightness(1.1)}
.btn[disabled]{opacity:.45;cursor:default;filter:none}
.btn.ghost{background:none;color:var(--gold)}
.btn.ghost[disabled]{color:var(--faint);border-color:var(--line-2)}
h2.sec{font-family:"Big Shoulders Display",sans-serif;font-weight:800;font-size:29px;
  letter-spacing:.03em;text-transform:uppercase;color:var(--cyan);
  border-bottom:2px solid var(--cyan);padding-bottom:8px;margin:34px 0 4px;display:flex;align-items:baseline;gap:12px}
h2.sec .n{font-size:16px;color:var(--faint);border:1px solid var(--line-2);border-radius:3px;padding:1px 8px;letter-spacing:.08em}
.secnote{color:var(--muted);font-size:15px;margin:0 0 14px}
.settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:14px}
.field label{display:block;font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:15px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.field input{width:100%;font:inherit;padding:9px 12px;border-radius:3px;background:var(--panel);border:1px solid var(--line-2);color:var(--ink)}
.field input:focus-visible,.gate input:focus-visible,.nta:focus-visible{outline:2px solid var(--cyan);outline-offset:1px}
.field small{display:block;color:var(--faint);font-size:13px;margin-top:4px}
.row{display:grid;grid-template-columns:auto 76px 1fr auto;gap:12px 14px;align-items:center;background:var(--panel);
  border:1px solid var(--line);border-radius:3px;padding:10px 13px;margin-bottom:7px}
.row.haspos{border-left:3px solid var(--pc)}
.row.on{border-color:color-mix(in srgb,var(--yes) 45%,var(--line));background:color-mix(in srgb,var(--yes) 5%,var(--panel))}
.row.house{border-color:color-mix(in srgb,var(--gold) 55%,var(--line));background:color-mix(in srgb,var(--gold) 7%,var(--panel))}
.row .badge{--badge-size:76px;opacity:.45;filter:grayscale(.6) drop-shadow(0 2px 6px rgba(0,0,0,.45))}
.row.on .badge{opacity:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))}
.row .noart{width:76px;height:76px}
.play{width:26px;height:26px;accent-color:var(--yes);cursor:pointer}
.txt{min-width:0}
.nmline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nm{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:20px;letter-spacing:.03em;text-transform:uppercase;line-height:1.1}
.nm.custom{color:var(--gold)}
.pos{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:12px;font-weight:600;letter-spacing:.1em;padding:2px 7px;border-radius:3px;color:var(--pc);
  background:color-mix(in srgb,var(--pc) 15%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pc) 45%,transparent)}
.vote{font-size:12px;letter-spacing:.08em;text-transform:uppercase;border-radius:3px;padding:1px 7px;border:1px solid var(--line-2);color:var(--faint)}
.vote.yes{color:var(--yes);border-color:color-mix(in srgb,var(--yes) 50%,transparent)}
.vote.no{color:var(--no);border-color:color-mix(in srgb,var(--no) 50%,transparent)}
.core{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan)}
.bl{color:var(--muted);font-size:14.5px;margin-top:1px}
.bl.custom{color:var(--ink)}
.note{color:var(--faint);font-size:13px;margin-top:2px}
.acts{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.acts button{font-size:13.5px;font-weight:600;letter-spacing:.04em;color:var(--faint);background:none;border:1px dashed var(--line-2);border-radius:3px;padding:4px 9px}
.acts button:hover{color:var(--ink);border-color:var(--ink);border-style:solid}
.acts button.star.on{color:#241A00;background:var(--gold);border-color:var(--gold);border-style:solid}
.acts button[disabled]{opacity:.4;cursor:default}
.edit{grid-column:1/-1;display:grid;gap:8px;padding:10px 12px;background:var(--panel-2);border-radius:3px;border-left:2px solid var(--cyan)}
.edit label{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.edit input,.nta{width:100%;font:inherit;padding:8px 11px;border-radius:3px;background:var(--panel);border:1px solid var(--line-2);color:var(--ink)}
.nta{min-height:56px;resize:vertical}
.edit .eb{display:flex;gap:8px;justify-content:flex-end}
.bar{position:fixed;left:0;right:0;bottom:0;z-index:5;background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(8px);
  border-top:2px solid var(--line-2)}
.bar .in{max-width:1000px;margin:0 auto;padding:12px 20px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}
.bar .tally{font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
.bar .tally b{color:var(--gold)}
.bar .status{flex:1 1 200px;color:var(--faint);font-size:14.5px;min-height:20px}
.bar .status.saving{color:var(--cyan)} .bar .status.saved{color:var(--yes)} .bar .status.err{color:var(--no)}
.bar .dirty{color:var(--gold)}
footer{margin-top:40px;padding-top:18px;border-top:2px solid var(--line-2);color:var(--faint);font-size:14.5px}
footer p{margin:0 0 7px;max-width:74ch}
@media (max-width:640px){
  #app{padding-inline:16px}.mast{margin-inline:-16px;padding-inline:16px}
  .row{grid-template-columns:auto 1fr;grid-template-areas:"play txt" "art acts" "edit edit"}
  .row .play{grid-area:play}.row .txt{grid-area:txt}.row .badge,.row .noart{grid-area:art}.row .acts{grid-area:acts;flex-direction:row;align-items:center}.row .edit{grid-area:edit}
}
${badgeCSS()}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`.trim();

const JS = String.raw`
(function(){
  var G = JSON.parse(document.getElementById('glossary').textContent);
  var byId = {}; G.glossary.forEach(function(a){ byId[a.id] = a; });

  var cfg = null, version = null, mode = 'locked', canRebuild = false, stored = false, updatedAt = null;
  var votes = {};                       // shortlist verdicts, by id
  var pass = null;                      // the manager's password, this tab only
  try { pass = sessionStorage.getItem('admin-pass'); } catch(e){}
  var unlocked = false, dirty = false, editing = {}, saving = false;

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function isOn(id){ return cfg.prizes === 'all' || cfg.house.indexOf(id) >= 0 || cfg.prizes.indexOf(id) >= 0; }
  function isHouse(id){ return cfg.house.indexOf(id) >= 0; }
  function expandAll(){ if (cfg.prizes === 'all') { cfg.prizes = G.glossary.map(function(a){ return a.id; }).filter(function(id){ return !isHouse(id); }); } }
  function counts(){ var n = 0; G.glossary.forEach(function(a){ if (isOn(a.id)) n++; }); return { on: n, house: cfg.house.length }; }
  function nameOf(a){ return (cfg.custom[a.id] && cfg.custom[a.id].name) || a.name; }
  function blurbOf(a){ return (cfg.custom[a.id] && cfg.custom[a.id].blurb) || a.blurb; }
  function headers(){ var h = { 'Content-Type': 'application/json' }; if (pass) h['Authorization'] = 'Bearer ' + pass; return h; }

  function gateHTML(){
    if (mode === 'open') return '<div class="gate ok"><p>This is your own machine, so no password is needed. What you save here is what <code>npm run week</code> builds.</p></div>';
    if (mode === 'locked') return '<div class="gate locked"><p>This site has no manager password yet, so nothing here can be saved. In the Vercel project set <code>ADMIN_PASS</code> under Environment Variables and redeploy. The rest of this page still shows what the league plays for.</p></div>';
    if (unlocked) return '<div class="gate ok"><p>Signed in as the manager for this tab.</p><button class="btn ghost" data-act="lock">Sign out</button></div>';
    return '<div class="gate"><p>Manager password to make changes. Everyone else can look.</p>'
      + '<input type="password" id="pass" placeholder="password" autocomplete="current-password"><button class="btn" data-act="unlock">Sign in</button></div>';
  }

  function settingsHTML(){
    var ro = !unlocked ? ' disabled' : '';
    return '<h2 class="sec">The league</h2><div class="settings">'
      + '<div class="field"><label for="f-name">Name on the pages</label><input id="f-name" data-f="name" value="'+esc(cfg.name||'')+'"'+ro+'></div>'
      + '<div class="field"><label for="f-tz">Timezone</label><input id="f-tz" data-f="timezone" list="zones" value="'+esc(cfg.timezone||'')+'"'+ro+'><datalist id="zones">'
      +   G.zones.map(function(z){ return '<option value="'+z+'">'; }).join('') + '</datalist></div>'
      + '<div class="field"><label for="f-hl">Heading over the house prizes</label><input id="f-hl" data-f="houseLabel" value="'+esc(cfg.houseLabel||'')+'"'+ro+'></div>'
      + '<div class="field"><label for="f-lg">Sleeper league id</label><input id="f-lg" data-f="league" value="'+esc(cfg.league||'')+'"'+ro+' inputmode="numeric">'
      +   '<small>Changes every season. Next August, paste the new season\'s id here.</small></div>'
      + '</div>';
  }

  function rowHTML(a){
    var on = isOn(a.id), house = isHouse(a.id), c = cfg.custom[a.id] || {};
    var pc = a.hue ? ' style="--pc:var(--p-'+a.hue+')"' : '';
    var cls = 'row' + (a.hue ? ' haspos' : '') + (on ? ' on' : '') + (house ? ' house' : '');
    var v = votes[a.id];
    var h = '<div class="'+cls+'"'+pc+' data-id="'+a.id+'">'
      + '<input type="checkbox" class="play" aria-label="Play for '+esc(nameOf(a))+'" '+(on?'checked':'')+(unlocked?'':' disabled')+'>'
      + (a.art ? '<img class="badge" src="/badges/'+a.id+'.webp" alt="" width="320" height="320" loading="lazy" decoding="async">' : '<span class="noart"></span>')
      + '<div class="txt"><div class="nmline"><span class="nm'+(c.name?' custom':'')+'">'+esc(nameOf(a))+'</span>'
      +   (a.tag ? '<span class="pos">'+esc(a.tag)+'</span>' : '')
      +   (house ? '<span class="pos" style="--pc:var(--gold)">HOUSE</span>' : '')
      +   (a.core && !on ? '<span class="core">core</span>' : '')
      +   (v ? '<span class="vote '+v+'">league voted '+v+'</span>' : '')
      + '</div><div class="bl'+(c.blurb?' custom':'')+'">'+esc(blurbOf(a))+'</div>'
      +   (a.note ? '<div class="note">'+esc(a.note)+'</div>' : '')
      + '</div>'
      + '<div class="acts">'
      +   '<button class="star'+(house?' on':'')+'" data-act="house" '+(unlocked&&on?'':'disabled')+' title="Pin at the top under its own heading">'+(house?'★ House':'☆ House')+'</button>'
      +   '<button data-act="rename" '+(unlocked?'':'disabled')+'>'+(c.name||c.blurb?'Edit name':'Rename')+'</button>'
      + '</div>';
    if (editing[a.id]) {
      h += '<div class="edit">'
        + '<label for="n-'+a.id+'">Name</label><input id="n-'+a.id+'" data-e="name" value="'+esc(c.name||'')+'" placeholder="'+esc(a.name)+'">'
        + '<label for="b-'+a.id+'">Blurb</label><textarea class="nta" id="b-'+a.id+'" data-e="blurb" placeholder="'+esc(a.blurb)+'">'+esc(c.blurb||'')+'</textarea>'
        + '<div class="eb"><button data-act="reset">Back to the default</button><button data-act="done">Done</button></div></div>';
    }
    return h + '</div>';
  }

  function render(){
    var h = '<header class="mast"><nav class="sitenav"><a href="/">This week</a><a href="/prizes">The prize list</a><a href="/awards">Prize board</a><a href="/shortlist">Shortlist</a></nav>'
      + '<div class="eyebrow">'+esc(cfg ? cfg.name : G.name)+' &middot; Manager</div><h1>League Settings</h1>'
      + '<p class="lede">Tick what the league plays for, star the <b>house prizes</b> that sit at the top under their own heading, and rename anything to what your league calls it. '
      + 'Changes take effect at the <b>next build</b>' + (canRebuild ? ', or straight away with <b>Rebuild now</b>.' : ': Tuesday morning, or <code>npm run week</code> on a laptop.') + '</p>'
      + '</header>' + gateHTML();
    if (cfg) {
      h += settingsHTML();
      G.tiers.forEach(function(t){
        var rows = G.glossary.filter(function(a){ return a.tier === t.key; });
        var on = rows.filter(function(a){ return isOn(a.id); }).length;
        h += '<h2 class="sec">'+esc(t.name)+' <span class="n">'+on+' of '+rows.length+'</span></h2>'
          + (t.note ? '<p class="secnote">'+esc(t.note)+'</p>' : '')
          + rows.map(rowHTML).join('');
      });
      h += '<footer><p>Ids like <code>rec_yd</code> are permanent keys into the ledger and the badge art; names are yours to change. '
        + 'The shortlist on <a href="/shortlist">/shortlist</a> is where the rest of the league votes; their verdicts show here beside each prize.</p>'
        + (updatedAt ? '<p>Last saved '+new Date(updatedAt).toLocaleString()+'.</p>' : (stored ? '' : '<p>Nothing has been saved from this page yet; these are league.json\'s values.</p>'))
        + '</footer>';
    }
    document.getElementById('app').innerHTML = h;
    bar();
  }

  function bar(){
    var el = document.getElementById('bar'); if (!cfg) { el.hidden = true; return; }
    el.hidden = false;
    var c = counts();
    el.querySelector('.tally').innerHTML = '<b>'+c.on+'</b> in play &middot; <b>'+c.house+'</b> house' + (dirty ? ' &middot; <span class="dirty">unsaved</span>' : '');
    el.querySelector('[data-act="save"]').disabled = !unlocked || !dirty || saving;
    var rb = el.querySelector('[data-act="rebuild"]'); rb.hidden = !canRebuild; rb.disabled = !unlocked || saving || dirty;
  }
  function setStatus(msg, cls){ var s = document.querySelector('#bar .status'); if (s) { s.textContent = msg; s.className = 'status' + (cls ? ' ' + cls : ''); } }

  function touch(){ dirty = true; bar(); setStatus(''); }

  document.addEventListener('change', function(e){
    var t = e.target;
    if (t.classList.contains('play')) {
      var id = t.closest('.row').dataset.id; expandAll();
      if (t.checked) { if (cfg.prizes.indexOf(id) < 0 && !isHouse(id)) cfg.prizes.push(id); }
      else { cfg.prizes = cfg.prizes.filter(function(x){ return x !== id; }); cfg.house = cfg.house.filter(function(x){ return x !== id; }); }
      touch(); render(); return;
    }
    if (t.dataset.f) { cfg[t.dataset.f] = t.value.trim(); touch(); }
  });
  document.addEventListener('input', function(e){
    var t = e.target;
    if (t.dataset.e) {
      var id = t.closest('.row').dataset.id; var c = cfg.custom[id] || (cfg.custom[id] = {});
      if (t.value.trim()) c[t.dataset.e] = t.value.trim(); else delete c[t.dataset.e];
      if (!Object.keys(c).length) delete cfg.custom[id];
      touch();
    }
  });
  document.addEventListener('click', function(e){
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var act = b.dataset.act, row = b.closest('.row'), id = row ? row.dataset.id : null;
    if (act === 'unlock') { tryPass(document.getElementById('pass').value); return; }
    if (act === 'lock') { pass = null; unlocked = false; try { sessionStorage.removeItem('admin-pass'); } catch(x){} render(); return; }
    if (act === 'house') { expandAll(); if (isHouse(id)) { cfg.house = cfg.house.filter(function(x){ return x !== id; }); if (cfg.prizes.indexOf(id) < 0) cfg.prizes.push(id); } else { cfg.house.push(id); cfg.prizes = cfg.prizes.filter(function(x){ return x !== id; }); } touch(); render(); return; }
    if (act === 'rename') { editing[id] = true; render(); var n = document.getElementById('n-'+id); if (n) n.focus(); return; }
    if (act === 'done') { delete editing[id]; render(); return; }
    if (act === 'reset') { delete cfg.custom[id]; delete editing[id]; touch(); render(); return; }
    if (act === 'save') { save(); return; }
    if (act === 'rebuild') { rebuild(); return; }
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target.id === 'pass') tryPass(e.target.value); });
  window.addEventListener('beforeunload', function(e){ if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function tryPass(p){
    if (!p) return;
    fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + p }, body: JSON.stringify({ action: 'login' }) })
      .then(function(r){ if (r.ok) { pass = p; unlocked = true; try { sessionStorage.setItem('admin-pass', p); } catch(x){} render(); }
        else { var el = document.getElementById('pass'); if (el) { el.value = ''; el.placeholder = 'wrong password'; el.focus(); } } })
      .catch(function(){});
  }

  function save(){
    if (saving) return; saving = true; bar(); setStatus('Saving…', 'saving');
    // The site's own address rides along the first time, so the Tuesday build can find this
    // page's choices from GitHub Actions (see config.js). Not for a laptop.
    if (!cfg.site && /^https:/.test(location.origin) && !/localhost|127\.0\.0\.1/.test(location.host)) cfg.site = location.origin;
    fetch('/api/config', { method: 'POST', headers: headers(), body: JSON.stringify({ version: version, config: cfg }) })
      .then(function(r){ return r.json().then(function(b){ return { status: r.status, body: b }; }); })
      .then(function(r){
        saving = false;
        if (r.status === 200) { version = r.body.version; cfg = r.body.config; stored = true; updatedAt = r.body.updatedAt; dirty = false; render();
          setStatus(canRebuild ? 'Saved. The next build uses this — or press Rebuild now.' : 'Saved. Tuesday\'s build uses this.', 'saved'); return; }
        if (r.status === 409) { version = r.body.version; cfg = r.body.config; dirty = false; render(); setStatus('Someone else saved first. This page now shows their version; make your change again.', 'err'); return; }
        if (r.status === 401) { unlocked = false; pass = null; render(); setStatus(r.body.message || 'Not allowed.', 'err'); return; }
        bar(); setStatus('Could not save ('+(r.body.message || r.body.error || r.status)+').', 'err');
      }, function(){ saving = false; bar(); setStatus('Could not save — you look offline.', 'err'); });
  }

  function rebuild(){
    if (saving) return; saving = true; bar(); setStatus('Rebuilding…', 'saving');
    fetch('/api/config', { method: 'POST', headers: headers(), body: JSON.stringify({ action: 'rebuild' }) })
      .then(function(r){ return r.json().then(function(b){ return { status: r.status, body: b }; }); })
      .then(function(r){ saving = false; bar();
        if (r.status === 200) setStatus(r.body.via === 'local build' ? 'Rebuilt. Reload any page to see it.' : 'Deploy started. Give it a minute or two.', 'saved');
        else setStatus(r.body.message || 'Could not rebuild.', 'err'); },
        function(){ saving = false; bar(); setStatus('Could not reach the server.', 'err'); });
  }

  render();
  Promise.all([
    fetch('/api/config').then(function(r){ return r.json().then(function(b){ if (!r.ok) throw new Error(b.message || b.error || ('HTTP '+r.status)); return b; }); }),
    fetch('/api/state').then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }),
  ]).then(function(res){
    var b = res[0]; version = b.version; cfg = b.config; mode = b.mode; canRebuild = b.canRebuild; stored = b.stored; updatedAt = b.updatedAt;
    cfg.house = cfg.house || []; cfg.prizes = cfg.prizes || []; cfg.custom = cfg.custom || {};
    if (res[1] && res[1].state) votes = res[1].state.verdicts || {};
    if (mode === 'open') unlocked = true;
    else if (mode === 'password' && pass) { tryPass(pass); }
    render();
  }, function(e){
    document.getElementById('app').insertAdjacentHTML('beforeend', '<div class="gate locked"><p>Could not load the settings ('+esc(e.message)+'). '
      + 'If this is a fresh deploy, connect a Redis store to the Vercel project and redeploy.</p></div>');
  });
})();
`.trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(LEAGUE.name)} — League Settings</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Big+Shoulders+Display:wght@700;800&family=IBM+Plex+Mono:wght@600&display=swap">
<style>${CSS}</style>
</head>
<body>
<div id="app"></div>
<div class="bar" id="bar" hidden><div class="in">
  <span class="tally"></span>
  <span class="status"></span>
  <button class="btn ghost" data-act="rebuild" hidden>Rebuild now</button>
  <button class="btn" data-act="save" disabled>Save</button>
</div></div>
<script id="glossary" type="application/json">${JSON.stringify({ name: LEAGUE.name, glossary, tiers, zones: ZONES }).replace(/</g, '\\u003c')}</script>
<script>${JS}</script>
</body>
</html>`;

const out = process.argv[2] || 'public/admin.html';
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.error(`  admin: ${glossary.length} prizes on the dashboard -> ${out}`);
