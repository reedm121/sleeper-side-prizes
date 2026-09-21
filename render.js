// Renders the weekly report as a page that carries its own styling, data and faces, and
// reaches outside itself for exactly one thing: the badge art at /badges (see badges.js).
// Thirty badges welded into every week would outweigh everything else on the page and be
// re-downloaded for each week; served as files they are fetched once for the whole site.
// A page opened straight off disk therefore shows no badges, and nothing else changes.
//
// Visual direction: a Sunday broadcast scoreboard. This commits to one world — a dark
// ink-navy ground, angled graphic cuts, condensed signage type — so it deliberately ships
// a single theme and paints every colour explicitly rather than borrowing the host's.
// Each phase of play carries its own accent — Sleeper's own position colours — gold is spent
// only on first place, and every podium row gets a proportional bar so a board can be read
// without reading the numbers.
//
// Hierarchy: ONE thing on this page is live money — the prize the wheel drew for this week —
// so it gets the first screen, the biggest type, and its full twelve-team board. Everything
// underneath it is dressing: the roll call and the other thirty boards, which are only
// there to show who WOULD have won the prizes that were not drawn. They are real numbers and
// they are fun to read, but nothing down there pays, so nothing down there gets to compete
// with the top of the page. Full gold and the big signage sizes are the hero's alone; the
// dressing keeps a dimmed gold so first place still reads first without shouting.

import { badgeImg, badgeCSS, badgeSrc } from './badges.js';
import { WHEEL_CSS, WHEEL_JS } from './wheelui.js';
// A result spreads the whole award, so these read the phase straight off it. The boards
// below the wheel are grouped by phase in the same order as /prizes, so the two pages file
// a prize under the same heading.
import { PHASES, PHASE_KEY, phaseOf, phaseHue } from './awards.js';
import { tiebreakFor } from './compute.js';
import { LEAGUE } from './lib/league.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Keep the decimal — 144.3 and 144 are different scores — but trim trailing zeros, because a
// wide monospace period makes "34.70" read as "34 . 70". A share of a team's score is the one
// value that keeps a fixed decimal, so 28.4% and 28.40% do not read as two different numbers.
const fmtNum = (v, unit) =>
  unit === '%' ? Number(v).toFixed(1) : String(Number.isInteger(v) ? v : Number(Number(v).toFixed(2)));

// The unit is its own element so it can be styled down from the number. Split from fmtNum
// rather than inlined, because the demo reel has to hand the two halves to the client
// separately and the two spellings of a value must not be free to drift apart.
const fmt = (v, unit) => `${fmtNum(v, unit)}${unit ? `<span class="u">${esc(unit)}</span>` : ''}`;

// One reel row: the prize's badge, then its name. Both client spinners build the same row
// from the same pieces (see ffReelRow below), because the reel the manager records and the
// reel the page shipped with have to be the same object.
const reelRow = (id, name, win) =>
  `<li class="${win ? 'win' : ''}" style="--ch:${name.length}">`
  + `${badgeImg(id, { cls: 'reelbadge', eager: true, priority: win ? 'high' : 'low' })}`
  + `<span class="rname">${esc(name)}</span></li>`;

// The reel's row height, in one place: the CSS lays the rows out with it, the server computes
// its landing offset from it, and the two client spinners animate to that offset. Four
// copies of 56 was already one too many, and the hero reel is much taller than that now.
const ROW = 92;

// A summed award's `detail` holds its top CONTRIBUTORS, not its winner. One big face and a
// bare name reads as "this player did it" — true of a max award, a lie on a team total. So
// the marquee only goes solo when the award really is one player; otherwise it shows the
// whole crew, each with the number they put in.
const SOLO_AGG = new Set(['max', 'drive', 'shareOfTeam']);
const isSolo = (a) =>
  SOLO_AGG.has(a.agg) ||
  ((a.agg === 'points' || a.agg === 'projDelta') && (a.mode === 'max' || a.mode === 'min')) ||
  (a.agg === 'bench' && a.mode === 'beast');

// Faces are declared once each as a CSS class and referenced by id. Inlining the data URI
// at every mention would repeat a 3KB string hundreds of times across 52 boards.
const faceClass = (assets, pid) =>
  pid && (assets.players?.[pid] || assets.teams?.[pid]) ? ` f-${String(pid).replace(/[^A-Za-z0-9]/g, '')}` : '';

function faceCSS(assets) {
  const out = [];
  for (const [pid, uri] of Object.entries(assets.players || {}))
    out.push(`.f-${pid.replace(/[^A-Za-z0-9]/g, '')}{background-image:url(${uri})}`);
  for (const [abbr, uri] of Object.entries(assets.teams || {}))
    out.push(`.f-${abbr.replace(/[^A-Za-z0-9]/g, '')}{background-image:url(${uri});background-size:74%}`);
  // Team pictures, keyed by the manager's user id. Same trick: a data URI used twelve times
  // over would otherwise be inlined twelve times into style attributes.
  for (const [uid, uri] of Object.entries(assets.avatars || {}))
    out.push(`.tp-${uid.replace(/[^A-Za-z0-9]/g, '')}{background-image:url(${uri})}`);
  return out.join('\n');
}

const picClass = (assets, ownerId) =>
  ownerId && assets.avatars?.[ownerId] ? ` tp-${String(ownerId).replace(/[^A-Za-z0-9]/g, '')}` : '';

/**
 * The twelve teams, up front, before any prize is argued about. Ranked by the week's score
 * rather than paired off by matchup: every board below this is a league-wide leaderboard,
 * so the roll call reads in the same direction. The head-to-head result still travels with
 * each team, on the row, so nothing about the actual games is lost.
 */
function slate({ ctx, week, A }) {
  const teams = [...ctx.teams].sort((a, b) => b.points - a.points);
  const top = teams[0]?.points ?? 0;
  const rows = teams
    .map((t, i) => {
      const opp = t.opponentTeam;
      const result = !opp
        ? '<span class="res bye">no opponent</span>'
        : t.tiedGame
          ? `<span class="res tie">tied ${esc(opp.name)}</span>`
          : t.won
            ? `<span class="res won">def. ${esc(opp.name)} by ${Math.abs(t.margin)}</span>`
            : `<span class="res lost">lost to ${esc(opp.name)} by ${Math.abs(t.margin)}</span>`;
      return `<li${i === 0 ? ' class="lead"' : ''} style="--w:${(top ? t.points / top : 1).toFixed(3)}">
        <span class="bar"></span>
        <span class="seed">${i + 1}</span>
        <i class="tp${picClass(A, t.ownerId)}" aria-hidden="true"></i>
        <span class="who"><b>${esc(t.name)}</b>${result}</span>
        <span class="pts">${fmtNum(t.points)}</span>
      </li>`;
    })
    .join('');
  return `<section class="slate">
    <h2>The league <span>Week ${week} &middot; ranked by points</span></h2>
    <ol class="teamlist">${rows}</ol>
  </section>`;
}

/** Scale every row against the board's own spread so the leader always reads fullest. */
function widths(rows) {
  const vals = rows.map((r) => r.value);
  const best = vals[0], worst = vals[vals.length - 1];
  const span = Math.abs(best - worst);
  return vals.map((v) => (span === 0 ? 1 : 0.18 + 0.82 * (Math.abs(v - worst) / span)));
}

function podium(a, A) {
  const w = widths(a.rows);
  return a.rows
    .slice(0, 3)
    .map((r, i) => {
      const who = r.detail?.length
        ? `<div class="who">${r.detail
            .map((d) => `<span class="cred"><i class="fc${faceClass(A, d.pid)}"></i>${esc(d.name)}<span class="dv">${d.value}</span></span>`)
            .join('')}</div>`
        : '';
      return `<li class="${i === 0 ? 'first' : ''}" style="--w:${w[i].toFixed(3)}">
        <span class="bar"></span>
        <span class="rank">${i === 0 ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0l1.6 3.6L11.4 4 8.6 6.6l.8 3.8L6 8.6 2.6 10.4l.8-3.8L.6 4l3.8-.4z"/></svg>' : i + 1}</span>
        <span class="val">${fmt(r.value, a.unit)}</span>
        <span class="team">${esc(r.team)}</span>
        ${who}
      </li>`;
    })
    .join('');
}

function awardBlock(a, A) {
  if (a.voided) {
    return `<article class="award void" data-name="${esc(a.name.toLowerCase())} ${esc(a.blurb.toLowerCase())}">
      ${badgeImg(a.id)}
      <h3>${esc(a.name)}</h3>
      <p class="blurb">${esc(a.blurb)}</p>
      <p class="voidmsg">No board &mdash; ${esc(a.voided)}</p>
    </article>`;
  }
  const rest = a.rows.slice(3);
  const w = widths(a.rows);
  const restRows = rest
    .map(
      (r, i) => `<tr style="--w:${w[i + 3].toFixed(3)}">
        <td class="r">${i + 4}</td><td class="t"><span class="minibar"></span>${esc(r.team)}</td>
        <td class="n">${fmt(r.value, a.unit)}</td></tr>`
    )
    .join('');
  const line = a.rows.slice(0, 3).map((r, i) => `${i + 1}. ${r.team} ${r.value}${a.unit ? ' ' + a.unit : ''}`).join('   ');
  // The card is tinted with the phase it comes off, and the section it sits in is headed with
  // that phase, so it carries no chip: "RUSHING" under a heading that says Rushing is just the
  // heading again in a smaller box. Where eligibility is narrower than the phase — Bell Cow is
  // backs only — the blurb says so.
  const hue = phaseHue(a);
  const tagAttr = hue ? ` haspos" style="--pc:var(--p-${hue})` : '';
  return `<article class="award${tagAttr}" data-name="${esc(a.name.toLowerCase())} ${esc(a.blurb.toLowerCase())}">
    <header>
      ${badgeImg(a.id)}
      <div class="ahead">
        <h3>${esc(a.name)}</h3>
        ${a.split ? '<span class="tag split">Split</span>' : ''}
        ${a.tied ? '<span class="tag tie">Dead heat</span>' : ''}
        ${a.tieBroken ? `<span class="tag broke">Tie broken on ${esc(a.tieBroken)}</span>` : ''}
        ${a.margin !== null && a.margin !== undefined && !a.tied && a.margin > 0 && a.margin <= 1 ? `<span class="tag close">By ${a.margin}</span>` : ''}
      </div>
    </header>
    <p class="blurb">${esc(a.blurb)}</p>
    <ol class="podium">${podium(a, A)}</ol>
    <div class="tools">
      ${rest.length ? `<button class="more" data-count="${a.rows.length}" aria-expanded="false">All ${a.rows.length}</button>` : '<span></span>'}
      <button class="copy" data-line="${esc(`${a.name} — ${line}`)}">Copy</button>
    </div>
    ${rest.length ? `<div class="rest" hidden><table>${restRows}</table></div>` : ''}
  </article>`;
}

