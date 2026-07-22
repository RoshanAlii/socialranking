'use strict';

/*
 * resolver.js — turn a name into a CANDIDATE handle for a human to confirm.
 *
 * Name -> handle matching is exactly where a social dashboard silently pulls
 * a stranger's stats. So this module PROPOSES, it never confirms. Output is
 * always { verified: false }. A candidate only becomes usable after a person
 * sets confirmed:true (and the handle) in handles.json.
 *
 * The real search backend (a platform/search call) is pluggable via a
 * `searchFn(query) -> [{handle, name, followers, url}]`. If none is supplied,
 * resolver returns an empty candidate set rather than guessing.
 */

function slugCandidates(name, brand = 'kirpa') {
  const parts = name.toLowerCase().replace(/dr\.?/g, '').replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  const [first, last] = [parts[0], parts[parts.length - 1]];
  const set = new Set([
    `${first}.${last}`, `${first}_${last}`, `${first}${last}`,
    `${first}.${brand}`, `${first}_${brand}`, `${brand}.${first}`,
  ].filter(Boolean));
  return [...set];
}

// Score a search hit against the target name + brand. Higher = better match.
function scoreHit(hit, name, brand) {
  const hay = `${hit.name || ''} ${hit.handle || ''} ${hit.bio || ''}`.toLowerCase();
  const parts = name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let score = 0;
  for (const p of parts) if (hay.includes(p)) score += 1;
  if (hay.includes(brand)) score += 1.5;      // bio/handle mentions the company
  score += Math.min((hit.followers || 0) / 50000, 1); // slight nudge toward larger accounts
  return score;
}

/*
 * propose(name, platform, { searchFn, brand }) -> {
 *   name, platform, verified:false,
 *   candidates: [{ handle, confidence, url, followers, why }],
 *   guesses: [ ...string handle slugs to eyeball if search found nothing ]
 * }
 */
async function propose(name, platform, opts = {}) {
  const brand = opts.brand || 'kirpa';
  const out = { name, platform, verified: false, candidates: [], guesses: slugCandidates(name, brand) };
  if (typeof opts.searchFn === 'function') {
    let hits = [];
    try { hits = await opts.searchFn(`${name} ${brand} ${platform}`) || []; } catch (_) { hits = []; }
    out.candidates = hits
      .map(h => ({ handle: h.handle, url: h.url, followers: h.followers || null, score: scoreHit(h, name, brand) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(c => ({
        handle: c.handle, url: c.url, followers: c.followers,
        confidence: c.score >= 2.5 ? 'high' : c.score >= 1.5 ? 'medium' : 'low',
        why: 'name + brand match on public search; UNVERIFIED \u2014 confirm before use',
      }));
  }
  return out;
}

async function proposeAll(employees, platforms, opts = {}) {
  const results = [];
  for (const e of employees) {
    if (e.dashboardRelevant === false) continue;
    for (const pf of platforms) {
      if (pf === 'facebook') continue; // Pages-only; not name-resolvable
      results.push(await propose(e.name, pf, opts));
    }
  }
  return results;
}

module.exports = { propose, proposeAll, slugCandidates, scoreHit };
