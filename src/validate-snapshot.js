'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./rank');
const N = require('./normalize');

const VALIDATOR_VERSION = 2;

function safeRawName(record) {
  return `${record.platform}_${record.handle}`.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
}
function closeEnough(a, b, epsilon = 1e-12) {
  return typeof a === 'number' && Number.isFinite(a) &&
    typeof b === 'number' && Number.isFinite(b) &&
    Math.abs(a - b) <= epsilon;
}
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function recordKey(record) { return `${record.name}::${record.platform}::${record.handle || ''}`; }

function validateSnapshot(snapshot, registry, opts = {}) {
  const errors = [];
  const meta = snapshot?.meta || {};
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const platforms = Array.isArray(meta.platforms) ? meta.platforms : [];
  const now = opts.now === undefined ? Date.now() : new Date(opts.now).getTime();
  const maxAgeHours = opts.maxAgeHours === undefined ? 6 : opts.maxAgeHours;
  const minResolvedCoverage = opts.minResolvedCoverage === undefined ? 0.8 : opts.minResolvedCoverage;
  const minCompleteCoverage = opts.minCompleteCoverage === undefined ? 0.8 : opts.minCompleteCoverage;
  const rawExists = opts.rawExists || (() => true);
  const rawLoader = opts.rawLoader || null;
  const rosterVersion = registry?.rosterVersion || null;

  if (meta.source !== 'live') errors.push(`source must be live, got ${meta.source || 'missing'}`);
  if (!/apify/i.test(meta.provider || '')) errors.push('provider must identify Apify');
  if (meta.measurementVersion !== 3) errors.push(`measurementVersion must be 3, got ${meta.measurementVersion || 'missing'}`);
  if (platforms.length !== 1 || platforms[0] !== 'instagram') errors.push('only instagram may be active');
  if (meta.cadenceFormula !== 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30') {
    errors.push('cadence formula metadata is missing or changed');
  }
  if (meta.validation && meta.validation.snapshotCapturedAt !== meta.capturedAt) {
    errors.push('validation marker does not belong to this snapshot');
  }
  if (rosterVersion && meta.rosterVersion !== rosterVersion) {
    errors.push(`snapshot roster version ${meta.rosterVersion || 'missing'} does not match registry ${rosterVersion}`);
  }
  if (rosterVersion && meta.validation && meta.validation.rosterVersion !== rosterVersion) {
    errors.push('validation marker does not belong to the current roster');
  }

  const captured = new Date(meta.capturedAt).getTime();
  if (!Number.isFinite(captured)) errors.push('meta.capturedAt is missing or invalid');
  else if (captured > now + 5 * 60 * 1000) errors.push(`snapshot is future-dated (${meta.capturedAt})`);
  else if (maxAgeHours !== null && now - captured > maxAgeHours * 3600000) {
    errors.push(`snapshot is not fresh (captured ${meta.capturedAt})`);
  }

  const relevant = (registry.employees || []).filter(employee => employee.dashboardRelevant !== false);
  const employeeNames = relevant.map(employee => employee.name);
  if (new Set(employeeNames).size !== employeeNames.length) errors.push('relevant roster contains duplicate names');
  if (records.length !== relevant.length) errors.push(`expected ${relevant.length} records, found ${records.length}`);
  if (meta.relevantCount !== relevant.length) errors.push(`meta.relevantCount should be ${relevant.length}, got ${meta.relevantCount}`);

  const expectedByName = new Map(relevant.map(employee => [employee.name, employee]));
  const seenRecords = new Set();
  for (const record of records) {
    const key = recordKey(record);
    if (seenRecords.has(key)) errors.push(`${record.name}: duplicate snapshot record`);
    seenRecords.add(key);

    const employee = expectedByName.get(record.name);
    if (!employee) {
      errors.push(`${record.name}: record is not in the relevant roster`);
      continue;
    }
    if (record.platform !== 'instagram') errors.push(`${record.name}: unexpected platform ${record.platform}`);
    const expectedHandle = employee.handles?.instagram || null;
    if ((record.handle || null) !== expectedHandle) {
      errors.push(`${record.name}: record handle ${record.handle || 'missing'} does not match registry ${expectedHandle || 'missing'}`);
    }
    if (record.resolved === true && (employee.confirmed !== true || !expectedHandle)) {
      errors.push(`${record.name}: unconfirmed or missing handle produced a resolved record`);
    }
  }
  for (const employee of relevant) {
    if (!records.some(record => record.name === employee.name && record.platform === 'instagram')) {
      errors.push(`${employee.name}: expected Instagram record is missing`);
    }
  }

  const expectedPulls = relevant.filter(employee => employee.confirmed === true && employee.handles?.instagram).length;
  const resolved = records.filter(record => record?.resolved === true && record.isPrivate === false);
  const requiredResolved = expectedPulls ? Math.ceil(expectedPulls * minResolvedCoverage) : 0;
  if (resolved.length < requiredResolved) {
    errors.push(`resolved ${resolved.length} of ${expectedPulls} confirmed profiles; minimum is ${requiredResolved}`);
  }
  if (meta.resolvedProfiles !== resolved.length) {
    errors.push(`meta.resolvedProfiles is ${meta.resolvedProfiles}, but records contain ${resolved.length}`);
  }

  for (const record of records.filter(item => item?.resolved === true)) {
    if (!record.handle) errors.push(`${record.name}: resolved record has no handle`);
    if (record.followers !== null && (!Number.isFinite(record.followers) || record.followers < 0)) {
      errors.push(`${record.name}: invalid follower count`);
    }
    if (!Array.isArray(record.recentPosts)) errors.push(`${record.name}: recentPosts must be an array`);
    if (!rawExists(record, safeRawName(record))) errors.push(`${record.name}: captured raw payload is missing`);

    const posts = Array.isArray(record.recentPosts) ? record.recentPosts : [];
    const keys = posts.map(N.postKey);
    if (new Set(keys).size !== keys.length) errors.push(`${record.name}: duplicate normalized posts remain`);
    if (!record.isPrivate && record.fetchMeta?.postsQuerySucceeded === true) {
      if (!(record.fetchMeta?.postsLookbackDays >= R.WINDOW_DAYS)) {
        errors.push(`${record.name}: successful posts query has a lookback shorter than 30 days`);
      }
      if (record.fetchMeta?.postsOwnershipComplete !== true) {
        errors.push(`${record.name}: successful posts query does not prove ownership`);
      }
    }
    for (const post of posts) {
      if (post.ownerUsername !== N.canonicalHandle(record.handle)) {
        errors.push(`${record.name}: post ${post.id || post.url || 'unknown'} has a mismatched or missing owner`);
      }
      if (post.postedAt !== null && !Number.isFinite(new Date(post.postedAt).getTime())) {
        errors.push(`${record.name}: post ${post.id || post.url || 'unknown'} has an invalid timestamp`);
      }
      for (const metric of ['likes', 'comments']) {
        if (post[metric] !== null && (!Number.isFinite(post[metric]) || post[metric] < 0)) {
          errors.push(`${record.name}: post ${post.id || post.url || 'unknown'} has invalid ${metric}`);
        }
      }
    }

    if (rawLoader) {
      try {
        const raw = rawLoader(record, safeRawName(record));
        const normalized = N.normalizeRecord({
          name: record.name,
          role: record.role,
          platform: record.platform,
          handle: record.handle,
        }, raw, meta.capturedAt);
        if (!sameJson(normalized, record)) errors.push(`${record.name}: normalized record does not match its raw capture`);
      } catch (error) {
        errors.push(`${record.name}: raw capture could not be normalized (${error.message || error})`);
      }
    }
  }

  let recomputed = null;
  if (Number.isFinite(captured)) {
    recomputed = R.buildLeaderboards(records, ['instagram'], {
      now: captured,
      windowDays: R.WINDOW_DAYS,
    });
    if (!sameJson(snapshot.leaderboards, recomputed)) {
      errors.push('stored leaderboards do not match a full recomputation');
    }
  }

  const complete = recomputed?.instagram?.coverage?.completeWindowProfiles || 0;
  const requiredComplete = resolved.length ? Math.ceil(resolved.length * minCompleteCoverage) : 0;
  if (complete < requiredComplete) {
    errors.push(`complete 30-day windows ${complete} of ${resolved.length} resolved profiles; minimum is ${requiredComplete}`);
  }

  const trend = Array.isArray(snapshot.trend) ? snapshot.trend : [];
  if (meta.trendAvailable !== (trend.length > 0)) errors.push('meta.trendAvailable does not match stored trend rows');
  if (trend.length) {
    const baselineDays = meta.growthBaselineDays;
    if (!(baselineDays >= 5 && baselineDays <= 9)) errors.push(`growth baseline must be 5–9 days old, got ${baselineDays}`);
    if (!meta.growthBaselineAt || !Number.isFinite(new Date(meta.growthBaselineAt).getTime())) {
      errors.push('growth baseline timestamp is missing or invalid');
    }
    if (!Array.isArray(opts.baselineRecords)) {
      errors.push('growth baseline records were not supplied to the validator');
    } else {
      const expectedTrend = R.growth(opts.baselineRecords, records, { baselineDays });
      if (!sameJson(trend, expectedTrend)) errors.push('stored growth rows do not match the declared baseline');
    }
  }

  if (errors.length) throw new Error('Live snapshot validation failed:\n - ' + errors.join('\n - '));
  return {
    resolved: resolved.length,
    expectedPulls,
    records: records.length,
    completeWindows: complete,
    cadenceRowsCrosschecked: snapshot.leaderboards?.instagram?.postingFrequency?.length || 0,
    capturedAt: meta.capturedAt,
  };
}