// Every prize that scored this week, flattened to what the reel needs to show one landing:
// a name, a blurb, who took it, and the full twelve-team board behind it. Only for prizes
// that were actually in the week's pool, so a spin can never land on something that never
// could have come up.
//
// The board travels with every prize in the pool because the page that needs it most cannot
// know which prize it will be showing: a live week's pick is sealed server-side, so the
// standings for whatever the wheel lands on have to be drawn in the browser, after the spin.
// Shipping all of them gives nothing away — what pays is WHICH one, and that is still sealed.
// Short keys: this is twelve rows times thirty-odd prizes on the wire.
//
// The race under the wheel needs one more thing per row: every starter's line and the game it
// came from, which compute.js leaves on the row as `race`. Players and games are shared tables
// (raceTables) referenced by index, so a name is on the wire once and not thirty times.
function raceTables(ctx, A) {
  const players = [], idx = new Map(), gameIdx = new Map();
  (ctx?.games || []).forEach((g, i) => { gameIdx.set(g.home, i); gameIdx.set(g.away, i); });
  const player = (pid, name) => {
    if (!idx.has(pid)) { idx.set(pid, players.length); players.push({ n: name, p: pid, f: A?.players?.[pid] ? 1 : 0 }); }
    return idx.get(pid);
  };
  const game = (nflTeam) => (nflTeam && gameIdx.has(nflTeam) ? gameIdx.get(nflTeam) : -1);
  return { players, games: (ctx?.games || []).map((g) => ({ l: g.label })), player, game };
}

// A player as the page draws one everywhere: face, name, number. The crew on the prize that
// paid is these, not a sentence about them.
const credHTML = (d, A, unit) =>
  `<span class="cred"><i class="fc${faceClass(A, d.pid)}"></i>${esc(d.name)}${d.value !== undefined && d.value !== '' ? `<span class="dv">${esc(String(d.value))}</span>` : ''}</span>`;
const crewHTML = (detail, A, unit) => (detail || []).slice(0, 3).map((d) => credHTML(d, A, unit)).join('');

function reelData(poolIds, results, ctx, T) {
  const owner = new Map((ctx?.teams || []).map((t) => [t.rosterId, t.ownerId]));
  const live = new Map(results.filter((r) => !r.voided && r.rows?.length).map((r) => [r.id, r]));
  const line = (x) => {
    const out = [T.player(x.pid, x.name), x.value, T.game(x.nflTeam)];
    if (x.label !== undefined) out.push(x.label);
    return out;
  };
  return poolIds.filter((id) => live.has(id)).map((id) => {
    const a = live.get(id);
    const row = a.rows[0];
    return {
      id, name: a.name, blurb: a.blurb,
      num: fmtNum(row.value, a.unit),
      unit: a.unit || '',
      team: row.team,
      crew: (row.detail || []).slice(0, 3).map((d) => ({ n: d.name, p: d.pid || '', f: d.pid && T.players ? (players_has(T, d.pid) ? 1 : 0) : 0, v: d.value })),
      pairs: Boolean(a.split),
      mode: row.raceMode || null,
      tbl: tiebreakFor(a).label,
      broke: a.tieBroken ? 1 : 0,
      tied: a.tied ? 1 : 0,
      board: a.rows.map((r) => ({
        t: r.team,
        v: fmtNum(r.value, a.unit),
        tb: r.tb === undefined ? null : r.tb,
        p: owner.get(r.rosterId) || '',
        // The card's own detail, for a prize with no race lines (a matchup, a ratio): the
        // client draws it beside the team the way raceRowsHTML does, faces and all. A detail
        // that is not a player ("lost to …") goes on the shared table under its own name.
        d: (r.detail || []).slice(0, 3).map((d) => [T.player(d.pid || '~' + d.name, d.name), d.value === undefined ? '' : d.value]),
        c: (r.race || []).map(line),
      })),
    };
  });
}
// Whether a face exists for this player, read off the shared table so the crew and the race
// agree on who has a picture.
const players_has = (T, pid) => T.players.some((p) => p.p === pid && p.f);

/**
 * The drawn prize's board, all twelve teams. The award cards below settle for a podium plus a
 * fold-out because there are thirty of them; this one is the week's actual money, so it opens
 * flat — every team, its number, and the players who put it there.
 */
/** The label over the board, shared by a settled week and a live one. */
const boardHead = (n, pairs) =>
  `<div class="bhead"><span>All ${n} ${pairs ? 'matchups' : 'teams'}</span></div>`;

// The spin controls. There is no sign-in and no gate: the prize is drawn and committed to a
// hash by the first page load of the week, so this button cannot choose what comes up, only
// when the league finds out. Whoever presses it first opens it for everybody.
function adminPanel({ demo = false, teams = 0 } = {}) {
  return `        <div class="wadmin" id="wadmin">
          <div id="wready">
            <div class="arow">
              <button type="button" class="respin demo big" id="wspin">Spin the wheel</button>
              <label class="acheck"><input type="checkbox" id="wcam"> Record it &mdash; this tab, camera in the corner</label>
${demo ? '              <button class="respin" type="button" data-demoreset hidden>What it really drew</button>\n' : ''}              <span class="aerr" id="wcamerr" role="status"></span>
            </div>
            <p class="awho">${demo ? 'A demo. Spin it as often as you like — nothing here is recorded to the league.' : 'Turn it yourself. It is the same prize for ' + (teams ? `all ${teams} of you` : 'all of you') + ' — sealed, and hashed, before any of you saw it.'}</p>
            <div class="stagefoot" id="wstage" hidden>
              <span id="wrecnote">Recording starts on the spin and runs until you stop it.</span>
              <a id="wdl" class="respin demo" download hidden>Save the video</a>
            </div>
          </div>
          <div class="bubble" id="wbubble" hidden><video id="wvideo" playsinline muted autoplay></video></div>
          <div class="recbar" id="wrecbar" hidden>
            <span class="recdot" id="wrecdot"></span><span id="wrectime">0:00</span>
            <span class="ask" id="wrecask" hidden>That&rsquo;s the whole show.</span>
            <button type="button" class="respin" id="wrecstop">Stop recording</button>
            <a id="wdl2" class="respin demo" download hidden>Save the video</a>
            <button type="button" class="linky" id="wrecclose" hidden>Close</button>
          </div>
        </div>`;
}

// A live week's wheel. The page is built with everything except the answer: every prize that
// scored, and what each one would pay if it came up. The prize itself is sealed server-side
// (see api/wheel.js) and stays sealed until the manager signs in and spins for it, which is
// the point — he records that spin and sends it to the group chat, and it has to be a real
// moment rather than a page reading out something CI already decided.
//
// A locked wheel hides one prize, not the week: every board still publishes below, and the
// standings for whichever prize it lands on are drawn into the hero when the spin opens it.
function liveWheel({ season, week, results, ctx, A, lock }) {
  const T = raceTables(ctx, A);
  const pool = reelData(results.filter((r) => !r.voided && r.rows?.length).map((r) => r.id), results, ctx, T);

  return `<section class="wheel hero live" id="wheel" data-season="${season}" data-week="${week}"${lock ? ` data-lock="${lock}"` : ''} aria-labelledby="wheelhead">
    <h2 class="eyebrow" id="wheelhead">This week's prize</h2>

    <div class="wgrid">
      <div class="wheelstage" id="wheelstage"><canvas id="wheelcv" width="600" height="680"></canvas></div>
      <aside class="wside">
        <div class="wcard">
          <div class="wstate" id="wstate">
            <p class="wlock">Sealed &mdash; one of <b>${pool.length}</b> prizes that scored this week.</p>
          </div>
${adminPanel({ teams: ctx.teams.length })}
        </div>
      </aside>
    </div>

    <div class="reveal" id="wreveal">
      <div class="rhead" id="wrhead" hidden>
        <span class="rbadge" id="wbadge"></span>
        <div class="rtext">
          <span class="reye" id="weye">Week ${week} pays</span>
          <h3 class="rname" id="wname"></h3>
          <p class="wblurb" id="wblurb"></p>
        </div>
      </div>
      <div class="herogrid">
        <div class="payout">
          <div class="winner" id="wwinner" hidden>
            <span class="wval"></span>
            <span class="wteam"></span>
            <div class="who wcrew" id="wcrew"></div>
            <p class="wtie" id="wtie"></p>
          </div>
        </div>

        <div class="board" id="wboard">
          ${boardHead(ctx.teams.length)}
          <p class="bsealed">Standings appear the moment the wheel lands.</p>
        </div>
      </div>
    </div>

    <div class="wfoot">
      <span id="wproof">Hash published with the page. After the spin it should match the prize.</span>
      <code id="wcommit">&mdash;</code>
    </div>
    <script id="reeldata" type="application/json">${JSON.stringify(pool).replace(/</g, '\\u003c')}<\/script>
    <script id="racedata" type="application/json">${JSON.stringify({ players: T.players, games: T.games }).replace(/</g, '\\u003c')}<\/script>
  </section>`;
}

// The reel is theatre over an answer that is already settled — build.js drew it from the
// week's final scores long before this page rendered. It lands where it was always going to.
//
// Except on a demo page. These 2025 weeks exist to show the league how Tuesday will feel, and
// a reel that lands on the same prize every time demonstrates nothing, so `--demo` adds a
// button that spins to a genuinely random prize out of that week's pool and shows who would
// have taken it. That is a toy on top of the page, not a second wheel: it decides nothing,
// writes nothing, and one click on "what it really drew" puts the recorded answer back. A
// real week is built without the flag and never grows the button.
// One row of the prize's standings, the way the race draws them: rank, team with the players
// who put the number there, a thin bar, the number. The client builds the identical row
// (ffRace) so a race that has finished and a page that never raced read the same.
function raceRowsHTML(award, A) {
  const w = widths(award.rows);
  const one = award.rows[0]?.raceMode === 'max';
  const rows = award.rows, tbl = tiebreakFor(award).label;
  return rows.map((r, i) => {
    const crew = (r.detail || []).slice(0, one ? 1 : i === 0 ? 3 : 2).map((d) => credHTML(d, A, award.unit)).join('');
    const tied = (i > 0 && rows[i - 1].value === r.value) || (i < rows.length - 1 && rows[i + 1].value === r.value);
    const tb = tied && r.tb !== undefined ? `<span class="tb">${esc(tbl)} ${esc(String(r.tb))}</span>` : '';
    return `<li class="${i === 0 ? 'top ' : ''}${i < 3 ? `r${i + 1}` : ''}" style="--w:${w[i].toFixed(3)}">
      <span class="rk">${i + 1}</span>
      <span class="tm"><span class="nm"><b>${esc(r.team)}</b>${crew ? `<span class="crew">${crew}</span>` : ''}${tb}</span><span class="bar"><i></i></span></span>
      <span class="v">${fmt(r.value, award.unit)}</span>
    </li>`;
  }).join('');
}

// What settled a tie at the top, said once under the winner. Nothing when the numbers alone
// decided it. A dead heat says so, because a winner the numbers do not explain reads as a bug.
function tieLine(award) {
  const rows = award.rows || [];
  if (rows.length < 2) return '';
  if (award.tied) return `Dead heat with ${esc(rows[1].team)}`;
  if (!award.tieBroken || rows[0].value !== rows[1].value) return '';
  const tb = tiebreakFor(award).label;
  return `Tied with ${esc(rows[1].team)} &middot; won on ${esc(tb)}, ${esc(String(rows[0].tb))} to ${esc(String(rows[1].tb))}`;
}

