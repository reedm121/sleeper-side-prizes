#!/usr/bin/env node
// Bring league.json in line with what the manager set on /admin, or the other way round.
//
//   node config.js pull            store -> league.json   (run before every build; see below)
//   node config.js push            league.json -> store   (after editing the file by hand)
//   node config.js show            print what a build would use
//
// Where `pull` looks, in order:
//   1. the store, when this process can reach it — Redis on a Vercel build, the .data/ file on
//      a laptop;
//   2. the deployed site's own /api/config, when league.json (or SITE_URL) names the site — this
//      is how the Tuesday workflow on GitHub Actions, which has no database credentials, still
//      builds with the manager's latest choices;
//   3. nothing: league.json stands as it is.
//
// A store nobody has saved to leaves league.json alone. A failure to reach anything is a
// warning, never a failed build — the file on disk is always a good enough answer.

import { readFile, writeFile } from 'node:fs/promises';
import { CONFIG_PATH } from './lib/league.js';

const cmd = process.argv[2] || 'pull';
const flag = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };

async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return {}; } }
const strip = ({ updatedAt, ...rest }) => rest;

async function fromStore() {
  const st = await import('./lib/store.js');
  if (st.backend === 'none') return null;
  const doc = await st.loadConfig();
  return st.hasConfig(doc) ? { config: strip(doc.state), via: `the ${st.backend} store` } : { config: null, via: `the ${st.backend} store (nothing saved)` };
}

async function fromSite(url) {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/config`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.stored ? { config: body.config, via: url } : { config: null, via: `${url} (nothing saved)` };
}

if (cmd === 'pull') {
  const file = await readJson(CONFIG_PATH);
  let got = null;
  try { got = await fromStore(); } catch (e) { console.error(`  could not read the store (${e.message})`); }
  const site = flag('from') || process.env.SITE_URL || file.site;
  if ((!got || !got.config) && site) {
    try { got = await fromSite(site); } catch (e) { console.error(`  could not reach ${site} (${e.message})`); }
  }
  if (!got) { console.error(`  config: nothing to pull from; ${CONFIG_PATH} stands.`); process.exit(0); }
  if (!got.config) { console.error(`  config: ${got.via}; ${CONFIG_PATH} stands.`); process.exit(0); }
  const merged = { ...file, ...got.config };
  const before = JSON.stringify(file), after = JSON.stringify(merged);
  if (before === after) { console.error(`  config: ${CONFIG_PATH} already matches ${got.via}.`); process.exit(0); }
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n');
  console.error(`  config: wrote ${CONFIG_PATH} from ${got.via} (${(merged.house || []).length} house, ${merged.prizes === 'all' ? 'all' : (merged.prizes || []).length} prizes).`);
} else if (cmd === 'push') {
  const st = await import('./lib/store.js');
  if (st.backend === 'none') { console.error('no store to push to'); process.exit(1); }
  const { clean } = await import('./api/config.js');
  const file = await readJson(CONFIG_PATH);
  const cur = await st.loadConfig();
  const r = await st.saveConfig(cur.version, clean(file));
  if (!r.ok) { console.error('lost a race with another writer; nothing written'); process.exit(1); }
  console.error(`  config: pushed ${CONFIG_PATH} to the ${st.backend} store -> version ${r.version}`);
} else if (cmd === 'show') {
  const { LEAGUE } = await import('./lib/league.js');
  console.log(JSON.stringify(LEAGUE, null, 2));
} else {
  console.error('usage: node config.js pull | push | show [--from https://your-site]');
  process.exit(2);
}
