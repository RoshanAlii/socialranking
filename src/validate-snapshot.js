'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./rank');
const N = require('./normalize');
const C = require('./content');
const S = require('./series');
const { buildPeople, SHORT_WINDOW_DAYS } = require('./ingest');

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

  /*
   * A replay is a recomputation of stored provider captures. It relaxes exactly
   * two things — the source label and the age gate — and nothing else: the raw
   * payloads are still re-normalized, every leaderboard, content figure, coaching
   * line and trend point is still recomputed, and the roster still has to match.
   * What it cannot claim is freshness, so it is stamped as a replay and the
   * dashboard publishes it under its own capture date rather than as "now".
   */
  const replay = opts.replay === true;
  if (replay) {
    if (meta.source !== 'captured') errors.push(`a replay must declare source "captured", got ${meta.source || 'missing'}`);
    if (!meta.replay?.of || meta.replay.of !== meta.capturedAt) {
      errors.push('a replay must record the capture timestamp it replays');
    }
  } else if (meta.source !== 'live') {
    errors.push(`source must be live, got ${meta.source || 'missing'}`);
  }
  if (!/apify/i.test(meta.provider || '')) errors.push('provider must identify Apify');
  if (meta.measurementVersion !== 3) errors.push(`measurementVersion must be 3, got ${meta.measurementVersion || 'missing'}`);
  const activePlatforms = registry?.activePlatforms || ['instagram'];
  const offPlatforms = platforms.filter(platform => !activePlatforms.includes(platform));
  if (!platforms.length) errors.push('no platform is recorded on the snapshot');
  if (offPlatforms.length) errors.push(`${offPlatforms.join(', ')} is published but not in registry.activePlatforms`);
  if (!platforms.includes('instagram')) errors.push('instagram must be present in every published snapshot');
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
  else if (!replay && maxAgeHours !== null && now - captured > maxAgeHours * 3600000) {
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

  const trendRows = Array.isArray(snapshot.trend) ? snapshot.trend : [];
  let recomputed = null;
  if (Number.isFinite(captured)) {
    recomputed = R.buildLeaderboards(records, ['instagram'], {
      now: captured,
      windowDays: R.WINDOW_DAYS,
      growth: trendRows,
      alternateWindows: [SHORT_WINDOW_DAYS],
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

  /*
   * Everything derived gets recomputed, not spot-checked. Content
   * intelligence and per-person coaching are published claims about people;
   * they earn the same treatment as the leaderboards they sit beside.
   */
  if (Number.isFinite(captured) && recomputed) {
    const expectedContent = C.buildContentIntelligence(records, 'instagram', { now: captured, days: R.WINDOW_DAYS });
    if (!sameJson(snapshot.content, expectedContent)) {
      errors.push('stored content intelligence does not match a full recomputation');
    }
    const expectedPeople = buildPeople(records, registry, expectedContent, recomputed, captured, R.WINDOW_DAYS);
    if (!sameJson(snapshot.people, expectedPeople)) {
      errors.push('stored per-person cadence, goals or next actions do not match a full recomputation');
    }
    for (const person of Array.isArray(snapshot.people) ? snapshot.people : []) {
      const record = records.find(item => item.handle === person.handle && item.platform === 'instagram');
      if (!record) errors.push(`${person.name}: per-person block has no matching record`);
      else if (record.optOut === true) errors.push(`${person.name}: opted out but still carries a per-person block`);
    }
  }

  const optedOut = records.filter(record => record.optOut === true);
  for (const record of optedOut) {
    if (record.resolved === true) errors.push(`${record.name}: opted out but a profile was still fetched`);
    if ((record.recentPosts || []).length) errors.push(`${record.name}: opted out but posts were stored`);
    const inBoards = JSON.stringify(snapshot.leaderboards || {}).includes(`"${record.name}"`);
    if (inBoards) errors.push(`${record.name}: opted out but still appears in a leaderboard`);
  }
  if (meta.optedOut !== undefined && meta.optedOut !== optedOut.length) {
    errors.push(`meta.optedOut is ${meta.optedOut} but ${optedOut.length} records are marked opted out`);
  }

  /*
   * Brand accounts are pulled for context and must never be able to leak into a
   * ranking, so the check is structural rather than statistical.
   */
  for (const account of Array.isArray(snapshot.brand) ? snapshot.brand : []) {
    if (account.isBrand !== true) errors.push(`brand account ${account.handle || 'unknown'} is not flagged as a brand record`);
    if (records.some(record => record.handle === account.handle)) {
      errors.push(`brand account ${account.handle} also appears in the ranked record set`);
    }
  }

  if (opts.series) {
    const expected = S.snapshotPoints(records, meta.capturedAt, R.WINDOW_DAYS, ['instagram'], rosterVersion);
    for (const [key, point] of Object.entries(expected.profiles)) {
      const stored = (opts.series.profiles?.[key]?.points || []).find(item => item.at === meta.capturedAt);
      if (!stored) {
        errors.push(`${point.name}: this capture is missing from the trend series`);
        continue;
      }
      // `validated` is written by this validator after the check passes, so it
      // is the one field a recomputation cannot be expected to reproduce.
      const { name, role, platform, ...values } = point;
      const { validated: _stampedFlag, ...storedValues } = stored;
      const { validated: _expectedFlag, ...expectedValues } = values;
      if (!sameJson(storedValues, expectedValues)) errors.push(`${point.name}: trend series point does not match a recomputation`);
      if (stored.rosterVersion !== rosterVersion) {
        errors.push(`${point.name}: trend series point is stamped for roster ${stored.rosterVersion || 'unknown'}`);
      }
    }
  }

  const trend = trendRows;
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
  const seriesPath = path.join(root, 'data', 'series.json');
  const series = fs.existsSync(seriesPath) ? JSON.parse(fs.readFileSync(seriesPath, 'utf8')) : null;
  const replay = process.argv.includes('--replay');
  const summary = validateSnapshot(snapshot, registry, {
    baselineRecords,
    series,
    replay,
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
      // A replay passed every check a live pull passes except freshness, and
      // the dashboard has to know which one it is to label the board correctly.
      mode: replay ? 'replay' : 'live',
    };
    const pendingPath = path.join(root, 'data', '.latest.validated.json');
    fs.writeFileSync(pendingPath, JSON.stringify(snapshot, null, 2));
    fs.renameSync(pendingPath, latestPath);

    if (series) {
      const { series: stampedSeries, stamped } = S.stampValidated(series, snapshot.meta.capturedAt);
      const seriesPending = path.join(root, 'data', '.series.validated.json');
      fs.writeFileSync(seriesPending, JSON.stringify(stampedSeries));
      fs.renameSync(seriesPending, seriesPath);
      console.log(`[validate] stamped ${stamped} trend point(s) for ${snapshot.meta.capturedAt}`);
    }
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