// A demo week's hero: the wheel in its own panel with the manager's controls beside it, and
// under them the prize it rests on — badge, name, what it measures, who took it, and the
// standings. A spin turns the wheel, shrinks it, and replays those standings for whatever it
// lands on. Nothing is saved: "what it really drew" puts this exact markup back.
function demoBand(draw, award, results, A, ctx, drawn) {
  const T = raceTables(ctx, A);
  const pool = reelData(draw.pool, results, ctx, T);
  const row = award.rows[0];
  const season = (drawn || []).length
    ? `<ol>${drawn.map((d) => `<li>${badgeImg(d.id, { cls: 'sbadge' })}<span>${esc(d.name)}</span><small>W${d.week}</small></li>`).join('')}</ol>`
    : `<p class="empty">Nothing yet. This is week ${draw.week}.</p>`;

  return `<section class="wheel hero isdemo" data-season="${draw.season}" data-week="${draw.week}" data-pick="${esc(draw.pick)}" aria-labelledby="wheelhead">
    <h2 class="eyebrow" id="wheelhead" data-real="This week's prize">This week's prize</h2>
    <div class="wgrid">
      <div class="wheelstage" id="wheelstage"><canvas id="wheelcv" width="600" height="680"></canvas></div>
      <aside class="wside">
        <div class="wcard">
${adminPanel({ demo: true, teams: ctx.teams.length })}
        </div>
        <div class="wcard wseason">
          <span class="lab">Paid earlier this season</span>
          ${season}
        </div>
      </aside>
    </div>

    <div class="reveal" id="wreveal">
      <div class="rhead">
        <span class="rbadge" id="wbadge">${badgeImg(draw.pick, { cls: 'rart', eager: true, priority: 'high' })}</span>
        <div class="rtext">
          <span class="reye" id="weye" data-real="Week ${draw.week} paid">Week ${draw.week} paid</span>
          <h3 class="rname" id="wname">${esc(award.name)}</h3>
          <p class="wblurb" id="wblurb">${esc(award.blurb)}</p>
        </div>
      </div>
      <div class="herogrid">
        <div class="payout">
          <div class="winner">
            <span class="wval">${fmt(row.value, award.unit)}</span>
            <span class="wteam">${esc(row.team)}</span>
            <div class="who wcrew" id="wcrew">${crewHTML(row.detail, A, award.unit)}</div>
            <p class="wtie" id="wtie">${tieLine(award)}</p>
          </div>
        </div>
        <div class="board" id="wboard">
          ${boardHead(award.rows.length, Boolean(award.split))}
          <ol class="raceboard">${raceRowsHTML(award, A)}</ol>
        </div>
      </div>
    </div>

    <div class="wfoot">
      <span>Drawn from ${draw.pool.length} prizes that scored this week, seeded by the final scores.</span>
      <code>${esc(draw.seed.slice(0, 12))}</code>
    </div>
    <script id="reeldata" type="application/json">${JSON.stringify(pool).replace(/</g, '\\u003c')}<\/script>
    <script id="racedata" type="application/json">${JSON.stringify({ players: T.players, games: T.games }).replace(/</g, '\\u003c')}<\/script>
  </section>`;
}

function wheelBand(draw, award, results, A, demo, ctx, drawn) {
  if (demo) return demoBand(draw, award, results, A, ctx, drawn);
  const nameOf = new Map(results.map((r) => [r.id, r.name]));
  const others = draw.pool.filter((id) => id !== draw.pick && nameOf.has(id));

  // Order the blur from the seed so a rebuild produces a byte-identical page.
  const n = parseInt(draw.seed.slice(16, 32), 16);
  const blur = others
    .map((id, i) => ({ id, k: (n + i * 2654435761) % 4294967296 }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 16)
    .map((x) => x.id);

  const items = [...blur, draw.pick];
  const land = -(items.length - 1) * ROW;

  const row = award.rows[0];
  const T = raceTables(ctx, A);

  // A settled live week keeps the reel: its spin was recorded on the day and the page is the
  // record of it, not a rehearsal.
  return `<section class="wheel hero" data-season="${draw.season}" data-week="${draw.week}" aria-labelledby="wheelhead">
    <h2 class="eyebrow" id="wheelhead" data-real="This week's prize">This week's prize</h2>
    <div class="reel" id="reel" style="--land:${land}px">
      <ul>${items
        .map((id, i) => reelRow(id, nameOf.get(id) || id, i === items.length - 1))
        .join('')}</ul>
    </div>
    <p class="wblurb">${esc(award.blurb)}</p>

    <div class="herogrid">
      <div class="payout">
        <div class="winner">
          <span class="wval">${fmt(row.value, award.unit)}</span>
          <span class="wteam">${esc(row.team)}</span>
          <div class="who wcrew" id="wcrew">${crewHTML(row.detail, A, award.unit)}</div>
        </div>
        <div class="arow">
          <button class="respin" type="button" data-respin>Spin again</button>
        </div>
      </div>

      <div class="board" id="wboard">
        ${boardHead(award.rows.length, Boolean(award.split))}
        <ol class="raceboard">${raceRowsHTML(award, A)}</ol>
      </div>
    </div>

    <div class="wfoot">
      <span>Drawn from ${draw.pool.length} prizes that scored this week, seeded by the final scores.</span>
      <code>${esc(draw.seed.slice(0, 12))}</code>
    </div>
  </section>`;
}

// The section ids and the two phases that have no Sleeper colour of their own. Those two get
// the page's plain accent rather than a colour invented for them.
const PHASE_ID = { 'Team score': 'team', 'All-purpose': 'all' };
const phaseId = (name) => PHASE_KEY[name] || PHASE_ID[name];
const phaseAccent = (name) => (PHASE_KEY[name] ? `var(--p-${PHASE_KEY[name]})` : 'var(--muted)');

export function renderHTML({ results, ctx, leagueInfo, season, week, gate, generatedAt, assets, draw, drawnAward, demo, liveWeek, drawn, lock }) {
  const A = assets || { players: {}, teams: {} };
  const live = results.filter((r) => !r.voided);
  // Everything under the wheel is the prizes it did NOT land on. A settled week knows which
  // one that was and leaves it out — its board is already up top, at full size. A live week's
  // pick is sealed and a demo week's changes every spin, so those show the lot.
  const below = drawnAward && !demo && !liveWeek ? results.filter((r) => r.id !== drawnAward.id) : results;
  const byPhase = {};
  for (const r of below) (byPhase[phaseOf(r)] ||= []).push(r);
  const phases = PHASES.filter((p) => byPhase[p]?.length);

  const stamp = new Date(generatedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: LEAGUE.timezone, timeZoneName: 'short',
  });

  const nav = phases
    .map((p) => `<a href="#ph-${phaseId(p)}" style="--accent:${phaseAccent(p)}">${esc(p)}</a>`)
    .join('');

  const sections = phases
    .map(
      (p) => `<section id="ph-${phaseId(p)}" class="phase" style="--accent:${phaseAccent(p)}">
      <div class="phasehead">
        <h2>${esc(p)}</h2>
        <span class="count">${byPhase[p].filter((a) => !a.voided).length}</span>
      </div>
      <div class="grid">${byPhase[p].map((a) => awardBlock(a, A)).join('')}</div>
    </section>`
    )
    .join('');

  const corpses = ctx.teams.reduce((a, t) => a + t.starters.filter((s) => s.points === 0).length, 0);

  // The one section on the page that decides anything. A week built with neither a live wheel
  // nor a recorded draw has no hero at all — then there is nothing for the rest to be dressing
  // TO, so the boards simply run as the body of the page.
  const hero = liveWeek
    ? liveWheel({ season, week, results, ctx, A, lock })
    : drawnAward
      ? wheelBand(draw, drawnAward, results, A, demo, ctx, drawn)
      : '';

  // These pages were originally Artifacts, where the runtime supplied the doctype, <html> and
  // the viewport meta. Served raw they get neither, so a phone lays the page out at a virtual
  // 980px and scales it down to something unreadable, and the missing doctype puts the whole
  // document in quirks mode. Both belong here now.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${week} — ${esc(LEAGUE.name || leagueInfo.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Big+Shoulders+Display:wght@600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap">
<style>
:root{
  --ground:#070B16; --panel:#101827; --panel-2:#162034; --raise:#1B2740;
  --line:#22304C; --line-2:#2E4066;
  --ink:#EDF2FF; --muted:#94A5C9; --faint:#61729A;
  --gold:#FFC93C; --gold-deep:#8A6408; --gold-film:rgba(255,201,60,.10);
  /* Below the hero nothing pays, so first place there gets gold with the lights down. */
  --gold-dim:#B99333;
  --t1:#C9FF3D; --t2:#FF6B9A; --t3:#3FD8F0; --t4:#FF8A3D; --t5:#B58CFF; --t6:#3FE3AC;
  /* Sleeper's position colours, read from their own stylesheet and carried over to the phase
     each one used to stand for. DEF is lifted from their #d26200 so it stays legible as small
     text on this dark ground. */
  --p-pass:#FF80AD; --p-rush:#49E8CC; --p-rec:#49D0EE; --p-kick:#B7C1EE; --p-def:#E8751A;
  --accent:var(--t1);
}
.t0{--accent:var(--gold)} .t1{--accent:var(--t1)} .t2{--accent:var(--t2)} .t3{--accent:var(--t3)}
.t4{--accent:var(--t4)} .t5{--accent:var(--t5)} .t6{--accent:var(--t6)}
*{box-sizing:border-box}
/* Half this page's state is toggled with the hidden attribute, and a display rule anywhere
   below out-specifies the UA's [hidden]{display:none} — which is how the manager's sign-in
   form survived his own spin. Settle it once, here. */
[hidden]{display:none!important}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:Archivo,system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:17px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1220px; margin:0 auto; padding-inline:20px; padding-block:0 72px}
h1,h2,h3{margin:0; text-wrap:balance}
.val,.dv,.n,.u,.rank,.count{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-variant-numeric:tabular-nums}

/* ---- Masthead: an angled broadcast bug with the week number carrying the weight ---- */
.masthead{
  position:relative; margin-inline:-20px; padding:30px 20px 22px;
  background:
    linear-gradient(105deg,var(--panel-2) 0%,var(--panel) 46%,var(--ground) 100%),
    var(--panel);
  border-bottom:3px solid var(--t1); overflow:hidden;
}
.masthead::after{
  content:""; position:absolute; right:-90px; top:-40px; width:340px; height:300px;
  background:linear-gradient(160deg,rgba(201,255,61,.16),rgba(63,216,240,.05) 60%,transparent);
  transform:skewX(-14deg); pointer-events:none;
}
.masthead::before{
  content:""; position:absolute; inset:0; pointer-events:none; opacity:.55;
  background:repeating-linear-gradient(90deg,transparent 0 59px,rgba(148,165,201,.10) 59px 60px);
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 80%);
  mask-image:linear-gradient(180deg,transparent,#000 80%);
}
.wheel{position:relative; margin:26px 0 30px; padding:24px 22px 20px; border-radius:5px;
  background:linear-gradient(118deg,var(--raise),var(--panel) 62%,var(--ground));
  border:1px solid var(--line-2); border-left:4px solid var(--gold); overflow:hidden}
