// The wheel that turns, and the race that follows it. Client-side code, shipped as strings so
// render.js can inline it into a week page the way it inlines everything else.
//
// The wheel is a canvas, one drawing routine, driven by a real friction model: launch speed
// falls in a straight line, so the angle it travels is launch² ÷ (2 × friction). The wedge it
// has to stop on is known before it moves (a demo picks locally; a live week opens what the
// server sealed), so the launch speed is solved from the travel needed to get there. The spin
// looks like a spin because it IS one — the same decel a real wheel has — and it lands where it
// must because the launch was chosen for it. Nothing steers mid-flight.
//
// The race replays the standings for the prize it landed on, and it runs on the schedule's
// clock rather than the afternoon's: one tick per kickoff window, every window the same
// length, and every starter's line climbing across the window his game was played in to
// arrive exactly as the next window opens. The rows re-sort as the numbers climb and
// the leader only settles when Monday night is over. It runs on the contributions compute.js
// attaches to each row and the game list build.js puts in ctx — nothing here is invented.

export const WHEEL_CSS = `
/* ---- the wheel ---------------------------------------------------------------------- */
.wheelstage{position:relative; overflow:hidden; transition:height 1.1s cubic-bezier(.4,0,.2,1)}
.wheelstage canvas{display:block; margin:0 auto; max-width:100%; border-radius:4px; background:#0B0F1C;
  transition:transform 1.1s cubic-bezier(.4,0,.2,1); transform-origin:top center}
.wheelstage.small canvas{transform:scale(.5)}
/* The winner's crew: who put the number there, with their faces. Replaces a sentence. */
.wcrew{display:flex; flex-wrap:wrap; gap:10px 22px; margin-top:14px; font-size:16px; color:var(--muted)}
.wcrew .fc{width:60px; height:60px; box-shadow:inset 0 0 0 1px var(--line-2), 0 2px 8px rgba(0,0,0,.4)}
.wcrew .cred{gap:9px}
.wcrew .dv{margin-left:6px; color:var(--ink); font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums}
.wcrew:empty{display:none}
/* ---- the demo hero: wheel and controls side by side, the prize below ------------------- */
.wgrid{display:grid; grid-template-columns:minmax(0,1.85fr) minmax(280px,1fr); gap:22px; align-items:start}
.wstagebox{background:var(--panel); border:1px solid var(--line-2); border-left:6px solid var(--gold); border-radius:0 5px 5px 0; padding:12px}
.wside{display:grid; gap:14px}
.wcard{background:var(--panel); border:1px solid var(--line); border-radius:4px; padding:16px 18px}
.wcard .lab,.wcard .alabel{display:block; font-family:"IBM Plex Mono",monospace; font-size:11px; font-weight:600; letter-spacing:.2em; text-transform:uppercase; color:var(--faint); margin-bottom:10px}
.wcard .wadmin{margin-top:0}
.wcard #wready{padding-top:0; border-top:0}
.wcard .agate{display:grid; gap:10px}
.wcard .respin.big{display:block; width:100%; font-family:"Big Shoulders Display",sans-serif; font-weight:800; font-size:26px; letter-spacing:.06em; padding:14px 18px; text-align:center; border-style:solid; border-width:2px}
.wcard .arow{margin-top:0; display:grid; gap:12px}
.wcard .agatenote{font-size:14px}
.wseason ol{list-style:none; margin:0; padding:0; display:grid; gap:6px}
.wseason li{display:grid; grid-template-columns:28px 1fr auto; gap:10px; align-items:center; font-size:14px; color:var(--muted)}
.wseason .sbadge{--badge-size:28px; opacity:.8}
.wseason small{font-family:"IBM Plex Mono",monospace; font-size:11px; color:var(--faint)}
.wseason .empty{margin:0; color:var(--faint); font-size:14px}
.reveal{margin-top:22px; padding-top:22px; border-top:1px solid var(--line); transition:opacity .5s}
.reveal.pending{opacity:.18; pointer-events:none}
.rhead{display:flex; align-items:center; gap:18px; flex-wrap:wrap}
.rhead .rart{--badge-size:104px; filter:drop-shadow(0 3px 10px rgba(255,201,60,.28)) drop-shadow(0 2px 6px rgba(0,0,0,.5))}
.rhead .rtext{min-width:0; flex:1 1 320px}
.rhead .reye{display:block; font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:600; letter-spacing:.2em; text-transform:uppercase; color:var(--gold)}
.rhead .rname{font-family:"Big Shoulders Display",sans-serif; font-weight:800; text-transform:uppercase; font-size:clamp(34px,5.5vw,62px); line-height:.95; margin:4px 0 0; color:var(--gold); text-wrap:balance}
.wheel.hero .rhead .wblurb{margin:8px 0 0; font-size:17px; color:var(--muted)}
.raceboard{list-style:none; margin:0; padding:0; position:relative}
.raceboard>li{position:relative; display:grid; grid-template-columns:26px minmax(0,1fr) 96px; gap:10px; align-items:center; height:52px; margin-bottom:4px; font-size:15px; color:var(--muted); border-radius:3px}
.raceboard.racing>li{position:absolute; left:0; right:0; margin:0; transition:top .45s cubic-bezier(.4,0,.2,1)}
.raceboard .rk{font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--faint); text-align:right}
.raceboard .tm{display:grid; gap:5px; min-width:0}
.raceboard .nm{display:flex; align-items:center; gap:12px; min-width:0; white-space:nowrap}
.raceboard .nm b{font-weight:600; overflow:hidden; text-overflow:ellipsis; flex:0 1 auto}
.raceboard .crew{display:inline-flex; gap:10px; font-size:12.5px; color:var(--faint); overflow:hidden; min-width:0; flex:1 1 0}
.raceboard .crew .fc{width:17px; height:17px}
.raceboard .crew .dv{margin-left:4px; color:var(--muted); font-family:"IBM Plex Mono",monospace}
/* The bars: gold, silver and bronze for the three places that pay, a dulled gold for the field.
   The three podium bars are brushed metal under a soft light: a quiet vertical gradient, a hair
   of highlight along the top edge, and a still halo in the bar's own hue. Nothing moves but the
   fill. The track lets the halo spill past its edge; the fill never exceeds the track. */
.raceboard .bar{height:8px; background:var(--line); border-radius:4px; overflow:hidden}
.raceboard .bar i{display:block; height:100%; width:calc(var(--w,0) * 100%); background:rgba(185,147,51,.55); border-radius:4px; transition:width .3s linear}
.raceboard>li.r1 .bar,.raceboard>li.r2 .bar,.raceboard>li.r3 .bar{overflow:visible}
.raceboard>li.r1 .bar i,.raceboard>li.r2 .bar i,.raceboard>li.r3 .bar i{
  background:linear-gradient(180deg,var(--lit) 0%,var(--hue) 45%,var(--deep) 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.28), inset 0 -1px 0 rgba(0,0,0,.18), 0 0 6px var(--halo-1), 0 0 16px var(--halo-2)}
.raceboard>li.r1 .bar i{--lit:#FFE38A; --hue:#FFC93C; --deep:#D9A21C; --halo-1:rgba(255,201,60,.45); --halo-2:rgba(255,201,60,.2)}
.raceboard>li.r2 .bar i{--lit:#F2F5FA; --hue:#CDD6E4; --deep:#98A4B8; --halo-1:rgba(205,214,228,.4); --halo-2:rgba(205,214,228,.16)} .raceboard>li.r2 .rk{color:#C4CDDF}
.raceboard>li.r3 .bar i{--lit:#E8B583; --hue:#CF8E4A; --deep:#9C6430; --halo-1:rgba(207,142,74,.42); --halo-2:rgba(207,142,74,.18)} .raceboard>li.r3 .rk{color:#C98A4B}
.raceboard .v{font-family:"IBM Plex Mono",monospace; font-size:14px; text-align:right; font-variant-numeric:tabular-nums; color:var(--ink); white-space:nowrap; transform-origin:right center}
.raceboard .v .u{font-size:11px; color:var(--faint); margin-left:3px}
.raceboard .tb{font-family:"IBM Plex Mono",monospace; font-size:11.5px; color:var(--gold-dim); white-space:nowrap; flex:none}
.wtie{margin:12px 0 0; font-size:14px; color:var(--muted)} .wtie:empty{display:none}
.raceboard>li.top{color:var(--ink)} .raceboard>li.top b{color:var(--ink)}
.raceboard>li.top .v,.raceboard>li.top .rk{color:var(--gold)}
.raceboard.racing>li.top b{animation:leadflash .6s ease-out}
.raceboard.racing>li.top{background:linear-gradient(90deg,rgba(255,201,60,.1),rgba(255,201,60,0) 70%)}
/* The finish: the row that took it lights gold and a sweep runs across it, then both fade so
   the board ends up exactly what a settled page prints. */
.raceboard>li.won{overflow:hidden; animation:rowwin 2.4s ease-out both}
.raceboard>li.won::after{content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(100deg,rgba(255,225,138,0) 25%,rgba(255,225,138,.42) 50%,rgba(255,225,138,0) 75%);
  animation:sweep .8s ease-out .1s both}
@keyframes rowwin{0%{background-color:rgba(255,201,60,.34)} 30%{background-color:rgba(255,201,60,.16)} 100%{background-color:rgba(255,201,60,0)}}
@keyframes sweep{from{transform:translateX(-100%)} to{transform:translateX(100%)}}
/* The payout column while the race is on: whoever is in front right now, in white, under a
   line that says which window the clock is in. The stamp turns it gold once the last line
   has landed, which is the moment the prize is actually decided. */
.payout.racing::before,.payout.won::before{content:attr(data-live); display:block; font-family:"IBM Plex Mono",monospace;
  font-size:11px; font-weight:600; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); margin-bottom:8px}
.payout.racing::before{animation:livepulse 1.1s ease-in-out infinite}
.payout.won::before{color:var(--gold)}
.payout.racing .wval{color:var(--ink)}
.payout.racing .wval .u{color:var(--faint); filter:none}
.payout.won .wval{animation:stamp .6s cubic-bezier(.2,1.4,.4,1) both; transform-origin:left bottom}
@keyframes stamp{0%{transform:scale(1.3); opacity:.25} 60%{text-shadow:0 0 30px rgba(255,201,60,.75)} 100%{transform:scale(1); opacity:1; text-shadow:0 0 0 rgba(255,201,60,0)}}
@keyframes livepulse{50%{opacity:.45}}
.tl.done .fill{height:2px; box-shadow:0 0 8px rgba(255,201,60,.6)} .tl.done .head{display:none}
@media (max-width:860px){.wgrid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:560px){.raceboard .crew{display:none}}
/* ---- the race ----------------------------------------------------------------------- */
.tl{position:relative; display:flex; margin:0 0 12px; padding-bottom:9px; border-bottom:1px solid var(--line)}
.tl>span{font-family:"IBM Plex Mono",monospace; font-size:10.5px; letter-spacing:.04em; color:var(--faint); transition:color .3s; white-space:nowrap; overflow:hidden; min-width:0; padding-right:6px}
.tl>span.on{color:var(--gold)} .tl>span.past{color:var(--muted)}
.tl .fill{position:absolute; left:0; bottom:-1px; height:1px; width:0; background:var(--gold)}
.tl .head{position:absolute; left:0; bottom:-3px; width:2px; height:7px; background:var(--gold)}
@keyframes leadflash{from{color:var(--gold)} to{color:var(--ink)}}
.bskip{font:inherit; font-size:13px; color:var(--faint); background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; text-underline-offset:3px; margin-left:auto}
.bskip:hover{color:var(--ink)}
@media (max-width:560px){.tl>span{font-size:9.5px; letter-spacing:0} .tl .tltime{display:none}}
`;