function findBaselineRecords(root, baselineAt) {
  if (!baselineAt) return null;
  const historyDir = path.join(root, 'data', 'history');
  if (!fs.existsSync(historyDir)) return null;
  for (const filename of fs.readdirSync(historyDir).filter(file => file.endsWith('.json'))) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(historyDir, filename), 'utf8'));
      if (payload?.meta?.capturedAt === baselineAt && Array.isArray(payload.records)) return payload.records;
    } catch (_) {
      // Invalid history files are ignored; the missing baseline is reported later.
    }
  }
  return null;
}

function main() {
  const root = path.join(__dirname, '..');
  const latestPath = path.join(root, 'data', 'latest.json');
  const snapshot = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'handles.json'), 'utf8'));
  const baselineRecords = findBaselineRecords(root, snapshot.meta?.growthBaselineAt);
  const summary = validateSnapshot(snapshot, registry, {
    baselineRecords,
    rawExists: (_record, filename) => fs.existsSync(path.join(root, 'data', 'raw', filename)),
    rawLoader: (_record, filename) => JSON.parse(fs.readFileSync(path.join(root, 'data', 'raw', filename), 'utf8')),
  });

  if (process.argv.includes('--stamp')) {
    snapshot.meta.validation = {
      status: 'passed',
      validatorVersion: VALIDATOR_VERSION,
      snapshotCapturedAt: snapshot.meta.capturedAt,
      rosterVersion: registry.rosterVersion,
      validatedAt: new Date().toISOString(),
    };
    const pendingPath = path.join(root, 'data', '.latest.validated.json');
    fs.writeFileSync(pendingPath, JSON.stringify(snapshot, null, 2));
    fs.renameSync(pendingPath, latestPath);
  }

  console.log(`[validate] accepted: ${summary.resolved}/${summary.expectedPulls} profiles resolved; ${summary.completeWindows} complete windows; all published answers cross-checked`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = {
  validateSnapshot,
  safeRawName,
  closeEnough,
  sameJson,
  findBaselineRecords,
  VALIDATOR_VERSION,
};