.wheel::before{content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background:repeating-linear-gradient(90deg,transparent 0 59px,rgba(148,165,201,.07) 59px 60px)}
.wheel>*{position:relative}
.wheel .eyebrow{color:var(--gold); margin-bottom:12px}
.reel{position:relative; height:${ROW}px; overflow:hidden; border-radius:3px;
  background:rgba(7,11,22,.55); box-shadow:inset 0 0 0 1px var(--line)}
.reel::after{content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(90deg,var(--panel) 0,transparent 5%,transparent 95%,var(--panel) 100%)}
.reel ul{position:absolute; top:0; left:0; right:0; margin:0; padding:0; list-style:none;
  display:flex; flex-direction:column; will-change:transform; transform:translateY(var(--land))}
/* Headline type that still has to hold "Put the Team on My Back (Greg Jennings)" on one line:
   take the smaller of the display size and the size that fits this many characters across the
   reel. Big Shoulders averages about 0.42em a character, so 2 x width / characters leaves a
   little air. The --ch it divides by is the prize name's length, set on the row carrying it. */
.reel li{height:${ROW}px; flex:0 0 ${ROW}px; display:flex; align-items:center; justify-content:center; gap:14px;
  font-family:"Big Shoulders Display",sans-serif; font-weight:800; text-transform:uppercase;
  font-size:min(clamp(26px,6.2vw,62px), calc(2 * (min(100vw,1180px) - 190px) / var(--ch,24)));
  line-height:1; letter-spacing:.01em; color:var(--faint);
  white-space:nowrap; padding-inline:14px}
.reel li.win{color:var(--gold)}
/* The badge rides the row it names, so the reel scrolls art and not just words — which is
   the whole point of it on the recording. The row is ${ROW}px and the name has to keep its
   descenders, so the badge stops short of filling it. The 190px taken out of the name's
   size budget above is this badge plus both gaps; without it a long prize name would run
   under the art on a phone. */
.reelbadge{--badge-size:68px}
/* Only the row the wheel lands on is lit. The ones it passes are dimmed with the names. */
.reel li:not(.win) .reelbadge{opacity:.5; filter:grayscale(.5) drop-shadow(0 2px 6px rgba(0,0,0,.45))}
.reel li.win .reelbadge{filter:drop-shadow(0 3px 10px rgba(255,201,60,.28)) drop-shadow(0 2px 6px rgba(0,0,0,.5))}
@media (max-width:560px){.reelbadge{--badge-size:48px}}
.reel.spun ul{animation:reelspin var(--dur,3200ms) cubic-bezier(.12,.72,.16,1) both}
@keyframes reelspin{from{transform:translateY(0)} to{transform:translateY(var(--land))}}
.wheel .winner{display:flex; align-items:baseline; flex-wrap:wrap; gap:8px 14px; margin-top:16px}
.wheel .wval{font-family:"Big Shoulders Display",sans-serif; font-weight:800;
  font-size:clamp(30px,5vw,44px); line-height:1; color:var(--ink)}
.wheel .wteam{font-weight:600; font-size:19px; color:var(--ink)}
.wheel .wwho{font-size:16px; color:var(--muted)}
.wheel .wblurb{margin:10px 0 0; color:var(--muted); font-size:16px; max-width:70ch}
.wheel .wfoot{margin-top:14px; padding-top:12px; border-top:1px solid var(--line);
  display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  font-size:14px; color:var(--faint)}
.wheel .wfoot code{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:13px; color:var(--muted)}
.wheel .wdemo{margin:10px 0 0; padding:8px 12px; border-left:2px solid var(--gold); border-radius:0 3px 3px 0;
  background:rgba(255,201,60,.08); color:var(--muted); font-size:15px}
.wheel .wdemo b{color:var(--gold); font-weight:600}
.wheel .respin.demo{border-color:var(--gold); color:var(--gold)}
.wheel .respin.demo:hover{background:var(--gold); color:#241A00}

/* ---- The hero: this week's prize, and the board that decides it -------------------------
   Sized to own the first screen on its own. The reel is the headline — the prize's name IS
   the news — and the payout and the full board sit under it side by side, because the
   two questions anyone opens this page with are "what is it" and "am I winning it". */
.wheel.hero{margin:0 0 8px; padding:30px 26px 22px; border-left-width:6px; border-radius:0 5px 5px 0}
.wheel.hero .eyebrow{font-size:clamp(19px,3vw,26px); margin-bottom:14px}
/* The wheel sits straight on the hero — no panel of its own, no second gold bar, no padding
   around it. One frame is enough. It also takes more of the row than the card beside it. */
.wheel.hero .wgrid{grid-template-columns:minmax(0,2.2fr) minmax(260px,1fr); gap:30px; align-items:center}
.wheel.hero .wheelstage{margin:-6px 0}
.wheel.hero .wblurb{margin-top:14px; font-size:18px; max-width:78ch}
.herogrid{display:grid; grid-template-columns:minmax(300px,.9fr) minmax(0,1.1fr); gap:20px; margin-top:20px; align-items:start}
.payout{
  padding:18px 18px 20px; border-radius:4px; background:rgba(7,11,22,.55);
  box-shadow:inset 0 0 0 1px var(--line-2); border-left:3px solid var(--gold);
}
.wheel.hero .winner{display:block; margin-top:0}
.wheel.hero .wval{display:block; font-size:clamp(52px,10vw,92px); color:var(--gold); letter-spacing:-.01em}
.wheel.hero .wval .u{font-family:"IBM Plex Mono",monospace; font-size:.3em; font-weight:500; color:var(--gold-deep); filter:brightness(1.9); margin-left:5px}
.wheel.hero .wteam{display:block; font-size:24px; margin-top:6px}
.wheel.hero .arow{display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; margin-top:16px}
.respin.big{font-size:18px; padding:10px 20px; letter-spacing:.04em}

/* The board. Twelve rows, open, no fold — the prize that pays does not get a "show all". */
.board{min-width:0}
.bhead{
  display:flex; align-items:baseline; flex-wrap:wrap; gap:6px 12px; margin-bottom:10px;
  font-family:"Big Shoulders Display",sans-serif; font-weight:700; font-size:19px;
  letter-spacing:.16em; text-transform:uppercase; color:var(--ink);
}
.bhead span{font-family:Archivo,sans-serif; font-weight:400; font-size:14px; letter-spacing:.03em; text-transform:none; color:var(--faint)}
.bsealed{margin:0; padding:16px 16px; border-radius:4px; border:1px dashed var(--line-2);
  background:rgba(7,11,22,.4); color:var(--muted); font-size:16px}
.reel li.sealedrow{color:var(--muted); font-size:clamp(24px,4.6vw,46px); letter-spacing:.04em}

/* The spin controls. A demo page carries the same ones. */
/* The rule sits on the panel rather than on .wadmin, so that once the wheel has been spun and
   it is hidden, the payout does not keep a divider with nothing under it. */
.wadmin{margin-top:16px}
#wready{padding-top:14px; border-top:1px solid var(--line)}
/* The line under the button says what the commitment means, so the absence of a password
   reads as a design rather than as something missing. */
.awho{display:flex; align-items:center; gap:10px; margin:10px 0 0; font-size:14px; color:var(--faint)}
.wlock{margin:0; color:var(--muted); font-size:17px}
.wlock b{color:var(--gold); font-weight:600}
.wstate.done{color:var(--faint); font-size:14px}
.acheck{display:inline-flex; align-items:center; gap:7px; font-size:15px; color:var(--muted)}
.aerr{font-size:14px; color:var(--t2)}
.stagefoot{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
  margin-top:12px; font-size:14px; color:var(--faint)}
/* His face, floating over the page the way a Loom bubble does. It is an ordinary element and
   nothing more: the take is a capture of this tab, so wherever he drags it is where it sits
   in the video, and the page never has to draw him anywhere itself. */
.bubble{position:fixed; left:24px; bottom:24px; width:200px; height:200px; z-index:50;
  border-radius:50%; overflow:hidden; background:#0B0F1C; cursor:grab; touch-action:none;
  box-shadow:0 0 0 3px var(--gold), 0 12px 32px rgba(0,0,0,.55); user-select:none}
.bubble.dragging{cursor:grabbing}
.bubble video{width:100%; height:100%; object-fit:cover; transform:scaleX(-1); display:block; pointer-events:none}
@media (max-width:560px){.bubble{width:120px; height:120px}}
/* The one control that is his and nobody else's: the take ends when he says so, not when the
   page runs out of things to show. It floats so it is still there once he has scrolled down
   to the race. It is in the video too — tab capture sees everything — so it stays small and
   dark, and only lights up gold when the show is over and it is asking. */
.recbar{position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:60;
  display:flex; align-items:center; gap:12px; padding:7px 14px; border-radius:999px;
  background:rgba(11,15,28,.93); box-shadow:0 0 0 1px var(--line-2), 0 10px 28px rgba(0,0,0,.5);
  font-size:14px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap;
  max-width:calc(100vw - 24px); flex-wrap:wrap; justify-content:center}
.recbar.nudge{box-shadow:0 0 0 2px var(--gold), 0 10px 28px rgba(0,0,0,.5)}
.recbar .ask{color:var(--ink)}
.recdot{width:10px; height:10px; border-radius:50%; background:#E5484D; animation:recblink 1.2s infinite}
@keyframes recblink{50%{opacity:.25}}

/* ---- Below the prize: the same numbers, none of the money -----------------------------
   Everything in here is demoted on purpose — dimmer gold, smaller signage, a quieter
   marquee — so the eye never has to work out which part of the page is the incentive. */
.dressing{margin-top:56px; border-top:2px solid var(--line-2)}
.dresshead{display:flex; align-items:baseline; gap:8px 18px; flex-wrap:wrap; padding:16px 0 4px}
.dresshead h2{
  font-family:"Big Shoulders Display",sans-serif; font-weight:800; font-size:27px;
  letter-spacing:.16em; text-transform:uppercase; color:var(--faint);
}
.dresshead p{margin:0; flex:1 1 280px; color:var(--faint); font-size:15px; max-width:72ch}
.dressing .slate{margin-top:22px}
.dressing .teamlist .lead{background:var(--panel); box-shadow:inset 0 0 0 1px var(--line-2)}
.dressing .teamlist .lead .seed,.dressing .teamlist .lead .pts{color:var(--muted)}
.dressing .award h3{font-size:21px}
.dressing .award header .badge{--badge-size:72px}
.dressing .podium .first{background:rgba(185,147,51,.09); box-shadow:inset 0 0 0 1px rgba(185,147,51,.3)}
.dressing .podium .first .bar{background:linear-gradient(90deg,rgba(185,147,51,.26),rgba(185,147,51,0))}
.dressing .podium .first .val{font-size:25px; color:var(--gold-dim)}
.dressing .podium .rank svg{fill:var(--gold-dim)}
.dressing .tag.tie{background:var(--gold-dim)}
.dressing .tag.broke{border-color:var(--gold-dim); color:var(--gold-dim); background:rgba(185,147,51,.08)}
.respin{font:inherit; font-size:14px; font-weight:600; color:var(--faint); cursor:pointer;
  background:none; border:1px dashed var(--line-2); border-radius:3px; padding:4px 11px}
.respin:hover{color:var(--ink); border-color:var(--ink); border-style:solid}
.respin:focus-visible{outline:2px solid var(--t3); outline-offset:2px}
.sitenav{position:relative; display:flex; gap:18px; margin-bottom:18px;
  font-size:15px; font-weight:600; letter-spacing:.03em}
.sitenav a{color:var(--muted); text-decoration:none; border-bottom:1px solid transparent}
.sitenav a:hover{color:var(--ink); border-bottom-color:currentColor}
.sitenav a:focus-visible{outline:2px solid var(--t3); outline-offset:3px}
.mast-inner{position:relative; display:flex; align-items:flex-end; gap:22px; flex-wrap:wrap}
.wknum{
  font-family:"Big Shoulders Display",Archivo,sans-serif; font-weight:800;
  font-size:clamp(52px,9vw,84px); line-height:.76; letter-spacing:-.02em;
  color:transparent; -webkit-text-stroke:1.5px var(--t1);
  padding-right:4px;
}
.mast-copy{flex:1 1 260px; min-width:0}
.eyebrow{
  font-family:"Big Shoulders Display",Archivo,sans-serif; font-weight:700; font-size:19px;
  letter-spacing:.22em; text-transform:uppercase; color:var(--t1);
}
/* Deliberately smaller than the prize below it: this names the page, the hero is the point. */
h1{
  font-family:"Big Shoulders Display",Archivo,sans-serif; font-weight:800;
  font-size:clamp(28px,5vw,42px); line-height:.9; letter-spacing:.01em;
  text-transform:uppercase; margin-block:3px 10px; color:var(--muted);
}
.subline{display:flex; flex-wrap:wrap; gap:6px 16px; align-items:center; color:var(--muted); font-size:16px}
.subline b{color:var(--ink); font-weight:600}
.pill{
  display:inline-flex; align-items:center; gap:7px; padding:5px 11px;
  border:1px solid var(--line-2); border-radius:999px; background:rgba(7,11,22,.5);
  font-size:15px; color:var(--muted);
}
.pill .dot{width:7px; height:7px; border-radius:50%; background:var(--t6); box-shadow:0 0 8px var(--t6)}
.pill.partial .dot{background:var(--t4); box-shadow:0 0 8px var(--t4)}

/* ---- Controls ---- */
.controls{
  display:flex; flex-wrap:wrap; gap:10px; align-items:center;
  position:sticky; top:0; z-index:5; background:var(--ground); padding-block:12px;
  border-bottom:1px solid var(--line);
}
#find{
  flex:1 1 300px; min-width:210px; padding:10px 13px; font:inherit; font-size:16px;
  color:var(--ink); background:var(--panel); border:1px solid var(--line-2); border-radius:3px;
}
#find::placeholder{color:var(--faint)}
#find:focus-visible{outline:2px solid var(--t1); outline-offset:1px; border-color:transparent}
.jump{display:flex; flex-wrap:wrap; gap:3px}
.jump a{
  font-family:"Big Shoulders Display",sans-serif; font-weight:700; font-size:16px;
  letter-spacing:.1em; text-transform:uppercase; color:var(--muted); text-decoration:none;
  padding:6px 10px; border:1px solid var(--line); border-radius:3px; white-space:nowrap;
}
.jump a:hover,.jump a:focus-visible{color:var(--ground); background:var(--accent); border-color:var(--accent)}

/* ---- The boards, by phase of play ----
   One section per phase, one card style for all of them. No section outranks another down
   here — the house prizes used to get bigger type and a heavier card, which made a second
   headline out of a part of the page that is not one. */
.phase{margin-top:36px; scroll-margin-top:70px}
.phasehead{display:flex; align-items:center; gap:12px; border-bottom:2px solid var(--accent); padding-bottom:8px; margin-bottom:16px}
.phasehead h2{
  font-family:"Big Shoulders Display",sans-serif; font-weight:800; font-size:26px;
  letter-spacing:.06em; text-transform:uppercase; color:var(--accent);
}
.phasehead .count{
  margin-left:auto; font-size:13px; font-weight:600; color:var(--accent);
  padding:1px 8px; border-radius:999px; box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 50%,transparent);
}
.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:16px}

