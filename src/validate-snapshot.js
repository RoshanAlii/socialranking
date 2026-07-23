'use strict';

/*
 * Post-ingestion validation for live snapshots.
 *
 * Unit and regression tests run before the provider call. This validator runs
 * after it and checks invariants that should remain true even while followers,
 * posts, and engagement naturally change from week to week.
 */

const fs = require('fs');
const path = require('path');

function safeRawName(record) {
  return `${record.platform}_${record.handle}`.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
}

function validateSnapshot(snapshot, registry, opts = {}) {
  const errors = [];
  const meta = snapshot && snapshot.meta ? snapshot.meta : {};
  const records = Array.isArray(snapshot && snapshot.records) ? snapshot.records : [];
  const platforms = Array.isArray(meta.platforms) ? meta.platforms : [];
  const now = opts.now === undefined ? Date.now() : new Date(opts.now).getTime();
  const maxAgeHours = opts.maxAgeHours === undefined ? 6 : opts.maxAgeHours;
  const minCoverage = opts.minCoverage === undefined ? 0.8 : opts.minCoverage;
  const rawExists = opts.rawExists || (() => true);

  if (meta.source !== 'live') errors.push(`source must be live, got ${meta.source || 'missing'}`);
  if (!/apify/i.test(meta.provider || '')) errors.push('provider must identify Apify');
  if (!platforms.length) errors.push('meta.platforms must contain at least one platform');

  const captured = new Date(meta.capturedAt).getTime();
  if (!Number.isFinite(captured)) {
    errors.push('meta.capturedAt is missing or invalid');
  } else if (maxAgeHours !== null && Math.abs(now - captured) > maxAgeHours * 3600000) {
    errors.push(`snapshot is not fresh (captured ${meta.capturedAt})`);
  }

  const relevant = (registry.employees || []).filter(e => e.dashboardRelevant !== false);
  const expectedRecords = relevant.length * platforms.length;
  if (records.length !== expectedRecords) {
    errors.push(`expected ${expectedRecords} records, found ${records.length}`);
  }
  if (meta.relevantCount !== relevant.length) {
    errors.push(`meta.relevantCount should be ${relevant.length}, got ${meta.relevantCount}`);
  }

  const expectedPulls = relevant.reduce((sum, employee) => sum + platforms.filter(
    platform => employee.confirmed === true && employee.handles && employee.handles[platform]
  ).length, 0);
  const resolved = records.filter(r => r && r.resolved === true && r.isPrivate === false);
  const requiredResolved = Math.max(1, Math.floor(expectedPulls * minCoverage));
  if (resolved.length < requiredResolved) {
    errors.push(`resolved ${resolved.length} of ${expectedPulls} connected profiles; minimum is ${requiredResolved}`);
  }
  if (meta.resolvedProfiles !== resolved.length) {
    errors.push(`meta.resolvedProfiles is ${meta.resolvedProfiles}, but records contain ${resolved.length}`);
  }

  // Overall coverage can hide a dead low-volume platform: 34 healthy Instagram
  // profiles would otherwise let a completely failed TikTok pull pass. A green
  // workflow must prove that every connected platform returned something.
  for (const platform of platforms) {
    const expectedForPlatform = relevant.filter(employee =>
      employee.confirmed === true && employee.handles && employee.handles[platform]).length;
    const resolvedForPlatform = resolved.filter(record => record.platform === platform).length;
    if (expectedForPlatform > 0 && resolvedForPlatform === 0) {
      errors.push(`${platform}: resolved 0 of ${expectedForPlatform} connected profiles`);
    }
  }

  for (const record of records.filter(r => r && r.resolved === true)) {
    if (!record.handle) errors.push(`${record.name}/${record.platform}: resolved record has no handle`);
    if (record.followers !== null &&
        (!Number.isFinite(record.followers) || record.followers < 0)) {
      errors.push(`${record.name}/${record.platform}: invalid follower count`);
    }
    if (!Array.isArray(record.recentPosts)) {
      errors.push(`${record.name}/${record.platform}: recentPosts must be an array`);
    }
    if (!rawExists(record, safeRawName(record))) {
      errors.push(`${record.name}/${record.platform}: captured raw payload is missing`);
    }
  }

  for (const platform of platforms) {
    if (!snapshot.leaderboards || !snapshot.leaderboards[platform]) {
      errors.push(`leaderboard missing for ${platform}`);
    }
  }

  if (errors.length) {
    throw new Error('Live snapshot validation failed:\n - ' + errors.join('\n - '));
  }
  return { resolved: resolved.length, expectedPulls, records: records.length, capturedAt: meta.capturedAt };
}

function main() {
  const root = path.join(__dirname, '..');
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data', 'latest.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'handles.json'), 'utf8'));
  const summary = validateSnapshot(snapshot, registry, {
    rawExists: (_record, filename) => fs.existsSync(path.join(root, 'data', 'raw', filename)),
  });
  console.log(`[validate] live snapshot accepted: ${summary.resolved}/${summary.expectedPulls} connected profiles resolved, ${summary.records} records checked`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { validateSnapshot, safeRawName };
