'use strict';

// Public output contains derived daily counts only. Raw Story content, media,
// contact details and deduplication IDs are never published to GitHub Pages.
const DAY = 86400000;
const canonical = s => String(s || '').trim().replace(/^@/, '').toLowerCase();
const dubaiDate = time => new Date(Date.parse(time) + 4 * 3600000).toISOString().slice(0, 10);

function targets(snapshot) {
  return [...new Map([...(snapshot.records || []), ...(snapshot.brand || [])]
    .filter(r => r.platform === 'instagram' && r.resolved === true && r.isPrivate === false && r.handle)
    .map(r => [canonical(r.handle), { handle: canonical(r.handle), name: r.name, company: r.role === 'Company account' }])).values()];
}

function normalize(row, wanted, observedAt) {
  const handle = canonical(row?.username);
  const at = Date.parse(row?.taken_at), end = Date.parse(row?.expiring_at), now = Date.parse(observedAt);
  if (!wanted.has(handle) || row.is_private !== false || typeof row.story_pk !== 'string' || !/^\d+$/.test(row.story_pk) ||
      !Number.isFinite(at) || !Number.isFinite(end) || at > now || at < now - 2 * DAY || end <= at ||
      !['image', 'video'].includes(row.media_type)) return null;
  return { key: `${handle}:${row.story_pk}`, handle, at: new Date(at).toISOString(), type: row.media_type };
}

function applyCapture(prior, { rows, output, run, accounts, observedAt, maxResults }) {
  const state = structuredClone(prior);
  state.seen ||= {}; state.daily ||= {}; state.accounts ||= {}; state.checks ||= [];
  const wanted = new Set(accounts.map(a => a.handle));
  const valid = [], rejected = [];
  for (const row of rows) { const item = normalize(row, wanted, observedAt); (item ? valid : rejected).push(item || row); }
  const failed = new Set((output?.failed_targets || []).map(canonical));
  const controlsValid = output?.outcome === 'ok' && Array.isArray(output.failed_targets) &&
    Number(output.delivered) === rows.length && Number(output.granted_targets) >= accounts.length;
  const limited = rows.length >= maxResults || (Number.isFinite(Number(output?.granted_results)) && rows.length >= Number(output.granted_results));
  const healthy = run.status === 'SUCCEEDED' && controlsValid && !limited && !rejected.length;
  // Keep observed evidence even when some targets failed. Never turn a failed or
  // capped empty response into a confirmed zero for any account.
  if (run.status === 'SUCCEEDED' && output?.outcome === 'ok') {
    for (const story of valid) {
      if (state.seen[story.key]) continue;
      state.seen[story.key] = story.at;
      const day = dubaiDate(story.at), key = `${story.handle}|${day}`;
      const bucket = state.daily[key] ||= { handle: story.handle, date: day, image: 0, video: 0 };
      bucket[story.type]++;
    }
  }
  for (const account of accounts) {
    const old = state.accounts[account.handle] || {};
    const ok = healthy && !failed.has(account.handle);
    state.accounts[account.handle] = { ...old, ...account,
      monitoringSince: old.monitoringSince || observedAt,
      lastAttemptAt: observedAt, lastSuccessAt: ok ? observedAt : old.lastSuccessAt || null,
      status: ok ? 'checked' : 'incomplete',
      reason: failed.has(account.handle) ? 'Account could not be collected' : limited ? 'Result limit reached' : !controlsValid ? 'Provider coverage was not confirmed' : rejected.length ? 'Some Story records failed validation' : run.status !== 'SUCCEEDED' ? 'Collection failed' : null,
      activeAtCheck: ok ? new Set(valid.filter(s => s.handle === account.handle && Date.parse(rows.find(r => `${canonical(r.username)}:${r.story_pk}` === s.key)?.expiring_at) > Date.parse(observedAt)).map(s => s.key)).size : old.activeAtCheck ?? null
    };
  }
  state.checks.push({ at: observedAt, runId: run.id, requested: accounts.length,
    checked: accounts.filter(a => healthy && !failed.has(a.handle)).length,
    failed: accounts.filter(a => !healthy || failed.has(a.handle)).map(a => a.handle),
    returned: rows.length, rejected: rejected.length, limited });
  state.seen = Object.fromEntries(Object.entries(state.seen).filter(([, at]) => Date.parse(at) >= Date.parse(observedAt) - 30 * DAY));
  state.checks = state.checks.filter(c => Date.parse(c.at) >= Date.parse(observedAt) - 32 * DAY);
  state.updatedAt = observedAt;
  return state;
}

function publicSummary(state, config, accounts, now) {
  const wanted = new Set(accounts.map(a => a.handle));
  return { version: 1, provider: 'Apify', actor: config.actor, updatedAt: state.updatedAt || null,
    generatedAt: now, enabled: config.enabled, intervalHours: config.intervalHours,
    timezone: 'Asia/Dubai', scope: 'Observed public Story publishing activity; not Instagram Insights.',
    limitations: 'Captured Stories are a minimum, not a complete archive. Deleted or expired Stories can be missed. Story views, reach and profile visits are not available. Feed metrics and rankings exclude Stories.',
    accounts: accounts.map(a => ({ ...a, ...(state.accounts?.[a.handle] || { status: 'not_started', monitoringSince: null, lastSuccessAt: null }) })),
    daily: Object.values(state.daily || {}).filter(r => wanted.has(r.handle)).sort((a,b) => a.date.localeCompare(b.date) || a.handle.localeCompare(b.handle)),
    checks: state.checks || [], budget: { month: dubaiDate(now).slice(0,7), limitUsd: config.monthlyBudgetUsd,
      reservedOrSpentUsd: state.spend?.[dubaiDate(now).slice(0,7)] || 0, lastStatus: state.lastStatus || null },
    runs: state.runs || [] };
}

module.exports = { targets, normalize, applyCapture, publicSummary, dubaiDate };