export const WHEEL_JS = `
// ---- the wheel ------------------------------------------------------------------------
window.ffWheelUI=(function(){
  var TAU=Math.PI*2;
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Ticks and the bell are synthesised: no audio files, nothing to fetch on a Tuesday morning.
  var AC=null, noiseB=null, whoosh=null, soundOn=true;
  function audio(){
    if(!soundOn) return null;
    if(!AC){ var C=window.AudioContext||window.webkitAudioContext; if(!C) return null; try{ AC=new C(); }catch(e){ soundOn=false; return null; } }
    try{ if(AC.state==='suspended') AC.resume(); }catch(e){}
    return AC;
  }
  function noise(a){
    if(noiseB) return noiseB;
    noiseB=a.createBuffer(1,Math.floor(a.sampleRate*0.06),a.sampleRate);
    var d=noiseB.getChannelData(0); for(var i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    return noiseB;
  }
  function tick(strength){
    var a=audio(); if(!a) return; var t=a.currentTime;
    var src=a.createBufferSource(); src.buffer=noise(a);
    var bp=a.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1500+strength*900; bp.Q.value=5;
    var gn=a.createGain(); gn.gain.setValueAtTime(0.12+0.45*strength,t); gn.gain.exponentialRampToValueAtTime(0.001,t+0.045);
    src.connect(bp); bp.connect(gn); gn.connect(a.destination); src.start(t); src.stop(t+0.06);
    var o=a.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(260,t); o.frequency.exponentialRampToValueAtTime(90,t+0.03);
    var g2=a.createGain(); g2.gain.setValueAtTime(0.08+0.12*strength,t); g2.gain.exponentialRampToValueAtTime(0.001,t+0.035);
    o.connect(g2); g2.connect(a.destination); o.start(t); o.stop(t+0.04);
  }
  function bell(){
    var a=audio(); if(!a) return; var t=a.currentTime;
    [[880,0.5,1.6],[1318.5,0.32,1.3],[1760,0.12,0.9]].forEach(function(n){
      var o=a.createOscillator(); o.type='triangle'; o.frequency.value=n[0];
      var gn=a.createGain(); gn.gain.setValueAtTime(0.0001,t); gn.gain.exponentialRampToValueAtTime(n[1],t+0.012); gn.gain.exponentialRampToValueAtTime(0.0001,t+n[2]);
      o.connect(gn); gn.connect(a.destination); o.start(t); o.stop(t+n[2]+0.05);
    });
    var th=a.createOscillator(); th.type='sine'; th.frequency.setValueAtTime(110,t); th.frequency.exponentialRampToValueAtTime(40,t+0.25);
    var tg=a.createGain(); tg.gain.setValueAtTime(0.5,t); tg.gain.exponentialRampToValueAtTime(0.001,t+0.3);
    th.connect(tg); tg.connect(a.destination); th.start(t); th.stop(t+0.32);
  }
  function whooshStart(){
    var a=audio(); if(!a) return; whooshStop();
    var src=a.createBufferSource(); src.buffer=noise(a); src.loop=true;
    var lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=900; lp.Q.value=0.7;
    var gn=a.createGain(); gn.gain.value=0;
    src.connect(lp); lp.connect(gn); gn.connect(a.destination); src.start();
    whoosh={src:src,gain:gn,lp:lp};
  }
  function whooshSet(x){ if(!whoosh||!AC) return; whoosh.gain.gain.setTargetAtTime(0.09*x,AC.currentTime,0.05); whoosh.lp.frequency.setTargetAtTime(300+1400*x,AC.currentTime,0.05); }
  function whooshStop(){ if(!whoosh) return; try{ whoosh.gain.gain.setTargetAtTime(0,AC.currentTime,0.08); whoosh.src.stop(AC.currentTime+0.4); }catch(e){} whoosh=null; }
  function blip(){
    var a=audio(); if(!a) return; var t=a.currentTime;
    var o=a.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(520,t); o.frequency.exponentialRampToValueAtTime(880,t+0.08);
    var gn=a.createGain(); gn.gain.setValueAtTime(0.0001,t); gn.gain.exponentialRampToValueAtTime(0.1,t+0.01); gn.gain.exponentialRampToValueAtTime(0.0001,t+0.25);
    o.connect(gn); gn.connect(a.destination); o.start(t); o.stop(t+0.3);
  }

  function create(o){
    var canvas=o.canvas, wrap=canvas.parentNode, g=canvas.getContext('2d');
    var pool=o.pool, idxOf={}; pool.forEach(function(p,i){ idxOf[p.id]=i; });
    var hub=o.hub||[];
    var DPR=Math.min(2,window.devicePixelRatio||1), W=600, H=680, bandH=90, cx=300, cy=380, R=260, Rw=238;
    var theta=Math.random()*TAU, state='rest', spin=null, flap={a:0,v:0}, lastIdx=-1;
    var lightPos=0, lightFlash=0, parts=[], landedIdx=-1, tLand=0, imgs={}, cache=null, cacheKey='', small=false;
    var alpha=o.friction||1.6;

    pool.forEach(function(p){ var im=new Image(); im.onload=function(){ cache=null; }; im.src=o.badge(p.id); imgs[p.id]=im; });

    function size(){
      var w=Math.max(280,Math.min(wrap.clientWidth,o.max||600));
      W=w; bandH=Math.round(w*0.15); H=bandH+Math.round(w*0.97);
      canvas.width=Math.round(W*DPR); canvas.height=Math.round(H*DPR);
      canvas.style.width=W+'px'; canvas.style.height=H+'px';
      cx=W/2; cy=bandH+(H-bandH)/2+8; R=Math.min(W/2,(H-bandH)/2)-34; Rw=R-22;
      cache=null; fit();
    }
    function fit(){ wrap.style.height=Math.round(small?H*0.5:H)+'px'; }
    var wedgeW=function(){ return TAU/Math.max(1,pool.length); };
    var idxUnder=function(th){ var u=((-Math.PI/2-th)%TAU+TAU)%TAU; return Math.floor(u/wedgeW()); };

    function buildCache(){
      var N=pool.length, w=wedgeW();
      var key=N+':'+Rw+':'+landedIdx;
      if(cache&&cacheKey===key) return;
      cacheKey=key;
      cache=document.createElement('canvas');
      var S=Math.ceil(Rw*2+8); cache.width=cache.height=Math.round(S*DPR);
      var q=cache.getContext('2d'); q.scale(DPR,DPR); q.translate(S/2,S/2);
      var i;
      for(i=0;i<N;i++){
        var a0=i*w, a1=a0+w, win=i===landedIdx;
        q.beginPath(); q.moveTo(0,0); q.arc(0,0,Rw,a0,a1); q.closePath();
        q.fillStyle=win?'#FFC93C':(i%2?'#0E1730':'#162038');
        if(N%2&&i===N-1&&!win) q.fillStyle='#121B34';
        q.fill();
        q.strokeStyle=win?'#FFE08A':'#2E4066'; q.lineWidth=1; q.stroke();
      }
      var rr=Rw*0.75, chord=2*rr*Math.sin(w/2), bs=Math.min(Rw*0.22,chord*0.96);
      for(i=0;i<N;i++){
        var im=imgs[pool[i].id]; if(!im||!im.complete||!im.naturalWidth) continue;
        q.save(); q.rotate(i*w+w/2); q.translate(rr,0); q.rotate(Math.PI/2);
        if(i===landedIdx){ q.shadowColor='rgba(0,0,0,.5)'; q.shadowBlur=8; }
        q.drawImage(im,-bs/2,-bs/2,bs,bs);
        q.restore();
      }
      for(i=0;i<N;i++){
        var px=Math.cos(i*w)*(Rw-6), py=Math.sin(i*w)*(Rw-6);
        var gr=q.createRadialGradient(px-1.5,py-1.5,0.5,px,py,5);
        gr.addColorStop(0,'#F4F7FF'); gr.addColorStop(.5,'#9AA8C6'); gr.addColorStop(1,'#3C4A6B');
        q.beginPath(); q.arc(px,py,4.6,0,TAU); q.fillStyle=gr; q.fill();
      }
      q.beginPath(); q.arc(0,0,Rw,0,TAU); q.strokeStyle='#3A4C75'; q.lineWidth=2; q.stroke();
    }

    // Solve the launch for the wedge it has to stop on, then let friction do the rest.
    function launch(id, cb){
      var N=pool.length, w=wedgeW(), target=idxOf[id];
      if(target===undefined||!N) return 0;
      var f=0.3+Math.random()*0.4;                                    // inside the wedge, never on a peg
      var thEnd=-Math.PI/2-(target+f)*w;
      var turns=4+Math.floor(Math.random()*4);
      var travel=turns*TAU+(((thEnd-theta)%TAU)+TAU)%TAU;
      var w0=Math.sqrt(2*alpha*travel), T=w0/alpha;
      spin={t0:performance.now(),theta0:theta,w0:w0,T:T,thEnd:theta+travel,target:target,
            amp:still?0:Math.min(0.22*w,0.7*f*w),cb:cb,fired:false,shards:false};
      landedIdx=-1; cache=null; lastIdx=idxUnder(theta);
      if(still){ theta=spin.thEnd; land(); return 0; }
      state='spinning'; whooshStart();
      return Math.round(T*1000);
    }
    function land(){
      state='landed'; tLand=performance.now();
      landedIdx=spin.target; cache=null;
      whooshStop(); bell(); flap.v+=9; lightFlash=1.3;
      setTimeout(function(){ if(spin&&spin.cb){ var cb=spin.cb; spin.cb=null; cb(); } }, still?0:900);
    }

    var last=performance.now();
    function frame(now){
      var dt=Math.min(0.05,(now-last)/1000); last=now;
      var omega=0;
      if(state==='spinning'&&spin){
        var t=(now-spin.t0)/1000;
        if(t<spin.T){ theta=spin.theta0+spin.w0*t-0.5*alpha*t*t; omega=spin.w0-alpha*t; whooshSet(Math.min(1,omega/spin.w0)); }
        else { theta=spin.thEnd; land(); }
      }
      if(state==='landed'&&spin){
        var s=(now-tLand)/1000;
        theta=spin.thEnd-spin.amp*Math.exp(-5.5*s)*Math.sin(TAU*2.1*s);      // the rock-back on the last peg
        if(!spin.shards&&s>0.15){
          spin.shards=true;
          if(!still) for(var i=0;i<90;i++) parts.push({x:cx,y:cy-Rw+10,vx:(Math.random()-.5)*520,vy:-Math.random()*300-60,r:Math.random()*TAU,vr:(Math.random()-.5)*14,s:3+Math.random()*6,life:1.3+Math.random()*.9,c:Math.random()<.18?'#EDF2FF':(Math.random()<.5?'#FFC93C':'#FFE08A')});
        }
      }
      var idx=idxUnder(theta);
      if(idx!==lastIdx&&lastIdx>=0&&state==='spinning'){ var str=Math.min(1,omega/9); flap.v+=6+str*9; tick(str); }
      lastIdx=idx;
      flap.v+=(-260*flap.a-14*flap.v)*dt; flap.a+=flap.v*dt; flap.a=Math.max(-0.55,Math.min(0.75,flap.a));
      lightPos+=(state==='spinning'?omega/wedgeW():2.2)*dt;
      if(lightFlash>0) lightFlash-=dt;
      for(var k=parts.length-1;k>=0;k--){ var q=parts[k]; q.life-=dt; if(q.life<=0){ parts.splice(k,1); continue; } q.vy+=1100*dt; q.x+=q.vx*dt; q.y+=q.vy*dt; q.r+=q.vr*dt; q.vx*=0.995; }
      draw(omega);
      requestAnimationFrame(frame);
    }

    function draw(omega){
      buildCache();
      g.setTransform(DPR,0,0,DPR,0,0);
      g.fillStyle='#0B0F1C'; g.fillRect(0,0,W,H);

      // whatever is under the flapper right now, in the band above the wheel
      var N=pool.length, cur=N?pool[idxUnder(theta)]:null, lit=landedIdx>=0&&state!=='spinning';
      // The band names the wedge under the flapper — but only once the wheel has something to
      // say. At rest before any spin it is simply where the wheel happened to stop, and on a
      // sealed week a caption there reads as the answer. Silent until it turns or has landed.
      var speaking=state==='spinning'||landedIdx>=0;
      var name=cur&&speaking?cur.name.toUpperCase():'';
      var fs=Math.min(bandH*0.62,2.1*(W-40)/Math.max(8,name.length));
      g.textAlign='center'; g.textBaseline='middle';
      g.font='800 '+fs+'px "Big Shoulders Display", "Archivo Narrow", Impact, sans-serif';
      g.fillStyle=lit?'#FFC93C':(state==='spinning'?'#EDF2FF':'#94A5C9');
      g.fillText(name,cx,bandH*0.52);
      g.strokeStyle='#22304C'; g.lineWidth=1; g.beginPath(); g.moveTo(16,bandH+4); g.lineTo(W-16,bandH+4); g.stroke();

      g.save();
      g.beginPath(); g.rect(0,bandH+5,W,H-bandH-5); g.clip();

      // the frame and its lights
      g.beginPath(); g.arc(cx,cy,R+6,0,TAU); g.fillStyle='#0B1222'; g.fill();
      g.strokeStyle='#2E4066'; g.lineWidth=2; g.stroke();
      g.beginPath(); g.arc(cx,cy,R+2,0,TAU); g.strokeStyle='#182238'; g.lineWidth=6; g.stroke();
      var M=Math.max(24,N*2), lr=(Rw+R)/2+2, base=Math.floor(lightPos*2);
      for(var i=0;i<M;i++){
        var a=i*TAU/M, lx=cx+Math.cos(a)*lr, ly=cy+Math.sin(a)*lr, on;
        if(lightFlash>0) on=Math.floor(lightFlash*8)%2===0; else if(lit) on=true; else on=((i-base)%3+3)%3===0;
        if(on){ g.beginPath(); g.arc(lx,ly,7,0,TAU); g.fillStyle='rgba(255,201,60,.22)'; g.fill(); }
        g.beginPath(); g.arc(lx,ly,3.6,0,TAU); g.fillStyle=on?'#FFD86A':'#2A3552'; g.fill();
      }

      // the wheel, with a little blur while it is fast
      var S=cache.width/DPR;
      var drawWheel=function(th,al){ g.save(); g.globalAlpha=al; g.translate(cx,cy); g.rotate(th); g.drawImage(cache,-S/2,-S/2,S,S); g.restore(); };
      if(omega>4){ var kk=Math.min(1,(omega-4)/9), d=omega*0.011; drawWheel(theta-d*1.6,0.18*kk); drawWheel(theta-d*0.8,0.28*kk); }
      drawWheel(theta,1);

      // a fixed light on a turning wheel
      g.save(); g.beginPath(); g.arc(cx,cy,Rw,0,TAU); g.clip();
      var hl=g.createRadialGradient(cx-R*0.45,cy-R*0.55,0,cx-R*0.45,cy-R*0.55,R*1.5);
      hl.addColorStop(0,'rgba(255,255,255,.075)'); hl.addColorStop(.6,'rgba(255,255,255,0)'); hl.addColorStop(1,'rgba(0,0,0,.28)');
      g.fillStyle=hl; g.fillRect(cx-R,cy-R,2*R,2*R); g.restore();

      // the hub
      var Rh=Rw*0.19;
      g.beginPath(); g.arc(cx,cy,Rh+3,0,TAU); g.fillStyle='rgba(0,0,0,.35)'; g.fill();
      g.beginPath(); g.arc(cx,cy,Rh,0,TAU); g.fillStyle='#101827'; g.fill(); g.strokeStyle='#FFC93C'; g.lineWidth=2.5; g.stroke();
      g.beginPath(); g.arc(cx,cy,Rh-7,0,TAU); g.strokeStyle='#2E4066'; g.lineWidth=1; g.stroke();
      g.textAlign='center'; g.textBaseline='middle';
      if(hub[0]){ g.fillStyle='#94A5C9'; g.font='600 '+Math.max(9,Rh*0.2)+'px "IBM Plex Mono", ui-monospace, monospace'; g.fillText(hub[0],cx,cy-Rh*0.38); }
      if(hub[1]){ g.fillStyle=lit?'#FFC93C':'#EDF2FF'; g.font='800 '+Rh*0.78+'px "Big Shoulders Display", Impact, sans-serif'; g.fillText(hub[1],cx,cy+Rh*0.18); }

      // the flapper
      g.save(); g.translate(cx,cy-R-14); g.rotate(flap.a);
      g.beginPath(); g.moveTo(-11,0); g.lineTo(11,0); g.lineTo(0,R-Rw+26); g.closePath();
      g.fillStyle='#FFC93C'; g.shadowColor='rgba(0,0,0,.55)'; g.shadowBlur=8; g.shadowOffsetY=3; g.fill(); g.shadowColor='transparent';
      g.strokeStyle='#8A6408'; g.lineWidth=1.5; g.stroke();
      g.beginPath(); g.arc(0,0,6,0,TAU); g.fillStyle='#1B2740'; g.fill(); g.strokeStyle='#FFC93C'; g.lineWidth=2; g.stroke();
      g.restore();

      parts.forEach(function(p){ g.save(); g.translate(p.x,p.y); g.rotate(p.r); g.globalAlpha=Math.min(1,p.life); g.fillStyle=p.c; g.fillRect(-p.s/2,-p.s/4,p.s,p.s/2); g.restore(); });
      g.restore();
    }

    size();
    window.addEventListener('resize',size);
    requestAnimationFrame(function(t){ last=t; frame(t); });

    return {
      canvas:canvas,
      // Rest with this wedge lit under the flapper, no motion. The page at rest shows the answer.
      restOn:function(id){
        var i=idxOf[id]; spin=null; parts=[]; state='rest';
        if(i===undefined){ landedIdx=-1; cache=null; return; }
        landedIdx=i; theta=-Math.PI/2-(i+0.5)*wedgeW(); lastIdx=i; cache=null;
      },
      // Spin and stop on this prize; cb fires once it has settled. Returns the flight time in ms.
      spin:launch,
      small:function(b){ small=Boolean(b); wrap.classList.toggle('small',small); fit(); },
      sound:function(b){ soundOn=Boolean(b); if(!soundOn) whooshStop(); },
      resize:size
    };
  }
  // The race borrows the peg click for each count that lands and the bell for the finish, so
  // the whole show is one set of sounds.
  return {create:create, blip:blip, tick:tick, bell:bell};
})();

// ---- the race -------------------------------------------------------------------------
// Replays a prize's standings as the week happened. Rows are the same markup as the settled
// board (ffBoard), positioned by rank so they slide past each other; the bar, the number and
// the crew on each row follow the lines that have landed so far.
//
// A count is a count. Nobody has 2.37 touchdowns on the way to three, so on any prize whose
// lines are all whole numbers the running total is shown whole — a touchdown, a sack, a catch
// arrives as one, and yards tick up like an odometer. Only fantasy points, which really do
// carry a decimal, climb through one. On the small counts each arrival pops and clicks, so
// the race reads as a run of events rather than a number creeping upward.
//
// It ends somewhere. The payout column runs white while the race is on, with a line saying
// which window the clock is in, and when the last line lands the winner's row lights up, the
// big number stamps gold, the bell rings and a burst goes up over it.
window.ffRace=(function(){
  var TAU=Math.PI*2;
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var snd=function(){ return window.ffWheelUI||{}; };
  var fmt=function(v,unit){ return unit==='%'?v.toFixed(1):(Math.abs(v-Math.round(v))<1e-9?String(Math.round(v)):v.toFixed(2)); };
  var hash=function(n){ n=(n^61)^(n>>>16); n=n+(n<<3); n=n^(n>>>4); n=Math.imul(n,0x27d4eb2d); n=n^(n>>>15); return (n>>>0)/4294967296; };
  // A number that just went up, and a row that just took the lead.
  var pop=function(el,s){ if(still||!el||!el.animate) return; el.animate([{transform:'scale('+s+')',filter:'brightness(1.9)'},{transform:'scale(1)',filter:'brightness(1)'}],{duration:340,easing:'cubic-bezier(.2,1.2,.4,1)'}); };
  var flash=function(el,a){ if(still||!el||!el.animate) return; el.animate([{backgroundColor:'rgba(255,201,60,'+a+')'},{backgroundColor:'rgba(255,201,60,0)'}],{duration:800,easing:'ease-out'}); };
  // The finish. Shards out of the big number, on a canvas laid over it for as long as they
  // fly; the same shards the wheel throws when it lands, so the two moments rhyme.
  function burst(from){
    if(still||!from) return;
    // The number is a block as wide as its column; the shards come out of the digits, so
    // measure the text, not the box.
    var r=from.getBoundingClientRect(); if(!r.width) return;
    try{ var rg=document.createRange(); rg.selectNodeContents(from); var tr=rg.getBoundingClientRect(); if(tr.width) r=tr; }catch(e){}
    var pad=200, W=Math.ceil(r.width+pad*2), H=Math.ceil(r.height+pad*2), DPR=Math.min(2,window.devicePixelRatio||1);
    var c=document.createElement('canvas'); c.width=W*DPR; c.height=H*DPR;
    c.style.cssText='position:fixed;left:'+(r.left-pad)+'px;top:'+(r.top-pad)+'px;width:'+W+'px;height:'+H+'px;pointer-events:none;z-index:70';
    document.body.appendChild(c);
    var g=c.getContext('2d'); g.scale(DPR,DPR);
    var ox=pad+r.width*0.5, oy=pad+r.height*0.5, parts=[];
    for(var i=0;i<110;i++){
      var a=-Math.PI/2+(Math.random()-.5)*2.4, sp=240+Math.random()*460;
      parts.push({x:ox,y:oy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-140,r:Math.random()*TAU,vr:(Math.random()-.5)*16,s:4+Math.random()*7,life:1.1+Math.random()*.8,c:Math.random()<.2?'#EDF2FF':(Math.random()<.5?'#FFC93C':'#FFE08A')});
    }
    var last=performance.now();
    function f(now){
      var dt=Math.min(.05,(now-last)/1000); last=now; g.clearRect(0,0,W,H); var alive=0;
      parts.forEach(function(p){
        if(p.life<=0) return; alive++; p.life-=dt; p.vy+=1000*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.r+=p.vr*dt; p.vx*=.99;
        g.save(); g.translate(p.x,p.y); g.rotate(p.r); g.globalAlpha=Math.max(0,Math.min(1,p.life)); g.fillStyle=p.c; g.fillRect(-p.s/2,-p.s/4,p.s,p.s/2); g.restore();
      });
      if(alive) requestAnimationFrame(f); else c.remove();
    }
    requestAnimationFrame(f);
  }

  // A player, as the page draws one everywhere else: face, name, number.
  function cred(pl,valueText){
    var s=document.createElement('span'); s.className='cred';
    var f=document.createElement('i'); f.className='fc'+(pl.f?' f-'+String(pl.p).replace(/[^A-Za-z0-9]/g,''):''); s.appendChild(f);
    s.appendChild(document.createTextNode(pl.n));
    if(valueText!==undefined&&valueText!==''){ var d=document.createElement('span'); d.className='dv'; d.textContent=valueText; s.appendChild(d); }
    return s;
  }
  function crewInto(el,list,players,unit,max){
    el.innerHTML='';
    list.slice(0,max).forEach(function(c){ el.appendChild(cred(players[c.pi], c.label!==undefined?String(c.label):fmt(c.v,unit))); });
  }
  // The crew a prize's row shipped with, for pages that never race (or after one is over):
  // the race lines when the prize has them, otherwise the card's own detail, which is what a
  // matchup prize or a ratio names beside the team.
  function crewFromRow(el,row,players,unit,max){
    var list;
    if(row&&row.c&&row.c.length) list=row.c.map(function(c){ return {pi:c[0],v:c[1],label:c[3]}; }).sort(function(a,b){ return b.v-a.v; });
    else if(row&&row.d&&row.d.length) list=row.d.map(function(x){ return {pi:x[0],v:0,label:x[1]}; });
    else { if(el) el.innerHTML=''; return; }
    crewInto(el,list,players,unit,max);
  }

  function run(o){
    var p=o.p, tables=o.tables, players=tables.players, games=tables.games, unit=p.unit, mode=p.mode;
    // instant: build the same board and settle it at once — a page that is a record of a
    // week rather than the event of one — with no race, no sound and nothing on the payout.
    var instant=Boolean(o.instant);
    var racing=!instant&&Boolean(mode)&&p.board.some(function(r){ return r.c&&r.c.length; });

    // Windows: consecutive games with one label are one window. Every window anyone scored in
    // is the SAME length, because eight one o'clock kickoffs are one tick of this clock and so
    // is Monday night — the race is paced by the schedule, not by how much of the day a slate
    // took up. A window no starter on any roster played in shrinks to a beat
    // instead of stalling the board. Two and a half seconds a window: a week of six or seven
    // is over in about fifteen, which is long enough to watch the lead change hands and short
    // enough that Monday night is still worth waiting for.
    var slots=[], slotOf=[];
    games.forEach(function(gm,i){
      var s=slots[slots.length-1];
      if(!s||s.l!==gm.l){ s={l:gm.l,n:0,k:0}; slots.push(s); }
      s.n++; slotOf[i]=slots.length-1;
    });
    if(!slots.length) slots.push({l:'',n:1,k:0});
    var slotAt=function(gi){ return slots[gi>=0&&slotOf[gi]!==undefined?slotOf[gi]:0]; };
    p.board.forEach(function(r){ (r.c||[]).forEach(function(c){ slotAt(c[2]).k++; }); });
    slots.forEach(function(s){ s.w=s.k?1:0.2; });
    var wtot=slots.reduce(function(a,s){ return a+s.w; },0);
    var tick=Math.min(o.slot||2.5,(o.dur||18)/wtot), D=tick*wtot, acc=0;
    slots.forEach(function(s){ s.t0=acc; s.d=tick*s.w; acc+=s.d; });

    // Every line is a climb, not a pop. It starts inside the window its game was played in
    // and lands exactly as the next window opens, so something on the board is moving at every
    // moment of a window and nothing is still in flight when the clock moves on. The stagger
    // is texture only — the finish line is shared.
    var rows=p.board.map(function(r,i){
      var evs=(r.c||[]).map(function(c){
        var gi=c[2], s=slotAt(gi), off=s.d*0.12*hash(c[0]*7919+gi+1);
        if(s.o===undefined||off<s.o) s.o=off;
        return {pi:c[0],v:c[1],label:c[3],s:s,off:off};
      });
      return {row:r,i:i,evs:evs,val:0,landed:[]};
    });
    // Nothing sits waiting for its window to get going: the earliest line in each window is
    // pulled back to the instant the window opens, and the others trail it.
    rows.forEach(function(r){
      r.evs.forEach(function(e){ e.a=e.s.t0+(e.off-e.s.o); e.w=(e.s.t0+e.s.d)-e.a; });
      r.evs.sort(function(a,b){ return a.a-b.a; });
    });
    // How the running number reads (see the note at the top): whole when every line is, one
    // decimal for points. The small counts — touchdowns, sacks, picks, not three hundred
    // catches — are few enough that each one landing can be an event of its own.
    var whole=rows.every(function(r){ return r.evs.every(function(e){ return Number.isInteger(e.v); }); });
    var total=rows.reduce(function(a,r){ return a+r.evs.reduce(function(b,e){ return b+Math.abs(e.v); },0); },0);
    var pops=whole&&!unit&&total<=80;
    var show=function(v){ return whole?String(Math.round(v)):v.toFixed(1); };
    var lastClick=0, click=function(){ var a=snd(), now=performance.now(); if(!a.tick||now-lastClick<90) return; lastClick=now; a.tick(0.3); };
    // The payout column beside the board, if the page handed one over: it reads whoever is in
    // front while the race runs and takes the stamp at the end.
    var pay=o.payout||null, payVal=pay?pay.querySelector('.wval'):null;
    var live=function(text){ if(pay) pay.setAttribute('data-live',text); };
    if(pay){ pay.classList.remove('won','racing'); pay.removeAttribute('data-live'); }
    if(racing&&pay){ pay.classList.add('racing'); live('In front'); }

    // The board, rebuilt racing: same rows, absolutely placed.
    var box=o.box, head=box.querySelector('.bhead');
    var lab=head?head.querySelector('span'):null;
    if(lab) lab.textContent='All '+rows.length+(p.pairs?' matchups':' teams');
    if(head){ var stale=head.querySelector('.bskip'); if(stale) stale.remove(); }   // left by a race that was stopped, not finished
    box.innerHTML=''; if(head) box.appendChild(head);
    // The three places that pay carry their colour on the row — gold, silver, bronze — and it
    // moves with the row as the order changes.
    var rank=function(r,i){ if(r.rank===i) return; r.rank=i; r.el.classList.remove('r1','r2','r3'); if(i<3) r.el.classList.add('r'+(i+1)); };
    var skip=null, tl=null, fill=null, hd=null, labels=[];
    if(racing){
      if(head){ skip=document.createElement('button'); skip.type='button'; skip.className='bskip'; skip.textContent='Skip to the end'; head.appendChild(skip); }
      tl=document.createElement('div'); tl.className='tl';
      fill=document.createElement('i'); fill.className='fill'; tl.appendChild(fill);
      hd=document.createElement('i'); hd.className='head'; tl.appendChild(hd);
      labels=slots.map(function(s){
        var sp=document.createElement('span'), parts=s.l.split(' ');
        sp.appendChild(document.createTextNode(parts[0]));
        if(parts[1]){ var tm=document.createElement('span'); tm.className='tltime'; tm.textContent=' '+parts[1]; sp.appendChild(tm); }
        sp.style.flex=String(s.w)+' 1 0'; tl.appendChild(sp); return sp;
      });
      box.appendChild(tl);
    }
    var ol=document.createElement('ol'); ol.className='raceboard'+(racing?' racing':''); box.appendChild(ol);
    rows.forEach(function(r){
      var li=document.createElement('li');
      var rk=document.createElement('span'); rk.className='rk'; rk.textContent=String(r.i+1); li.appendChild(rk);
      var tm=document.createElement('span'); tm.className='tm';
      var nm=document.createElement('span'); nm.className='nm';
      var b=document.createElement('b'); b.textContent=r.row.t; nm.appendChild(b);
      var who=document.createElement('span'); who.className='crew'; nm.appendChild(who);
      tm.appendChild(nm);
      var bar=document.createElement('span'); bar.className='bar'; bar.appendChild(document.createElement('i')); tm.appendChild(bar);
      li.appendChild(tm);
      var val=document.createElement('span'); val.className='v'; li.appendChild(val);
      r.el=li; r.plEl=rk; r.whoEl=who; r.valEl=val; rank(r,r.i);
      ol.appendChild(li);
    });
    var RH=56;
    if(racing){ ol.style.height=(rows.length*RH)+'px'; rows.forEach(function(r){ r.el.style.top=(r.i*RH)+'px'; }); }

    var t0=performance.now(), leader=null, leadShown, slotNow=-1, done=false, raf=0;
    function setVal(el,text){
      el.textContent=text;
      if(unit){ var u=document.createElement('span'); u.className='u'; u.textContent=unit; el.appendChild(u); }
    }
    function paint(t){
      var max=-Infinity, min=Infinity;
      rows.forEach(function(r){
        var v=0, landed=[];
        r.evs.forEach(function(e){
          var k=(t-e.a)/e.w; if(k<=0) return;
          // Mostly linear, lightly accented in the middle. A curve with a flat end (ease-out,
          // or plain smoothstep) puts a visible stall at every window boundary — one set of
          // lines finishing at nearly zero speed while the next starts at nearly zero — which
          // is the exact thing the window pacing is here to remove. This one never stops.
          k=k>=1?1:0.75*k+0.25*(k*k*(3-2*k));
          if(mode==='max'){ var ev=e.v*k; if(ev>v) v=ev; } else v+=e.v*k;
          if(k>=0.25) landed.push(e);
        });
        r.val=v; r.landed=landed.sort(function(a,b){ return b.v-a.v; });
        if(v>max) max=v; if(v<min) min=v;
      });
      var order=rows.slice().sort(function(a,b){ return b.val-a.val||a.i-b.i; });
      var span=max-min;
      order.forEach(function(r,i){
        r.el.style.top=(i*RH)+'px'; r.plEl.textContent=String(i+1); rank(r,i);
        r.el.style.setProperty('--w',(span===0?(r.val>0?1:0):0.18+0.82*((r.val-min)/span)).toFixed(3));
        // The number only redraws when it reads differently, which on a count is exactly the
        // moment one more has landed — and that is the moment that pops.
        var s=show(r.val);
        if(s!==r.shown){ var had=r.shown!==undefined; r.shown=s; setVal(r.valEl,s); if(pops&&had&&r.val>0){ pop(r.valEl,1.45); click(); } }
        var n=mode==='max'?1:(i===0?3:2), want=r.landed.slice(0,n).map(function(e){ return e.pi; }).join(',');
        if(r.whoEl.dataset.k!==want){ r.whoEl.dataset.k=want; crewInto(r.whoEl,r.landed,players,unit,n); }
      });
      var lead=order[0].val>0?order[0]:null;
      if(lead!==leader){
        if(leader) leader.el.classList.remove('top');
        if(lead){ lead.el.classList.add('top'); if(leader){ flash(lead.el,.3); if(snd().blip) snd().blip(); } }
        leader=lead;
      }
      var si=0; for(var j=0;j<slots.length;j++) if(t>=slots[j].t0) si=j;
      if(si!==slotNow){ slotNow=si; live('In front · '+slots[si].l); }
      if(lead){
        var lv=show(lead.val);
        if(o.onLeader) o.onLeader({t:lead.row.t, v:lv, crew:lead.landed.slice(0,mode==='max'?1:4), players:players, unit:unit});
        if(pops&&leadShown!==undefined&&lv!==leadShown) pop(payVal,1.08);
        leadShown=lv;
      }
      var k=Math.min(1,t/D);
      hd.style.left=(k*100)+'%'; fill.style.width=(k*100)+'%';
      labels.forEach(function(sp,j){ sp.className=j===si?'on':(j<si?'past':''); });
    }
    // Settle on exactly what the server printed: the canonical order and the canonical numbers.
    function settle(){
      ol.classList.remove('racing'); ol.style.height='';
      var B=p.board;
      rows.forEach(function(r){
        r.el.style.top=''; r.plEl.textContent=String(r.i+1); rank(r,r.i);
        r.el.classList.toggle('top',r.i===0);
        setVal(r.valEl,r.row.v);
        crewFromRow(r.whoEl,r.row,players,unit,mode==='max'?1:(r.i===0?3:2));
        // rows level on the prize show what separated them
        var i=r.i, tied=(i>0&&B[i-1].v===r.row.v)||(i<B.length-1&&B[i+1].v===r.row.v);
        var old=r.whoEl.parentNode.querySelector('.tb'); if(old) old.remove();
        if(tied&&r.row.tb!==null&&r.row.tb!==undefined&&p.tbl){ var tb=document.createElement('span'); tb.className='tb'; tb.textContent=p.tbl+' '+r.row.tb; r.whoEl.parentNode.appendChild(tb); }
      });
      var vals=rows.map(function(r){ return parseFloat(r.row.v); }), worst=vals[vals.length-1], span=Math.abs(vals[0]-worst);
      rows.forEach(function(r,i){ r.el.style.setProperty('--w',(span===0?1:0.18+0.82*(Math.abs(vals[i]-worst)/span)).toFixed(3)); });
      labels.forEach(function(sp){ sp.className='past'; });
      if(tl){ tl.classList.add('done'); hd.style.left='100%'; fill.style.width='100%'; }
      if(skip) skip.remove();
    }
    // The finish. The board settles, then the winner's row lights, the payout stamps gold,
    // the bell rings and the shards go up — the beat the wheel gets when it stops, because
    // this is the moment the prize is decided. A prize that never raced settles quietly.
    function finish(){
      if(done) return; done=true; cancelAnimationFrame(raf);
      settle();
      if(pay&&!instant){ pay.classList.remove('racing'); pay.classList.add('won'); live('Final'); }
      if(racing){
        rows[0].el.classList.add('won');
        if(!still&&snd().bell) snd().bell();
        burst(payVal||rows[0].valEl);
      }
      if(o.onDone) o.onDone({row:rows[0].row, players:players, unit:unit, max:mode==='max'?1:4});
    }
    function frame(now){
      if(done) return;
      var t=(now-t0)/1000;
      // A beat with the last line down and the board still, then the finish.
      if(t>D+0.45){ finish(); return; }
      paint(Math.min(t,D)); raf=requestAnimationFrame(frame);
    }
    if(skip) skip.addEventListener('click',finish);
    if(still||!racing){ finish(); }
    else { paint(0); raf=requestAnimationFrame(frame); }
    return {stop:function(){ done=true; cancelAnimationFrame(raf); if(pay){ pay.classList.remove('racing','won'); pay.removeAttribute('data-live'); } }, finish:finish};
  }
  return {run:run, crewInto:crewInto, crewFromRow:crewFromRow, cred:cred};
})();
`;