/* ---- Award card ---- */
.award{
  background:var(--panel); border:1px solid var(--line); border-radius:4px;
  padding:16px 17px 14px; display:flex; flex-direction:column; position:relative; overflow:hidden;
}
.award::before{content:""; position:absolute; inset:0 0 auto; height:2px; background:var(--accent); opacity:.65}
/* Badge, then everything else. The name and its chips wrap among themselves inside .ahead,
   which keeps a three-line prize name from pushing the badge onto a line of its own. */
.award header{display:flex; align-items:center; gap:10px}
.ahead{display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0}
/* Doubled from 44/52 on 2026-09-14. The art is the fastest way to recognise which prize a
   board belongs to, and at the old size it read as a bullet point rather than as the badge. */
.award header .badge{--badge-size:88px}
/* A voided card has no header to sit in, and nothing on it is worth much attention anyway. */
.award.void>.badge{--badge-size:80px; opacity:.45; margin-bottom:6px}
.award h3{
  font-family:"Big Shoulders Display",sans-serif; font-weight:700; font-size:24px;
  letter-spacing:.04em; text-transform:uppercase; line-height:1.05;
}
.blurb{margin:2px 0 13px; color:var(--muted); font-size:15.5px}
.tag{font-size:13px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; padding:2px 7px; border-radius:3px}
.tag.tie{background:var(--gold); color:#241A00}
.tag.split{background:var(--t6); color:#04231A}
.tag.house{background:var(--accent); color:var(--ground)}
.award.haspos::before{background:var(--pc); opacity:.9}
.tag.close{border:1px solid var(--line-2); color:var(--muted)}
/* A prize decided by the standing tiebreak rather than the stat itself. Stated plainly on
   the card, because a winner the numbers do not explain reads as a bug. */
.tag.broke{border:1px solid var(--gold); color:var(--gold); background:var(--gold-film)}

.podium{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px}
.podium li{
  position:relative; display:grid; grid-template-columns:18px auto 1fr;
  align-items:baseline; gap:3px 10px; padding:6px 9px; border-radius:3px;
  background:var(--panel-2); isolation:isolate;
}
.podium .bar{
  position:absolute; inset:0 auto 0 0; width:100%; z-index:-1; border-radius:3px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 30%,transparent),color-mix(in srgb,var(--accent) 0%,transparent));
  transform:scaleX(var(--w)); transform-origin:left center;
  animation:grow .5s cubic-bezier(.2,.8,.3,1) both;
}
@keyframes grow{from{transform:scaleX(0)}}
.podium .rank{color:var(--faint); font-size:14px; text-align:center}
.podium .rank svg{width:12px; height:12px; fill:var(--gold); display:block; margin:0 auto}
.podium .val{font-size:20px; font-weight:600; white-space:nowrap}
.podium .val .u{font-size:13px; color:var(--faint); margin-left:2px}
.podium .team{font-size:16.5px; min-width:0; overflow-wrap:anywhere}
.podium .who{grid-column:2 / -1; display:flex; flex-wrap:wrap; gap:3px 10px; font-size:14px; color:var(--faint); overflow-wrap:anywhere; margin-top:3px}
.cred{display:inline-flex; align-items:center; gap:5px}

/* ---- the league, up top ------------------------------------------------------------ */
.slate{margin:34px 0 40px}
.slate h2{
  margin:0 0 14px; font-size:15px; font-weight:600; letter-spacing:.14em; text-transform:uppercase;
  color:var(--muted); display:flex; flex-wrap:wrap; align-items:baseline; gap:12px;
}
.slate h2 span{letter-spacing:.04em; text-transform:none; font-weight:400; color:var(--faint); font-size:14px}
.teamlist{
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:8px;
}
.teamlist li{
  position:relative; overflow:hidden; isolation:isolate;
  display:grid; grid-template-columns:22px 44px 1fr auto; align-items:center; gap:12px;
  padding:10px 14px; border-radius:11px; background:var(--panel);
  box-shadow:inset 0 0 0 1px var(--line);
}
/* Score as a bar behind the row, so the spread is visible without a second column. */
.teamlist .bar{
  position:absolute; z-index:-1; inset:0 auto 0 0; width:calc(var(--w) * 100%);
  background:linear-gradient(90deg,var(--raise),rgba(27,39,64,0));
}
.teamlist .seed{
  font-family:"IBM Plex Mono",monospace; font-size:13px; color:var(--faint); text-align:right;
}
.tp{
  width:44px; height:44px; border-radius:50%; flex:none;
  background:var(--panel-2) center/cover no-repeat;
  box-shadow:inset 0 0 0 1px var(--line-2);
}
.teamlist .who{min-width:0; display:flex; flex-direction:column; gap:2px}
.teamlist .who b{font-size:16.5px; font-weight:600; overflow-wrap:anywhere}
.teamlist .res{font-size:13px; color:var(--faint)}
.teamlist .res.won{color:var(--t6)}
.teamlist .res.lost{color:var(--t2)}
.teamlist .pts{font-family:"IBM Plex Mono",monospace; font-size:19px; font-weight:500; white-space:nowrap}
.teamlist .lead{box-shadow:inset 0 0 0 1px rgba(255,201,60,.34); background:var(--gold-film)}
.teamlist .lead .seed,.teamlist .lead .pts{color:var(--gold)}

.fc{
  width:19px; height:19px; border-radius:50%; flex:none;
  background:var(--panel) center/cover no-repeat;
  box-shadow:inset 0 0 0 1px var(--line-2);
}
.fc:not([class*=" f-"]){display:none}

.podium .dv{margin-left:4px; color:var(--muted)}

/* First place gets the only gold on the page. */
.podium .first{
  background:linear-gradient(100deg,var(--gold-film),rgba(255,201,60,.02));
  box-shadow:inset 0 0 0 1px rgba(255,201,60,.34);
}
.podium .first .bar{background:linear-gradient(90deg,rgba(255,201,60,.34),rgba(255,201,60,0))}
.podium .first .val{font-size:28px; color:var(--gold); letter-spacing:-.02em}
.podium .first .val .u{color:var(--gold-deep); filter:brightness(1.9)}
.podium .first .team{font-weight:600; color:var(--ink)}

