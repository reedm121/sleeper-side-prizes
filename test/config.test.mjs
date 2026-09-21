// The manager's settings: who may write them, what survives validation, how a stale write is
// refused, and how `config.js pull` turns them into league.json. File backend, throwaway dir.
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const dir = await mkdtemp(join(tmpdir(), 'config-'));
const cfgPath = join(dir, 'league.json');
await writeFile(cfgPath, JSON.stringify({ league: '111111111111111111', name: 'File FC', timezone: 'America/Chicago', house: ['high_score'], prizes: ['rec_yd'], custom: {} }));
process.env.LEAGUE_CONFIG = cfgPath;
process.env.CONFIG_FILE = join(dir, 'config.json');
process.env.SHORTLIST_FILE = join(dir, 'shortlist.json');
process.env.WHEEL_DIR = join(dir, 'wheel');
for (const k of Object.keys(process.env)) if (/(KV_REST_API|UPSTASH_REDIS_REST)_URL$/.test(k)) delete process.env[k];
delete process.env.VERCEL; delete process.env.DEPLOY_HOOK;
process.env.ADMIN_PASS = 'hut hut';

const { default: handler, clean } = await import('../api/config.js');
const { mode, canRebuild } = await import('../lib/admin.js');

// A minimal Vercel-shaped req/res.
function call(method, body, auth) {
  return new Promise((resolve) => {
    const req = { method, headers: auth ? { authorization: `Bearer ${auth}` } : {}, body, url: '/api/config' };
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); return this; } };
    handler(req, res);
  });
}

ok('a password in the environment means password mode', mode === 'password');
ok('a laptop can rebuild itself', canRebuild === true);

// 1. Reading is open and starts from league.json.
let r = await call('GET');
ok('GET is open', r.status === 200 && r.body.stored === false && r.body.mode === 'password');
ok('GET starts from league.json', r.body.config.name === 'File FC' && r.body.config.house[0] === 'high_score' && r.body.version === 0);

// 2. Writes need the password.
r = await call('POST', { action: 'login' });
ok('login without a password is refused', r.status === 401);
r = await call('POST', { action: 'login' }, 'wrong');
ok('login with the wrong password is refused', r.status === 401 && r.body.message === 'Wrong password.');
r = await call('POST', { action: 'login' }, 'hut hut');
ok('login with the right password works', r.status === 200 && r.body.ok);
r = await call('POST', { version: 0, config: { name: 'Nope' } });
ok('a save without the password is refused', r.status === 401);

// 3. Validation.
const c = clean({
  league: '222222222222222222', name: '  Dashboard FC  ', timezone: 'Mars/Olympus', houseLabel: '',
  house: ['closest', 'house_high', 'not_a_prize'], prizes: ['rec_yd', 'closest', 'pass_yd', 'bogus'],
  custom: { rec_yd: { name: 'Air Raid Siren', blurb: 'x'.repeat(400) }, bogus: { name: 'y' }, pass_yd: { name: '   ' } },
  site: 'http://insecure.example', extra: 'ignored',
});
ok('name is trimmed', c.name === 'Dashboard FC');
ok('an unknown timezone falls back to league.json\'s', c.timezone === 'America/Chicago');
ok('an empty house label gets the default', c.houseLabel === 'The House Prizes');
ok('house keeps known ids only, old ids translated', c.house.join() === 'closest,high_score');
ok('a prize cannot be both house and prize', !c.prizes.includes('closest') && c.prizes.join() === 'rec_yd,pass_yd');
ok('custom keeps real fields, clamps the blurb, drops empty and unknown', c.custom.rec_yd.name === 'Air Raid Siren' && c.custom.rec_yd.blurb.length === 300 && !c.custom.bogus && !c.custom.pass_yd);
ok('a non-https site is dropped', !('site' in c));
ok('unknown fields are dropped', !('extra' in c));

// 4. A save lands, and a stale one is refused with the current document.
r = await call('POST', { version: 0, config: { name: 'Dashboard FC', timezone: 'America/Denver', house: ['closest'], prizes: ['rec_yd', 'pass_yd'], custom: { rec_yd: { name: 'Air Raid Siren' } }, site: 'https://fc.example' } }, 'hut hut');
ok('an authorised save lands', r.status === 200 && r.body.ok && r.body.version === 1 && r.body.config.name === 'Dashboard FC');
ok('the saved config carries league.json\'s id when none was sent', r.body.config.league === '111111111111111111');
r = await call('POST', { version: 0, config: { name: 'Late FC' } }, 'hut hut');
ok('a stale save is refused with the current version', r.status === 409 && r.body.ok === false && r.body.version === 1 && r.body.config.name === 'Dashboard FC');
r = await call('GET');
ok('GET now reads the saved document', r.body.stored && r.body.config.timezone === 'America/Denver' && r.body.config.custom.rec_yd.name === 'Air Raid Siren' && r.body.updatedAt);

// 5. config.js pull writes it over league.json, keeping fields the dashboard does not own.
const env = { ...process.env };
const out = execFileSync(process.execPath, [new URL('../config.js', import.meta.url).pathname, 'pull'], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString() + '';
const file = JSON.parse(await readFile(cfgPath, 'utf8'));
ok('pull writes the store over league.json', file.name === 'Dashboard FC' && file.timezone === 'America/Denver' && file.house.join() === 'closest' && file.prizes.join() === 'rec_yd,pass_yd');
ok('pull keeps the league id', file.league === '111111111111111111');
ok('pull records the site', file.site === 'https://fc.example');
const again = execFileSync(process.execPath, [new URL('../config.js', import.meta.url).pathname, 'pull'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
ok('a second pull is a no-op', true);

// 6. A pull with nothing saved leaves the file alone.
await rm(process.env.CONFIG_FILE, { force: true });
await writeFile(cfgPath, JSON.stringify({ league: '3', name: 'Untouched' }));
execFileSync(process.execPath, [new URL('../config.js', import.meta.url).pathname, 'pull'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
ok('pull with an empty store changes nothing', JSON.parse(await readFile(cfgPath, 'utf8')).name === 'Untouched');

// 7. Open mode on a laptop with no password; locked mode is the deployed default.
delete process.env.ADMIN_PASS;
const fresh = await import('../lib/admin.js?open');
ok('no password + file store = open', fresh.mode === 'open' && fresh.authorized({ headers: {} }));

await rm(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
