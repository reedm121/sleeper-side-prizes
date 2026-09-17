// Pull merge() out of the built page and exercise the cases that matter.
import { readFile } from 'node:fs/promises';
const page = await readFile('public/shortlist.html', 'utf8');
const js = page.match(/<script id="appjs">([\s\S]*?)<\/script>/)[1];
const src = js.match(/function merge\(remote\)\{[\s\S]*?\n  \}/)[0];

let state, touched;
const merge = new Function('getState', 'getTouched', `
  ${src.replace(/\bstate\b/g, 'getState()').replace(/\btouched\b/g, 'getTouched()')}
  return merge;
`)(() => state, () => touched);

let pass = 0, fail = 0;
const norm = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? JSON.stringify(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
  : JSON.stringify(v);
const eq = (label, got, want) => {
  const ok = norm(got) === norm(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// 1. Someone else's independent mark survives.
state   = { verdicts: { rec_yd: 'yes' }, notes: {}, note: '' };
touched = { verdicts: { rec_yd: true }, notes: {}, note: false };
eq('remote mark I never touched is kept',
   merge({ verdicts: { pass_yd: 'no' }, notes: {}, note: '' }).verdicts,
   { pass_yd: 'no', rec_yd: 'yes' });

// 2. My change wins over theirs on the same award.
state   = { verdicts: { rec_yd: 'yes' }, notes: {}, note: '' };
touched = { verdicts: { rec_yd: true }, notes: {}, note: false };
eq('my mark beats theirs on the same id',
   merge({ verdicts: { rec_yd: 'no' }, notes: {}, note: '' }).verdicts,
   { rec_yd: 'yes' });

// 3. The case the touched-set exists for: I CLEARED a mark, they still have it.
state   = { verdicts: {}, notes: {}, note: '' };
touched = { verdicts: { rec_yd: true }, notes: {}, note: false };
eq('a mark I cleared is not resurrected',
   merge({ verdicts: { rec_yd: 'yes', pass_yd: 'no' }, notes: {}, note: '' }).verdicts,
   { pass_yd: 'no' });

// 4. Their mark on an id I never touched is NOT clobbered by my blank.
state   = { verdicts: {}, notes: {}, note: '' };
touched = { verdicts: {}, notes: {}, note: false };
eq('their mark survives when I touched nothing',
   merge({ verdicts: { rec_yd: 'yes' }, notes: {}, note: '' }).verdicts,
   { rec_yd: 'yes' });

// 5. Notes follow the same rules, including deletion.
state   = { verdicts: {}, notes: { td_lng: 'mine' }, note: '' };
touched = { verdicts: {}, notes: { td_lng: true, rush_att: true }, note: false };
eq('notes: mine wins, theirs kept, my deletion sticks',
   merge({ verdicts: {}, notes: { td_lng: 'theirs', rush_att: 'gone', scrimmage: 'keep' }, note: '' }).notes,
   { scrimmage: 'keep', td_lng: 'mine' });

// 6. The freeform box only overrides when I typed in it.
state   = { verdicts: {}, notes: {}, note: 'mine' };
touched = { verdicts: {}, notes: {}, note: false };
eq('freeform note left alone when untouched',
   merge({ verdicts: {}, notes: {}, note: 'theirs' }).note, 'theirs');

touched = { verdicts: {}, notes: {}, note: true };
eq('freeform note wins when I typed in it',
   merge({ verdicts: {}, notes: {}, note: 'theirs' }).note, 'mine');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
