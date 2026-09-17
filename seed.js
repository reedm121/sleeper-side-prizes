#!/usr/bin/env node
// One-time migration: lift the verdicts and notes out of a shortlist page that stored them
// inside itself (the artifact build) and put them in the shared store.
//
//   node seed.js shortlist.html                    into .data/ for local dev
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node seed.js shortlist.html    into production
//
// Refuses to run if the store already holds marks, so it can never flatten live decisions.

import { readFile } from 'node:fs/promises';
import { load, save, backend } from './lib/store.js';

const src = process.argv[2] || 'shortlist.html';
const html = await readFile(src, 'utf8');
const m = html.match(/<script id="state" type="application\/json">([^<]*)<\/script>/);
if (!m) {
  console.error(`No embedded state block in ${src} — nothing to migrate.`);
  process.exit(1);
}
const incoming = JSON.parse(m[1]);

const current = await load();
const marks = Object.keys(current.state.verdicts || {}).length + Object.keys(current.state.notes || {}).length;
if (marks) {
  console.error(`The ${backend} store already holds ${marks} mark(s) at version ${current.version}. Refusing to overwrite.`);
  process.exit(1);
}

const result = await save(current.version, incoming);
if (!result.ok) { console.error('Lost a race with another writer; nothing written.'); process.exit(1); }
console.error(`Seeded ${backend} store -> version ${result.version}: ` +
  `${Object.keys(incoming.verdicts || {}).length} verdicts, ${Object.keys(incoming.notes || {}).length} notes`);
