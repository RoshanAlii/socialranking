'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./rank');
const { postKey } = require('./normalize');

function safeRawName(record) {
  return `${record.platform}_${record.handle}`.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
}
function closeEnough(a, b, epsilon = 1e-12) { return Math.abs(a - b) <= epsilon; }

function validateSnapshot(snapshot, registry, opts = {}) {
  const errors = [];
  const meta = snapshot?.meta || {};
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const platforms = Array.isArray(meta.platforms) ? meta.platforms : [];
  const now = opts.now === undefined ? Date.now() : new Date(opts.now).getTime();
  const maxAgeHours = opts.maxAgeHours === undefined ? 6 : opts.maxAgeHours;
  const minCoverage = opts.minCoverage === undefined ? 0.8 : opts.minCoverage;
  const rawExists = opts.rawExists || (() => true);

  if (meta.source !== 'live') errors.push(`source must be live, got ${meta.source || 'missing'}`);
  if (!/apify/i.test(meta.provider || '')) errors.push('provider must identify Apify');
  if (meta.measurementVersion !== 3) errors.push(`measurementVersion must be 3, got ${meta.measurementVersion || 'missing'}`);
  if (platforms.length !== 1 || platforms[0] !== 'instagram') errors.push('only instagram may be active');
  if (meta.cadenceFormula !== 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30') {
    errors.push('cadence formula metadata is missing or changed');
  }

  const captured = new Date(meta.capturedAt).getTime();
  if (!Number.isFinite(captured)) errors.push('meta.capturedAt is missing or invalid');
  else if (maxAgeHours !== null && Math.abs(now - captured) > maxAgeHours * 3600000) errors.push(`snapshot is not fresh (captured ${meta.capturedAt})`);

  const relevant = (registry.employees || []).filter(employee => employee.dashboardRelevant !== false);
  const expectedRecords = relevant.length;
  if (records.length !== expectedRecords) errors.push(`expected ${expectedRecords} records, found ${records.length}`);
  if (meta.relevantCount !== relevant.length) errors.push(`meta.relevantCount should be ${relevant.length}, got ${meta.relevantCount}`);

  const expectedPulls = relevant.filter(employee => employee.confirmed === true && employee.handles?.instagram).length;
  const resolved = records.filter(record => record?.resolved === true && record.isPrivate === false);
  const requiredResolved = Math.max(1, Math.floor(expectedPulls * minCoverage));
  if (resolved.length < requiredResolved) errors.push(`resolved ${resolved.length} of ${expectedPulls} connected profiles; minimum is ${requiredResolved}`);
  if (meta.resolvedProfiles !== resolved.length) errors.push(`meta.resolvedProfiles is ${meta.resolvedProfiles}, but records contain ${resolved.length}`);

  for (const record of records.filter(item => item?.resolved === true)) {
    if (!record.handle) errors.push(`${record.name}: resolved record has no handle`);
    if (record.followers !== null && (!Number.isFinite(record.followers) || record.followers < 0)) errors.push(`${record.name}: invalid follower count`);
    if (!Array.isArray(record.recentPosts)) errors.push(`${record.name}: recentPosts must be an array`);
    if (!rawExists(record, safeRawName(record))) errors.push(`${record.name}: captured raw payload is missing`);

    const keys = (record.recentPosts || []).map(postKey);
    if (new Set(keys).size !== keys.length) errors.push(`${record.name}: duplicate normalized posts remain`);
    if (!record.isPrivate && record.fetchMeta?.postsQuerySucceeded === true && !(record.fetchMeta?.postsLookbackDays >= R.WINDOW_DAYS)) {
      errors.push(`${record.name}: successful posts query has a lookback shorter than 30 days`);
    }
  }

  const board = snapshot.leaderboards?.instagram;
  if (!board) errors.push('Instagram leaderboard is missing');
  else if (Number.isFinite(captured)) {
    const recomputed = R.buildLeaderboards(records, ['instagram'], { now: captured, windowDays: R.WINDOW_DAYS }).instagram;
    const actualRows = board.postingFrequency || [];
    const expectedRows = recomputed.postingFrequency || [];
    const actualByHandle = new Map(actualRows.map(row => [row.handle, row]));
    if (actualRows.length !== expectedRows.length) errors.push(`cadence row count mismatch: stored ${actualRows.length}, recomputed ${expectedRows.length}`);

    for (const expected of expectedRows) {
      const actual = actualByHandle.get(expected.handle);
      if (!actual) { errors.push(`${expected.name}: cadence row missing`); continue; }
      const independent = expected.postsInWindow * 7 / R.WINDOW_DAYS;
      if (!closeEnough(expected.postsPerWeek, independent)) errors.push(`${expected.name}: internal formula mismatch`);
      if (!closeEnough(actual.postsPerWeek, independent)) errors.push(`${expected.name}: stored cadence ${actual.postsPerWeek} does not equal ${expected.postsInWindow} × 7 ÷ 30`);
      if (actual.postsInWindow !== expected.postsInWindow) errors.push(`${expected.name}: stored post count differs from recomputation`);
    }

    const storedAudit = board.coverage?.cadenceAudit || [];
    const recomputedAudit = recomputed.coverage?.cadenceAudit || [];
    if (storedAudit.length !== recomputedAudit.length) errors.push('cadence audit profile count mismatch');
    const expectedComplete = recomputedAudit.filter(row => row.complete).length;
    if (board.coverage?.completeWindowProfiles !== expectedComplete) errors.push('complete-window profile count mismatch');
  }

  if (errors.length) throw new Error('Live snapshot validation failed:\n - ' + errors.join('\n - '));
  return {
    resolved: resolved.length,
    expectedPulls,
    records: records.length,
    cadenceRowsCrosschecked: snapshot.leaderboards?.instagram?.postingFrequency?.length || 0,
    capturedAt: meta.capturedAt,
  };
}

function main() {
  const root = path.join(__dirname, '..');
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data', 'latest.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'handles.json'), 'utf8'));
  const summary = validateSnapshot(snapshot, registry, {
    rawExists: (_record, filename) => fs.existsSync(path.join(root, 'data', 'raw', filename)),
  });
  console.log(`[validate] accepted: ${summary.resolved}/${summary.expectedPulls} profiles resolved; ${summary.cadenceRowsCrosschecked} cadence rows independently cross-checked`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { validateSnapshot, safeRawName, closeEnough };
