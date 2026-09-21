// Renamed ids. Everything written under an old id — a config, a ledger, a sealed draw, a vote —
// has to keep resolving, and a sealed draw has to keep verifying against the hash made over the
// id it was sealed with.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LEGACY_IDS, canonical, canonicalKeys, canonicalLedger } from '../lib/ids.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// A config and a store written with old ids, in a throwaway directory.
const dir = await mkdtemp(join(tmpdir(), 'ids-'));
await writeFile(join(dir, 'league.json'), JSON.stringify({
  league: '1', name: 'Old Ids FC', house: ['house_high', 'house_closest'], prizes: ['house_forrest', 'rec_yd', 'house_forrest'],
  custom: { house_forrest: { name: 'Run Forrest Run' } },
}));
process.env.LEAGUE_CONFIG = join(dir, 'league.json');
process.env.WHEEL_DIR = join(dir, 'wheel');
process.env.SHORTLIST_FILE = join(dir, 'shortlist.json');
delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.FANTASY_KV_REST_API_URL;

const { GLOSSARY, HOUSE, PLAYED, AWARDS } = await import('../awards.js');
const store = await import('../lib/store.js');

// 1. The map itself: every old id points at a real current id, and no current id is an old one.
const ids = new Set(GLOSSARY.map((a) => a.id));
const targets = Object.entries(LEGACY_IDS).filter(([o]) => o !== 'house_forrest_shrimp');
ok('every legacy id maps to a glossary id', targets.every(([, c]) => ids.has(c)), targets.filter(([, c]) => !ids.has(c)).map(([o, c]) => `${o}->${c}`).join(','));
ok('no glossary id is itself a legacy id', GLOSSARY.every((a) => !(a.id in LEGACY_IDS)));
ok('canonical passes unknown ids through', canonical('rec_yd') === 'rec_yd' && canonical('made_up') === 'made_up');
ok('canonicalKeys renames keys', JSON.stringify(canonicalKeys({ house_high: 1, rec_yd: 2 })) === JSON.stringify({ high_score: 1, rec_yd: 2 }));

// 2. A league.json written before the rename.
ok('house from an old config resolves', JSON.stringify(HOUSE.map((a) => a.id)) === JSON.stringify(['high_score', 'closest']));
ok('prizes from an old config resolve and dedupe', PLAYED.map((a) => a.id).sort().join(',') === ['high_score', 'closest', 'rush_yd', 'rec_yd'].sort().join(','));
ok('custom names keyed by an old id apply', AWARDS.find((a) => a.id === 'rush_yd').name === 'Run Forrest Run');

// 3. A ledger written before the rename.
const led = canonicalLedger({ draws: [{ season: 2025, week: 1, pick: 'house_onmyback', pool: ['house_high', 'rec_yd'] }],
  pending: [{ season: 2026, week: 1, pool: ['house_drive'], winners: { house_drive: { teams: ['A'] }, rec_yd: { teams: ['B'] } } }] });
ok('ledger picks and pools come current', led.draws[0].pick === 'share_of_team' && led.draws[0].pool.join() === 'high_score,rec_yd' && led.pending[0].pool[0] === 'drive_lng');
ok('ledger winner keys come current', Object.keys(led.pending[0].winners).join() === 'drive_lng,rec_yd');

// 4. A sealed draw stored under an old id: reads current, reveals without rewriting the stored id,
//    and the commitment still verifies over the id it was sealed with.
await mkdir(process.env.WHEEL_DIR, { recursive: true });
const nonce = 'abcd';
const rawDoc = { season: 2026, week: 1, pool: ['house_onmyback', 'rec_yd', 'house_high'], pick: 'house_onmyback', nonce,
  commit: createHash('sha256').update(`house_onmyback|${nonce}`).digest('hex'), createdAt: 'x', revealed: false, revealedAt: null };
await writeFile(join(process.env.WHEEL_DIR, '2026-1.json'), JSON.stringify(rawDoc));
const before = store.sealed(await store.readWheel(2026, 1));
ok('a sealed old-id draw reads with a current pool and no pick', before.revealed === false && before.pool.join() === 'share_of_team,rec_yd,high_score' && !('pick' in before));
const after = store.sealed(await store.revealWheel(2026, 1));
ok('revealed pick is the current id', after.pick === 'share_of_team');
ok('sealedPick names what was hashed', after.sealedPick === 'house_onmyback');
ok('commitment verifies over sealedPick', createHash('sha256').update(`${after.sealedPick}|${after.nonce}`).digest('hex') === after.commit);
const { readFile } = await import('node:fs/promises');
ok('the stored document keeps its original id', JSON.parse(await readFile(join(process.env.WHEEL_DIR, '2026-1.json'), 'utf8')).pick === 'house_onmyback');
// A draw sealed under a current id has no sealedPick to speak of.
await store.sealWheel({ season: 2026, week: 2, pool: ['rec_yd', 'pass_yd'] });
const fresh = store.sealed(await store.revealWheel(2026, 2));
ok('a current-id draw carries no sealedPick', !('sealedPick' in fresh) && ['rec_yd', 'pass_yd'].includes(fresh.pick));
// The no-repeat rule sees the old draw under its current id.
const taken = store.sealed(await store.sealWheel({ season: 2026, week: 3, pool: ['share_of_team', 'fgm_lng'] }));
ok('no-repeat rule recognises a renamed prize as taken', (await store.revealWheel(2026, 3)).pick === 'fgm_lng', taken.pool.join());

// 5. Votes saved under old ids.
await store.save(0, { verdicts: { house_high: 'yes', rec_yd: 'no' }, notes: { house_forrest: 'shrimp?' }, note: '' });
const votes = await store.load();
ok('vote keys come current', JSON.stringify(votes.state.verdicts) === JSON.stringify({ high_score: 'yes', rec_yd: 'no' }) && 'rush_yd' in votes.state.notes);

await rm(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
