#!/usr/bin/env node
// The whole Tuesday in one command, for a league that runs this on one laptop instead of
// deploying it:
//
//   npm run week          build the newest finished week, assemble the site, serve it, open it
//
// Headshots are fetched if Python with Pillow is around and skipped quietly if not. The wheel
// works exactly as it does on a deployed site — sealed on first load, opened on the spin — against
// a file in .data/ instead of Redis, so the spin is recorded and the season's no-repeat rule holds
// from week to week on this machine.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { LEAGUE, CONFIG_PATH } from './lib/league.js';

const here = new URL('.', import.meta.url).pathname;
const node = (script, args = []) => execFileSync(process.execPath, [join(here, script), ...args], { stdio: 'inherit' });

if (!LEAGUE.league) {
  console.error(`No league in ${CONFIG_PATH}. Run \`npm start\` first.`);
  process.exit(1);
}

// Which week, from build.js itself so this never disagrees with it.
const which = execFileSync(process.execPath, [join(here, 'build.js'), '--latest', '--which'], { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
if (!which) { console.error('No week has finished yet this season.'); process.exit(0); }
const [season, week] = which.split(' ');
console.error(`Week ${week} of ${season} is final. Building it for ${LEAGUE.name}...`);

const hasPillow = spawnSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0;
if (hasPillow) {
  const r = spawnSync('python3', [join(here, 'assets.py'), '--season', season, '--week', week, '--league', LEAGUE.league], { stdio: 'inherit' });
  if (r.status !== 0) console.error('  (headshots failed; building without them)');
} else {
  console.error('  (no Python/Pillow, so no headshots — pip install Pillow to get faces on the page)');
}

node('build.js', ['--season', season, '--week', week]);
node('site.js');

const port = Number(process.env.PORT) || 3000;
const page = `http://localhost:${port}/weeks/${season}-week-${week}`;
console.error(`\n  Serving http://localhost:${port} — Ctrl-C stops it. Opening ${page}`);
console.error('  Spin there. Tick "Record it" first to get a video of the spin to drop in the group chat.\n');
const server = spawn(process.execPath, [join(here, 'dev.js')], { stdio: 'inherit' });
if (process.stdout.isTTY) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  setTimeout(() => { try { spawn(opener, [page], { stdio: 'ignore', shell: process.platform === 'win32' }).on('error', () => {}); } catch {} }, 1200);
}
await new Promise((resolve) => server.on('exit', resolve));
