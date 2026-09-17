// The badge art, as every page that names a prize needs it.
//
// One prize, one badge, everywhere the prize is shown: the week page's hero and its thirty
// award cards, the prize board, the prize list, the shortlist. A manager should be able to
// recognise Sack Attack by its fist before he has read the word.
//
// The art lives in output/badges/ — catalog.json names the file for each award id, and
// badges.py writes the 320px WebP the pages actually load. site.js copies that set to
// public/badges/, so a page asks for `/badges/<award id>.webp` and nothing else.
//
// FILES, not data URIs. The faces in assets.py are inlined because a headshot belongs to one
// week's page and the Artifact host blocked every other origin; neither is true here. The
// same thirty badges appear on every page of the site, so one cached request each beats
// 600KB welded into all of them, and a week page is the same bytes whoever is looking.
//
// Awards with no art render without it. The shortlist carries all 47 awards while only the
// 30 the league plays for were ever drawn, and a prize invented next Tuesday will show up
// here before anyone has illustrated it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOG_DIR = join(HERE, 'output', 'badges');

// The built set site.js copies into public/, and the URL prefix pages ask for.
export const WEB_DIR = join(CATALOG_DIR, 'web');
export const URL_BASE = '/badges';

let catalog = [];
try {
  catalog = JSON.parse(readFileSync(join(CATALOG_DIR, 'catalog.json'), 'utf8'));
} catch {
  catalog = []; // No catalogue: every page below renders exactly as it did before badges.
}

// Alternate art for an award that already has some — the shrimp Run Forrest Run. Keyed by
// its own id so a page can offer it deliberately; never what `badge()` returns by default,
// because the default has to be stable across a season of pages.
export const VARIANTS = new Map(catalog.filter((b) => b.variant).map((b) => [b.id, b]));

const BY_ID = new Map(catalog.filter((b) => !b.variant).map((b) => [b.id, b]));

/** The badge for an award id, or null if nobody has drawn one yet. */
export const badge = (id) => BY_ID.get(id) || null;

/** Where the page loads it from. Null for an award with no art, so callers can skip it. */
export const badgeSrc = (id) => (BY_ID.has(id) ? `${URL_BASE}/${id}.webp` : null);

export const hasBadge = (id) => BY_ID.has(id);

/**
 * The <img> itself.
 *
 * Decorative by default: the prize's name is always right next to it, so a screen reader
 * that also read the badge would say everything twice. Pass `alt` only where the badge
 * stands alone — a trophy case next to a team name, say, where nothing else names it.
 *
 * `eager` is for the badges the page cannot afford to have arrive late — the reel is going to
 * scroll past all seventeen of its rows within three seconds of a click, so those load up
 * front, at low priority behind the one it lands on. Everything else waits: a week page
 * carries thirty more below the fold and none of them are why anyone opened it.
 */
export function badgeImg(id, { cls = '', eager = false, alt = '', priority = '' } = {}) {
  const src = badgeSrc(id);
  if (!src) return '';
  const a = alt ? ` alt="${alt.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}"` : ' alt=""';
  return `<img class="badge${cls ? ' ' + cls : ''}" src="${src}"${a} width="320" height="320"`
    + `${eager ? '' : ' loading="lazy"'} decoding="async"${priority ? ` fetchpriority="${priority}"` : ''}>`;
}

/**
 * The styling all four pages share, so a badge is the same object wherever it turns up.
 *
 * Square, transparent, never cropped. The size is set by whatever holds it, through
 * --badge-size, because a prize row wants 116px of it and an award card wants 88.
 *
 * A missing file is the case worth designing for: these pages are also opened straight off
 * disk, where /badges resolves to nothing. `alt=""` on a broken image collapses to nothing
 * in every browser — no torn-page icon, no gap — as long as nothing reserves space for it,
 * which is why the box is sized on the image itself rather than on a wrapper.
 */
export const badgeCSS = () => `
.badge{
  width:var(--badge-size,104px); height:var(--badge-size,104px);
  flex:0 0 auto; object-fit:contain; display:block;
  /* Flat art on a dark ground: a little lift keeps it from sitting flush on the panel. */
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.45));
}
@media (prefers-reduced-motion:no-preference){
  .badge{transition:transform .18s ease}
}
`;