.tools{display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:13px; padding-top:10px; border-top:1px solid var(--line)}
.tools button{
  font-family:"Big Shoulders Display",sans-serif; font-weight:700; font-size:16px;
  letter-spacing:.1em; text-transform:uppercase; color:var(--muted);
  background:none; border:1px solid var(--line-2); border-radius:3px; padding:4px 11px; cursor:pointer;
}
.tools button:hover{color:var(--ground); background:var(--accent); border-color:var(--accent)}
.tools button:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.rest{margin-top:10px; overflow-x:auto}
.rest table{width:100%; border-collapse:collapse; font-size:15.5px}
.rest td{padding:5px 0; border-bottom:1px solid var(--line)}
.rest td.r{color:var(--faint); width:24px; font-family:"IBM Plex Mono",monospace; font-size:14px}
.rest td.t{position:relative; padding-left:8px}
.rest .minibar{
  position:absolute; left:0; top:3px; bottom:3px; width:100%; border-radius:2px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 18%,transparent),color-mix(in srgb,var(--accent) 0%,transparent));
  transform:scaleX(var(--w)); transform-origin:left center; z-index:-1;
}
.rest td.t{isolation:isolate}
.rest td.n{text-align:right; font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; white-space:nowrap}
.rest .u{font-size:13px; color:var(--faint); margin-left:2px}

.award.void{opacity:.5; background:var(--ground); border-style:dashed}
.award.void::before{background:var(--faint); opacity:.3}
.voidmsg{margin:0; font-size:15px; color:var(--t4)}
.award.hide,.phase.hide{display:none}

footer{margin-top:52px; padding-top:20px; border-top:2px solid var(--line-2); color:var(--faint); font-size:15px}
footer p{margin:0 0 8px; max-width:74ch}
footer b{color:var(--muted); font-weight:600}
footer code{font-family:"IBM Plex Mono",monospace; font-size:14px; color:var(--muted)}

@media (max-width:900px){
  .herogrid{grid-template-columns:1fr}
  /* A phone is one column: the wheel takes the full width, the card with the button sits
     under it. This has to be said here as well as in WHEEL_CSS, because the hero's own
     two-column rule above is more specific than the generic collapse and would win. */
  .wheel.hero .wgrid{grid-template-columns:minmax(0,1fr); gap:18px}
  .wheel.hero .wheelstage{margin:0}
}
@media (max-width:560px){
  .wrap{padding-inline:16px}
  .masthead{margin-inline:-16px; padding-inline:16px}
  .wheel.hero{margin-inline:-16px; padding:22px 16px 18px; border-radius:0; border-left-width:4px}
  /* A phone cannot hold "Put The Team On My Back (Greg Jennings)" on one line at a size worth
     reading, and this row IS the headline, so here it gets two lines instead of getting small.
     Twice the lines, twice the character budget: the same fit-to-width sum, doubled. */
  .reel li{white-space:normal; line-height:1.02;
    font-size:min(clamp(21px,6.6vw,34px), calc(3.6 * (100vw - 62px) / var(--ch,24)))}
  .dresshead h2{font-size:23px}
  .grid{grid-template-columns:1fr}
  .teamlist{grid-template-columns:1fr}
  .teamlist li{grid-template-columns:18px 36px 1fr auto; gap:10px; padding:9px 11px}
  .tp{width:36px; height:36px}
  .controls{position:static}
  .wknum{font-size:54px}
}
${badgeCSS()}
${WHEEL_CSS}
@media (prefers-reduced-motion:reduce){
  *{animation:none!important; transition:none!important}
  .podium .bar,.rest .minibar{animation:none!important}
}
</style>
<style id="faces">${faceCSS(A)}</style>
</head>
<body>

<div class="wrap">
  <header class="masthead">
    <nav class="sitenav">
      <a href="/archive">&larr; All weeks</a>
      <a href="/awards">Prize board</a>
      <a href="/prizes">The prize list</a>
    </nav>
    <div class="mast-inner">
      <div class="wknum">${week}</div>
      <div class="mast-copy">
        <div class="eyebrow">${esc(LEAGUE.name || leagueInfo.name)} &middot; Side Prizes</div>
        <h1>Week ${week}</h1>
        <div class="subline">
          <b>${season} regular season</b>
          <span>${ctx.teams.length} teams</span>
          <span class="pill ${gate.final ? '' : 'partial'}"><span class="dot"></span>${
            gate.final ? `All ${gate.games} games final` : `${gate.done} of ${gate.games} games final &middot; provisional`
          }</span>
        </div>
      </div>
    </div>
  </header>

  ${hero}

  ${hero ? `<div class="dressing">
    <div class="dresshead">
      <h2>Just for fun</h2>
      <p>The wheel pays one prize a week. These are the rest, scored anyway &mdash; who would have
      taken each one, by the part of the game it comes off. Real numbers, none of the money.</p>
    </div>` : ''}

  ${slate({ ctx, week, A })}

  <div class="controls">
    <input id="find" type="search" placeholder="Find a prize &mdash; try &quot;longest&quot;, &quot;bench&quot;, &quot;drop&quot;" autocomplete="off">
    <nav class="jump">${nav}</nav>
  </div>

  ${sections}
  ${hero ? '</div>' : ''}

  <footer>
    <p>Sleeper's public API, joined on player id: week ${week} <code>starters</code> against that
    week's box scores &mdash; the players actually started, not today's roster. ${live.length} of
    ${results.length} boards scored.${corpses ? ` ${corpses} starter${corpses === 1 ? '' : 's'} scored zero.` : ''}</p>
    <p>Totals add up every starter; &ldquo;longest&rdquo; takes the single best play. Ties go to the
    higher team score, or on a one-position prize to the higher-scoring player at that position. Ratio prizes
    carry a minimum-volume gate. Bars scale within each board. <em>No board</em> means the stat was
    not charted league-wide that week.</p>
    <p>Final as of <b>${esc(stamp)}</b>. Stat corrections land for several days after a game, so a
    close board can still move.</p>
  </footer>
</div>

