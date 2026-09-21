// Prize ids that were renamed, and what they are called now.
//
// An id is a permanent key: it names the prize in the season ledger (wheel.json), in the sealed
// draws the server stores, in the badge files and in every saved shortlist vote. The first
// seventeen prizes were written with a `house_` prefix and some inside jokes for ids, and were
// renamed on 2026-09-21. Anything that reads an id from storage passes it through `canonical()`
// so a ledger, a sealed draw or a vote written before the rename still resolves.
//
// Add a row here whenever an id changes. Never delete one: the history it translates is
// permanent too.

export const LEGACY_IDS = {
  house_high: 'high_score',
  house_crash: 'swing_down',
  house_notdead: 'swing_up',
  house_unlucky: 'best_loser',
  house_closest: 'closest',
  house_forrest: 'rush_yd',
  house_unsung: 'bench_best',
  house_bombs_wr: 'rec_lng_wr',
  house_bigleg: 'fgm_lng',
  house_turnover: 'def_takeaways',
  house_sack: 'def_sack',
  house_stickies: 'rec',
  house_6god: 'td_rush_rec',
  house_bombs_qb: 'pass_lng',
  house_onmyback: 'share_of_team',
  house_forrest_cops: 'rush_lng_rb',
  house_drive: 'drive_lng',
  // Badge-art variant, not a prize; renamed with the prize it belongs to.
  house_forrest_shrimp: 'rush_yd_shrimp',
};

/** The current id for any id ever used. Unknown ids pass through untouched. */
export const canonical = (id) => LEGACY_IDS[id] ?? id;

/** The same, over the keys of an object (verdicts, notes, winners). Later keys win on collision. */
export function canonicalKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[canonical(k)] = v;
  return out;
}

/** A season ledger (wheel.json) with every id in it brought current. Returns a new object. */
export function canonicalLedger(ledger) {
  if (!ledger) return ledger;
  const draws = (ledger.draws || []).map((d) => ({ ...d, pick: canonical(d.pick), pool: (d.pool || []).map(canonical) }));
  const pending = (ledger.pending || []).map((p) => ({ ...p, pool: (p.pool || []).map(canonical), winners: canonicalKeys(p.winners) }));
  return { ...ledger, draws, ...(ledger.pending ? { pending } : {}) };
}

/** A sealed-draw document from the store, ids brought current. */
export const canonicalWheelDoc = (doc) => (doc ? { ...doc, pick: canonical(doc.pick), pool: (doc.pool || []).map(canonical) } : doc);
