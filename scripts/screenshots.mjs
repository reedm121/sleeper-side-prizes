#!/usr/bin/env node
// Photograph the site for the README. No dependencies: headless Chrome driven over its DevTools
// protocol, with Node's own WebSocket.
//
//   node scripts/screenshots.mjs --week 2025-week-3 [--out docs/img] [--chrome <path>]
//
// Expects public/ to be built, with the named week in it as a --demo --fake-names page (so its
// wheel spins on demand and no real team name is on screen), and built with NO assets.json in
// the folder: player headshots and club marks belong to Sleeper and the NFL, and a README is
// not the place for them. This refuses to run if the page carries any. Starts its own `node dev.js` on a
// spare port against a throwaway store, and stops it when done. Writes PNGs, plus numbered
// frames of the spin under <out>/frames for scripts/gif.py to turn into a GIF.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WEEK = arg('week');
if (!WEEK) { console.error('usage: node scripts/screenshots.mjs --week 2025-week-3'); process.exit(2); }
const OUT = arg('out', 'docs/img');
const CHROME = arg('chrome', ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync));
if (!CHROME) { console.error('No Chrome found; pass --chrome <path>.'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 3500 + Math.floor(Math.random() * 400), dbg = 9400 + Math.floor(Math.random() * 400);
const scratch = await mkdtemp(join(tmpdir(), 'shots-'));
await mkdir(join(OUT, 'frames'), { recursive: true });

const server = spawn(process.execPath, ['dev.js'], { stdio: 'ignore',
  env: { ...process.env, PORT: String(port), WHEEL_DIR: join(scratch, 'wheel'), CONFIG_FILE: join(scratch, 'config.json'), SHORTLIST_FILE: join(scratch, 'shortlist.json'), ADMIN_PASS: '' } });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', `--user-data-dir=${join(scratch, 'chrome')}`,
  '--hide-scrollbars', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
const stop = async () => { server.kill(); chrome.kill(); await sleep(300); await rm(scratch, { recursive: true, force: true }).catch(() => {}); };

try {
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/')).ok) break; } catch {} await sleep(250); }
  let target;
  for (let i = 0; i < 60; i++) { try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === 'page'); if (target) break; } catch {} await sleep(250); }
  if (!target) throw new Error('Chrome did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else if (d.method) events.push(d.method); };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

  await send('Page.enable'); await send('Runtime.enable');
  const view = (width, height, mobile = false, dpr = 2) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
  const go = async (path) => { events.length = 0; await send('Page.navigate', { url: base + path });
    for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
    await js('document.fonts.ready.then(() => true)'); await sleep(500); };
  const rect = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null; })()`);
  const shoot = async (name, clip, opts = {}) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: Boolean(opts.beyond) });
    await writeFile(join(OUT, name), Buffer.from(data, 'base64')); console.error(`  ${name}`);
  };

  // ---- 1. the spin: frames for the GIF, then the landed wheel with its winner ----------------
  // A viewport tall enough to hold the whole hero, so clips are in viewport coordinates and the
  // confetti canvas (position: fixed) lands where it should.
  await view(1100, 1500, false, 1);
  await go(`/weeks/${WEEK}`);
  if (await js(`/\.f-\d+\{background-image:url\(data:image/.test(document.documentElement.innerHTML)`)) {
    throw new Error('this page has headshots inlined — delete assets.json, rebuild the week, and run again');
  }
  const hero = await rect('section.wheel');
  const stage = { x: 0, y: Math.max(0, hero.y - 8), width: 1100, height: Math.min(1100, hero.height + 16) };
  await shoot('frames/000.png', stage);
  await js(`document.getElementById('wspin').click(), true`);
  const t0 = Date.now(); const stamps = [0]; let n = 1;
  // ~11 seconds covers the spin, the landing and the first stretch of the race.
  while (Date.now() - t0 < 11000) { await shoot(`frames/${String(n).padStart(3, '0')}.png`, stage); stamps.push(Date.now() - t0); n++; }
  await writeFile(join(OUT, 'frames', 'stamps.json'), JSON.stringify(stamps));
  // Let the race finish, then the still.
  for (let i = 0; i < 120; i++) { if (!(await js(`Boolean(document.querySelector('.raceboard.racing'))`))) break; await sleep(500); }
  await sleep(1200);
  await view(1100, 1500, false, 2);
  await sleep(300);
  const landed = await rect('section.wheel');
  await shoot('wheel.png', { x: 0, y: Math.max(0, landed.y - 8), width: 1100, height: Math.min(1480, landed.height + 16) });

  // ---- 2. the boards under it -----------------------------------------------------------------
  const phase = await rect('.phase');
  await shoot('boards.png', { x: 0, y: phase.y - 10, width: 1100, height: 900 }, { beyond: true });

  // ---- 3. the other pages ----------------------------------------------------------------------
  await view(1100, 1200, false, 2);
  await go('/prizes'); await shoot('prizes.png', { x: 0, y: 0, width: 1100, height: 1200 });
  await go('/awards'); await shoot('board.png', { x: 0, y: 0, width: 1100, height: 1200 });
  await go('/admin');  await sleep(800); await shoot('admin.png', { x: 0, y: 0, width: 1100, height: 1200 });

  // ---- 4. a phone. The prize list rather than the wheel: a spin scrolls the page under the
  //         camera, and a still of a moving page is a still of the wrong moment. ---------------
  await view(390, 1500, true, 2);
  await go('/prizes');
  await shoot('phone.png', { x: 0, y: 0, width: 390, height: 1500 });

  ws.close();
} finally { await stop(); }