<script>
// ---- the hero's board ---------------------------------------------------------------------
// The standings belong to whichever prize the wheel landed on, so any page where the wheel can
// still move has to build them here: a live week's pick is sealed until the manager spins, and
// a demo week's toy spin lands somewhere new every time. One builder (ffRace) draws them, the
// same rows the server writes for a settled week, so Tuesday looks exactly like its rehearsal:
// raced into place after a spin with the payout column reading the leader as it goes, or
// settled at once for a page that is a record of the week rather than the event of it.
//
// The players and games tables ship once per page, beside the prizes rather than on each one.
function ffTables(){
  try{ return JSON.parse(document.getElementById('racedata').textContent); }catch(e){ return {players:[],games:[]}; }
}
function ffRaceInto(p, done){
  var box=document.getElementById('wboard');
  if(!box||!p||!p.board||!window.ffRace) return null;
  var payout=box.closest('.wheel').querySelector('.payout'),
      val=payout.querySelector('.wval'), team=payout.querySelector('.wteam'), crew=document.getElementById('wcrew');
  var showVal=function(num,unit){
    val.textContent=num;
    if(unit){ var u=document.createElement('span'); u.className='u'; u.textContent=unit; val.appendChild(u); }
  };
  return window.ffRace.run({
    box:box, p:p, tables:ffTables(), payout:payout, slot:2.5, dur:18,
    // The race writes the leader into the payout column as it goes: the big number is whoever
    // is in front right now, and the faces under it are the players who put them there.
    onLeader:function(l){
      showVal(l.v,l.unit); team.textContent=l.t;
      var k=l.crew.map(function(e){ return e.pi; }).join(',');
      if(crew.dataset.k!==k){ crew.dataset.k=k; window.ffRace.crewInto(crew,l.crew,l.players,l.unit,l.crew.length); }
    },
    onDone:function(f){
      delete crew.dataset.k;
      showVal(p.num,p.unit); team.textContent=p.team; ffTieLine(p);
      if(f.row.c&&f.row.c.length) window.ffRace.crewFromRow(crew,f.row,f.players,f.unit,f.max);
      else ffCrewPaint(crew,p.crew,p.unit);
      if(done) done();
    }
  });
}
// One reel row, built the way the server builds it (see reelRow) — badge, then name. Both
// spinners go through here so a spun reel and the reel the page shipped with cannot drift.
//
// The badge deletes itself if it will not load. That matters most on the live wheel: the
// manager is recording, and the row that just announced the week's prize must not carry a
// broken-image icon into the group chat.
function ffReelRow(p, win){
  var li=document.createElement('li');
  if(win) li.className='win';
  li.style.setProperty('--ch',String(p.name.length));
  var img=document.createElement('img');
  img.className='badge reelbadge'; img.alt=''; img.width=384; img.height=384;
  img.decoding='async'; img.fetchPriority=win?'high':'low';
  img.onerror=function(){ img.remove(); };
  img.src='/badges/'+p.id+'.webp';
  li.appendChild(img);
  var nm=document.createElement('span'); nm.className='rname'; nm.textContent=p.name;
  li.appendChild(nm);
  return li;
}
// The same board, settled at once: a locked week showing what it paid, not racing it again.
function ffPaintBoard(p){
  var box=document.getElementById('wboard');
  if(!box||!p||!p.board||!window.ffRace) return;
  window.ffRace.run({box:box, p:p, tables:ffTables(), instant:true});
}
// What settled a tie at the top, from the numbers the prize shipped with (see tieLine).
function ffTieLine(p){
  var el=document.getElementById('wtie'); if(!el) return;
  var b=p.board||[]; el.textContent='';
  if(b.length<2) return;
  if(p.tied){ el.textContent='Dead heat with '+b[1].t; return; }
  if(!p.broke||b[0].v!==b[1].v) return;
  el.textContent='Tied with '+b[1].t+' \u00b7 won on '+p.tbl+', '+b[0].tb+' to '+b[1].tb;
}
// The prize's crew — face, name, number — into the payout column.
function ffCrewPaint(el,crew,unit){
  if(!el) return; el.innerHTML='';
  (crew||[]).forEach(function(c){ el.appendChild(window.ffRace.cred({n:c.n,p:c.p,f:c.f}, c.v===undefined||c.v===''?'':String(c.v))); });
}
${WHEEL_JS}
(function(){
  // ---- the manager's gate, his camera, and the recorder ---------------------------------
  // One module behind both wheels. A live week asks it for a spin and then opens the prize the
  // server sealed; a demo week asks for exactly the same spin and then picks locally, deciding
  // nothing. Putting the demo behind the real gate is most of what the demo is for: Tuesday
  // includes being asked who you are and watching your own face appear in the corner, and the
  // rehearsal is worth nothing if it skips the two steps most likely to go wrong on camera.
  var panel=document.getElementById('wadmin'), reeldata=document.getElementById('reeldata');
  if(!panel || !reeldata) return;

  var band=panel.closest('.wheel'),
      spinBtn=document.getElementById('wspin'),
      camBtn=document.getElementById('wcam'), stage=document.getElementById('wstage'),
      video=document.getElementById('wvideo'),
      camErr=document.getElementById('wcamerr'), dl=document.getElementById('wdl'),
      recNote=document.getElementById('wrecnote');

  var season=band.dataset.season||'', week=band.dataset.week||'';
  var pool=JSON.parse(reeldata.textContent);
  var media=null, rec=null, chunks=[], onSpin=null;

  var say=function(el,msg){ if(el) el.textContent=msg||''; };
  var api=function(body){
    return fetch('/api/wheel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(b){ if(!r.ok) throw new Error(b.message||b.error||r.status); return b; }); });
  };

  // ---- camera, mic, and the recording ---------------------------------------------------
  // A take is a capture of this tab, with his camera floating over it as a bubble he can drag
  // about, the way a Loom looks. The page draws nothing for the video: the bubble is a normal
  // element, so what the capture sees is exactly what he sees. Ticking "Record it" gets it all
  // up and granted before he commits — camera, mic, then the tab, which Chrome offers first in
  // its picker — so the spin itself only has to press record.
  var bubble=document.getElementById('wbubble'), recbar=document.getElementById('wrecbar'),
      recDot=document.getElementById('wrecdot'), recTime=document.getElementById('wrectime'),
      recAsk=document.getElementById('wrecask'), recStop=document.getElementById('wrecstop'),
      dl2=document.getElementById('wdl2'), recClose=document.getElementById('wrecclose');
  var screen=null, tick=null, t0=0;

  function dropAll(){
    if(rec && rec.state!=='inactive') rec.stop();
    [media,screen].forEach(function(st){ if(st) st.getTracks().forEach(function(t){ t.stop(); }); });
    media=null; screen=null;
    bubble.hidden=true; stage.hidden=true;
  }

  camBtn.addEventListener('change',function(){
    say(camErr,'');
    if(!camBtn.checked){ dropAll(); return; }
    var md=navigator.mediaDevices;
    if(!md||!md.getUserMedia){
      camBtn.checked=false; say(camErr,'This browser will not hand over a camera.'); return;
    }
    md.getUserMedia({video:{width:640,height:480},audio:true})
      .then(function(s){
        media=s; video.srcObject=s; bubble.hidden=false; placeBubble();
        // No tab capture on a phone. The bubble is still up, so the phone's own screen
        // recorder gets the same picture — that is the take, and it is his to start and stop.
        if(!md.getDisplayMedia){
          stage.hidden=false;
          say(recNote,'This phone cannot record the page itself. Start its screen recorder (Control Center on an iPhone), then spin \u2014 the bubble is in it.');
          return null;
        }
        return md.getDisplayMedia({
          video:{displaySurface:'browser'}, audio:false,
          preferCurrentTab:true, selfBrowserSurface:'include', surfaceSwitching:'exclude', monitorTypeSurfaces:'exclude'
        });
      })
      .then(function(s){
        if(!s) return;
        screen=s;
        // The browser's own "stop sharing" bar ends the take as well, wherever it is.
        s.getVideoTracks()[0].addEventListener('ended',function(){ if(rec&&rec.state!=='inactive') rec.stop(); dropAll(); camBtn.checked=false; });
        stage.hidden=false;
        say(recNote,'Ready. Drag the bubble where you want it; the spin starts the recording.');
      })
      .catch(function(e){ camBtn.checked=false; dropAll(); say(camErr,'Not recording: '+e.message); });
  });

  // The bubble goes back where he last left it, in this browser.
  var BKEY='ffl.bubble';
  function placeBubble(){
    var at=null; try{ at=JSON.parse(localStorage.getItem(BKEY)||'null'); }catch(e){}
    if(at){ bubble.style.left=Math.min(at.x,innerWidth-60)+'px'; bubble.style.top=Math.min(at.y,innerHeight-60)+'px'; bubble.style.bottom='auto'; }
  }
  var drag=null;
  bubble.addEventListener('pointerdown',function(e){
    var r=bubble.getBoundingClientRect();
    drag={dx:e.clientX-r.left, dy:e.clientY-r.top};
    bubble.classList.add('dragging'); bubble.setPointerCapture(e.pointerId); e.preventDefault();
  });
  bubble.addEventListener('pointermove',function(e){
    if(!drag) return;
    var x=Math.max(0,Math.min(innerWidth-bubble.offsetWidth,e.clientX-drag.dx));
    var y=Math.max(0,Math.min(innerHeight-bubble.offsetHeight,e.clientY-drag.dy));
    bubble.style.left=x+'px'; bubble.style.top=y+'px'; bubble.style.bottom='auto';
  });
  var release=function(){
    if(!drag) return;
    drag=null; bubble.classList.remove('dragging');
    var r=bubble.getBoundingClientRect();
    try{ localStorage.setItem(BKEY,JSON.stringify({x:r.left,y:r.top})); }catch(e){}
  };
  bubble.addEventListener('pointerup',release); bubble.addEventListener('pointercancel',release);

  function startRecording(){
    if(!media||!screen) return;
    chunks=[];
    var stream=new MediaStream(screen.getVideoTracks().concat(media.getAudioTracks()));
    try { rec=new MediaRecorder(stream,{mimeType:'video/webm'}); }
    catch(e){ say(camErr,'This browser will not record: '+e.message); return; }
    rec.ondataavailable=function(e){ if(e.data.size) chunks.push(e.data); };
    rec.onstop=function(){
      clearInterval(tick); tick=null;
      var blob=new Blob(chunks,{type:'video/webm'});
      var href=URL.createObjectURL(blob), file='new-ro-wheel-week-'+week+'.webm';
      dl.href=href; dl.download=file; dl.hidden=false;
      dl2.href=href; dl2.download=file; dl2.hidden=false;
      recDot.hidden=true; recAsk.hidden=true; recStop.hidden=true; recClose.hidden=false;
      recbar.classList.remove('nudge');
      say(recNote,'Recording saved. Download it and drop it in the group chat.');
    };
    rec.start();
    t0=Date.now();
    recbar.hidden=false; recDot.hidden=false; recStop.hidden=false;
    recAsk.hidden=true; dl2.hidden=true; recClose.hidden=true; recbar.classList.remove('nudge');
    clock(); tick=setInterval(clock,500);
    say(recNote,'Recording\u2026');
  }
  function clock(){
    var sec=Math.floor((Date.now()-t0)/1000);
    recTime.textContent=Math.floor(sec/60)+':'+('0'+sec%60).slice(-2);
  }
  recStop.addEventListener('click',function(){ if(rec && rec.state!=='inactive') rec.stop(); });
  recClose.addEventListener('click',function(){ recbar.hidden=true; });

  spinBtn.addEventListener('click',function(){
    if(!onSpin) return;
    spinBtn.disabled=true;
    say(camErr,'');
    var taping=Boolean(camBtn.checked && media && screen);
    if(taping) startRecording();

    onSpin({
      recording:taping,

      // The show is over — wheel landed, race run, nothing left to watch. The take does NOT
      // stop here: it asks. He may still be talking, and ending the video is his call.
      done:function(){
        if(rec && rec.state==='recording'){ recAsk.hidden=false; recbar.classList.add('nudge'); }
      },

      // A demo spins as often as he likes; a live week is over the moment it opens and never
      // calls this. A second spin is part of the same take if he is still rolling.
      again:function(){
        spinBtn.disabled=false;
        recAsk.hidden=true; recbar.classList.remove('nudge');
      },

      // Nothing happened, so there is nothing to end: the take keeps rolling and he decides.
      fail:function(msg){
        spinBtn.disabled=false;
        say(camErr,msg);
      }
    });
  });

  window.ffWheel={
    spin:function(fn){ onSpin=fn; },
    // Everything that could turn the wheel a second time, and nothing else: the footer stays,
    // because the recording is still being written when the wheel lands and the download link
    // lives in it.
    close:function(){
      var row=panel.querySelector('.arow'); if(row) row.hidden=true;
      var who=panel.querySelector('.awho'); if(who) who.hidden=true;
    },
    hide:function(){ panel.hidden=true; }
  };
})();
(function(){
  // The reel rests on the winner, so this only adds the journey. Anyone with reduced motion
  // set never sees it move and is not missing an answer.
  var reel=document.getElementById('reel');
  if(!reel) return;
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ROW=${ROW};

  var spin=function(){
    if(still) return;
    reel.classList.remove('spun');
    void reel.offsetWidth;             // restart the animation rather than ignore a second click
    reel.classList.add('spun');
  };
  spin();

  var again=document.querySelector('[data-respin]');
  if(again) again.addEventListener('click', spin);

})();
(function(){
  // ---- demo pages only: the wheel and the race --------------------------------------
  // A real week's answer came off its own final scores and is not up for negotiation. These
  // demo weeks get the wheel itself: it rests on the prize the week drew, and behind the
  // manager's gate it spins to a random prize out of that week's pool, shrinks away, and
  // replays the standings for it as the week was played. Nothing is saved and nothing is
  // decided — "what it really drew" is one click away and a reload puts the record back.
  var stage=document.getElementById('wheelstage'), data=document.getElementById('reeldata'), rdata=document.getElementById('racedata');
  if(!stage || !data || !rdata || !window.ffWheel || !window.ffWheelUI) return;
  // A live week has a wheel stage of its own now, and this block must not touch it. What is
  // below picks a prize at random and settles nothing, which is the whole point on a week
  // that is already over and an invented answer on one that is not. Demo pages only, and
  // the class is what says so — the presence of a canvas no longer does.
  if(!stage.closest('.wheel.isdemo')) return;

  var pool=JSON.parse(data.textContent);
  if(pool.length<2) return;
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;

  var band=stage.closest('.wheel'), realPick=band.dataset.pick, week=band.dataset.week||'';
  var head=document.getElementById('wheelhead'), reveal=document.getElementById('wreveal');
  var back=band.querySelector('[data-demoreset]');
  var eye=document.getElementById('weye'), name=document.getElementById('wname'),
      badge=document.getElementById('wbadge'), blurb=document.getElementById('wblurb');
  var val=band.querySelector('.wval'), team=band.querySelector('.wteam'),
      crew=document.getElementById('wcrew'), boardBox=document.getElementById('wboard'),
      payout=band.querySelector('.payout');
  // The race dresses the payout column while it runs (see ffRace); this is the undressed one.
  var plain=function(){ payout.classList.remove('racing','won'); payout.removeAttribute('data-live'); };
  var realName=name.textContent;
  var real={head:head.dataset.real, eye:eye.dataset.real, name:realName, badge:badge.innerHTML,
            blurb:blurb.textContent, valHTML:val.innerHTML, team:team.textContent,
            crew:crew.innerHTML, board:boardBox.innerHTML, tie:document.getElementById('wtie').textContent};
  var busy=false, race=null, show=null;   // show: the recorder's handle for the current take

  var ui=window.ffWheelUI.create({
    canvas:document.getElementById('wheelcv'), pool:pool, hub:['WEEK', week],
    badge:function(id){ return '/badges/'+id+'.webp'; },
    max:760                              // fill the column it now has to itself
  });
  ui.restOn(realPick);

  var setBadge=function(id){
    badge.innerHTML='';
    var im=document.createElement('img'); im.className='badge rart'; im.alt=''; im.width=320; im.height=320;
    im.onerror=function(){ im.remove(); }; im.src='/badges/'+id+'.webp'; badge.appendChild(im);
  };

  // The same race the live week runs (ffRaceInto); the recorder asks when it is over, and only asks.
  var startRace=function(p){
    race=ffRaceInto(p, function(){ race=null; if(show) show.done(); });
  };

  // Behind the manager's gate, exactly like a live week — see ffWheel above. What is behind
  // it here is still a toy: the pick is local, nothing is sent, nothing is saved.
  window.ffWheel.spin(function(m){
    if(busy) return;
    var pick=pool[Math.floor(Math.random()*pool.length)];
    if(race){ race.stop(); race=null; }
    head.textContent='Demo spin · if the wheel had landed here';
    back.hidden=false;
    reveal.classList.add('pending');
    ui.small(false);
    if(!still) stage.scrollIntoView({behavior:'smooth',block:'nearest'});

    busy=true;
    ui.spin(pick.id, function(){
      // Settled. The answer only changes once the wheel has stopped on it.
      eye.textContent='If it had landed here · week '+week+' really drew '+realName;
      name.textContent=pick.name; setBadge(pick.id); blurb.textContent=pick.blurb;
      val.textContent=''; team.textContent=''; crew.innerHTML=''; document.getElementById('wtie').textContent=''; plain();
      reveal.classList.remove('pending');
      ui.small(true);
      busy=false; m.again();
      setTimeout(function(){
        startRace(pick);
        if(!still) reveal.scrollIntoView({behavior:'smooth',block:'nearest'});
      }, still?0:450);
    });
    show=m;
  });

  back.addEventListener('click', function(){
    if(busy) return;
    if(race){ race.stop(); race=null; }
    ui.small(false); ui.restOn(realPick);
    head.textContent=real.head; eye.textContent=real.eye; name.textContent=real.name;
    badge.innerHTML=real.badge; blurb.textContent=real.blurb;
    val.innerHTML=real.valHTML; team.textContent=real.team; crew.innerHTML=real.crew; plain();
    document.getElementById('wtie').textContent=real.tie;
    boardBox.innerHTML=real.board;
    reveal.classList.remove('pending');
    back.hidden=true;
  });
})();
(function(){
  // ---- the live wheel -----------------------------------------------------------------
  // The page ships with every prize that scored and what each would pay, but not which one
  // won: that is sealed server-side. This does three things and nothing else — seal the week
  // if it is not sealed yet, show the answer if somebody already spun, and let the one admin
  // account spin if nobody has.
  var band=document.getElementById('wheel');
  if(!band) return;

  var season=band.dataset.season, week=band.dataset.week;
  var pool=JSON.parse(document.getElementById('reeldata').textContent);
  var byId={}; pool.forEach(function(p){ byId[p.id]=p; });

  var state=document.getElementById('wstate'),
      winner=document.getElementById('wwinner'), blurb=document.getElementById('wblurb'),
      rhead=document.getElementById('wrhead'), wname=document.getElementById('wname'),
      wbadge=document.getElementById('wbadge'), weye=document.getElementById('weye'),
      commit=document.getElementById('wcommit'), proof=document.getElementById('wproof'),
      head=document.getElementById('wheelhead');
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ROW=${ROW}, sealedDoc=null;

  var api=function(body){
    return fetch('/api/wheel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(b){ if(!r.ok) throw new Error(b.message||b.error||r.status); return b; }); });
  };

  var say=function(el,msg){ el.textContent=msg||''; };

  // The wheel itself. The demo weeks have had one all along and the live week had only a strip
  // of text, which made the button a liar: it said "Spin the wheel" beside no wheel. Same
  // canvas, same friction model, same badge art — the only difference on a live week is that
  // the wedge it must stop on comes from the server instead of being picked here.
  var ui=window.ffWheelUI.create({
    canvas:document.getElementById('wheelcv'), pool:pool, hub:['WEEK', week],
    badge:function(id){ return '/badges/'+id+'.webp'; },
    max:760                              // fill the column it now has to itself
  });

  // A spin lands, the prize is named, and the standings for it race into place exactly the
  // way the demo weeks rehearse it \u2014 the payout column reads the leader as the week replays
  // and stamps gold when Monday night is in; the callback fires when that is over. A locked
  // week is a record, not an event: it rests on the prize and settles the board at once.
  var race=null;
  var land=function(pick,animate,then){
    var p=byId[pick];
    if(!p){ say(state,'The wheel drew a prize this page does not have a board for.'); return; }
    if(race){ race.stop(); race=null; }
    var wval=winner.querySelector('.wval'), wteam=winner.querySelector('.wteam'), crew=document.getElementById('wcrew');

    // The prize, named the way the demo names it: badge art, an eyebrow, the name, what it
    // measures. None of it is on the page until the wheel lands, because none of it is known.
    var reveal=function(){
      head.textContent='This week\u2019s prize';
      weye.textContent='Week '+week+(locked()?' paid':' pays');
      wname.textContent=p.name; blurb.textContent=p.blurb;
      wbadge.innerHTML='';
      var im=document.createElement('img'); im.className='badge rart'; im.alt=''; im.width=320; im.height=320;
      im.onerror=function(){ im.remove(); }; im.src='/badges/'+p.id+'.webp'; wbadge.appendChild(im);
      rhead.hidden=false; winner.hidden=false;
    };
    var settle=function(){
      wval.textContent=p.num;
      if(p.unit){ var u=document.createElement('span'); u.className='u'; u.textContent=p.unit; wval.appendChild(u); }
      wteam.textContent=p.team;
      ffCrewPaint(crew,p.crew,p.unit); ffTieLine(p);
    };

    if(animate && !still){
      // The wheel is the event now. It lands where the seal says because the launch speed was
      // solved for that wedge, not because anything steers it on the way round.
      var done=false;
      var fin=function(){
        if(done) return; done=true; ui.small(true); reveal();
        // The payout column empties for the race to fill \u2014 a beat to read the name first.
        wval.textContent=''; wteam.textContent=''; crew.innerHTML=''; document.getElementById('wtie').textContent='';
        setTimeout(function(){ race=ffRaceInto(p, function(){ race=null; if(then) then(); }); }, 450);
      };
      ui.small(false);
      ui.spin(pick, fin);
      setTimeout(fin, 9000);          // a backstop; the spin settles well before this
    } else { ui.restOn(pick); reveal(); settle(); ffPaintBoard(p); if(then) then(); }
    return p;
  };

  // The week is over when the next one kicks off. Until then every visit gets its own spin:
  // the answer has been fixed, and published as a hash, since the first page load of the week,
  // so one person watching it turn costs the other eleven nothing. After that the page is a
  // record rather than an event, and settles into what the week paid.
  // An absolute instant (build.js stamps the next week's kickoff with its Eastern offset), so
  // the week closes at the same moment for everyone rather than at each reader's own midnight.
  var lock=band.dataset.lock||'', lockAt=lock?Date.parse(lock):NaN;
  var locked=function(){ return !isNaN(lockAt) && Date.now() >= lockAt; };

  var revealed=function(doc){
    sealedDoc=doc;
    // Nothing is hidden here. The wheel is never "spent": the answer is fixed, so turning it
    // again costs nothing and lands in the same place, and anyone can come back and do that
    // all week — or after. What changes on reveal is the writing, not the controls.
    var when=doc.revealedAt?new Date(doc.revealedAt):null;
    say(state, when ? (locked()?'Week closed. First opened ':'First opened ')
      +when.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'.' : '');
    state.className='wstate done';
    commit.textContent=doc.commit.slice(0,16);
    // The hash was made over the pick's id AS SEALED; after a rename the server hands that back
    // as sealedPick, and the proof line has to name what was actually hashed.
    proof.textContent='Sealed '+doc.pool.length+' prizes deep before anyone saw it. sha256("'+(doc.sealedPick||doc.pick)+'|'+doc.nonce.slice(0,8)+'…") matches the hash published with this page.';
  };

  // Sealing is idempotent and safe to fire on every load: the first one of the week draws a
  // prize, every one after it is handed back the prize already drawn.
  api({action:'seal',season:season,week:week,pool:pool.map(function(p){ return p.id; })})
    .then(function(doc){
      sealedDoc=doc;
      commit.textContent=doc.commit.slice(0,16);
      // An open week keeps its answer behind the spin, so every visit gets the moment. Once the
      // next week has kicked off the page is a record and shows the answer straight away —
      // but the wheel stays, and turning it lands on that same answer.
      if(locked()){
        if(doc.revealed){ land(doc.pick,false); revealed(doc); }
        else { say(state,'Week closed without a spin. Spin it now — the prize was sealed on the first visit.'); state.className='wstate done'; }
      }
    })
    .catch(function(e){
      // Only a request that actually failed means the wheel is offline. A TypeError thrown by
      // the code above lands here too, and calling that "offline" is how a dangling reference
      // once disguised itself as a server problem for a whole page load.
      var offline=(e && e.name==='TypeError' && /fetch|network/i.test(e.message||'')) || /^(5\d\d|Failed|NetworkError|load failed)/i.test(e.message||'');
      if(offline){
        say(state,'The wheel cannot be reached. Reload in a moment — nothing is lost, the prize is already sealed.');
      } else {
        say(state,'The wheel hit an error ('+e.message+'). Reload to try again.');
        if(window.console) console.error('ffWheel seal failed:',e);
      }
      // The panel STAYS. Hiding it left no way to retry but a reload the page never suggested.
    });

  // The gate, the camera and the recorder all live in ffWheel above; this hands it the one
  // thing only a live week knows how to do — open the sealed prize — and lets it drive the
  // canvas and the take around that.
  window.ffWheel.spin(function(m){
    api({action:'reveal',season:season,week:week})
      .then(function(doc){
        // The show is over when the race is; the recorder only asks then, it never stops.
        land(doc.pick,true,function(){ m.done(); });
        setTimeout(function(){ revealed(doc); m.again(); }, still?0:3400);   // and it can go again
      })
      .catch(function(e){ m.fail(e.message); });
  });
})();
(function(){
  var find=document.getElementById('find');
  find.addEventListener('input',function(){
    var q=find.value.trim().toLowerCase();
    document.querySelectorAll('.award').forEach(function(a){
      a.classList.toggle('hide', q && a.dataset.name.indexOf(q)===-1);
    });
    document.querySelectorAll('.phase').forEach(function(t){
      t.classList.toggle('hide', !t.querySelector('.award:not(.hide)'));
    });
  });
  document.addEventListener('click',function(e){
    var more=e.target.closest('.more');
    if(more){
      var rest=more.closest('.award').querySelector('.rest');
      var open=!rest.hidden; rest.hidden=open;
      more.setAttribute('aria-expanded',String(!open));
      more.textContent=open?('All '+more.dataset.count):'Less';
      return;
    }
    var copy=e.target.closest('.copy');
    if(copy){
      var text=copy.dataset.line;
      var done=function(){
        var old=copy.textContent; copy.textContent='Copied';
        setTimeout(function(){copy.textContent=old;},1400);
      };
      try{ navigator.clipboard.writeText(text).then(done,function(){fallback(text,done);}); }
      catch(err){ fallback(text,done); }
    }
  });
  function fallback(text,done){
    var ta=document.createElement('textarea');
    ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{document.execCommand('copy'); done();}catch(e){}
    document.body.removeChild(ta);
  }
})();
</script>
</body>
</html>`;
}
