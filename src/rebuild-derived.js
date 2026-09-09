'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./rank');
const N = require('./normalize');
const C = require('./content');
const { buildPeople, loadWeeklyBaseline, SHORT_WINDOW_DAYS } = require('./ingest');
const { safeRawName } = require('./validate-snapshot');
const POST_CACHE = require('./post-cache');

function rebuildDerived(snapshot, baselineRecords = null, rawLoader = null, registry = null, historySnapshots = []) {
  if (!['live', 'captured'].includes(snapshot?.meta?.source)) {
    throw new Error('Only a live candidate or captured replay snapshot can be rebuilt.');
  }
  if (snapshot.meta.measurementVersion !== 3 || !Array.isArray(snapshot.records)) {
    throw new Error('Expected a measurementVersion 3 snapshot with normalized records.');
  }

  const capturedAt = new Date(snapshot.meta.capturedAt).getTime();
  if (!Number.isFinite(capturedAt)) throw new Error('Snapshot capture time is invalid.');

  if (typeof rawLoader === 'function') {
    snapshot.records = snapshot.records.map(record => {
      if (!record.handle || record.resolved !== true) return record;
      const raw = rawLoader(record);
      if (!raw) return record;
      return N.normalizeRecord({
        name: record.name,
        role: record.role,
        platform: record.platform,
        handle: record.handle,
      }, raw, snapshot.meta.capturedAt);
    });
  }

  if (historySnapshots.length) snapshot.records = POST_CACHE.recoverRecords(
    snapshot.records,
    historySnapshots,
    snapshot.meta.capturedAt,
  );

  const baselineDays = snapshot.meta.growthBaselineDays;
  if (snapshot.meta.growthBaselineAt) {
    if (!Array.isArray(baselineRecords)) {
      throw new Error('The declared growth baseline is not available.');
    }
    snapshot.trend = R.growth(baselineRecords, snapshot.records, { baselineDays });
  } else {
    snapshot.trend = [];
  }
  snapshot.leaderboards = R.buildLeaderboards(snapshot.records, ['instagram'], {
    now: capturedAt,
    windowDays: R.WINDOW_DAYS,
    growth: snapshot.trend,
    alternateWindows: [SHORT_WINDOW_DAYS],
  });
  snapshot.content = C.buildContentIntelligence(snapshot.records, 'instagram', {
    now: capturedAt,
    days: R.WINDOW_DAYS,
  });
  if (registry) {
    snapshot.people = buildPeople(
      snapshot.records, registry, snapshot.content, snapshot.leaderboards, capturedAt, R.WINDOW_DAYS,
    );
  }
  snapshot.meta.trendAvailable = snapshot.trend.length > 0;
  snapshot.meta.validation = {
    status: 'pending',
    validatorVersion: 2,
    snapshotCapturedAt: snapshot.meta.capturedAt,
    rosterVersion: registry?.rosterVersion || snapshot.meta.rosterVersion || null,
  };
  return snapshot;
}

function main() {
  const root = path.join(__dirname, '..');
  const rawArg = process.argv.indexOf('--raw-dir');
  if (rawArg >= 0 && !process.argv[rawArg + 1]) throw new Error('--raw-dir requires a path');
  const rawDir = rawArg >= 0 ? path.resolve(process.argv[rawArg + 1]) : path.join(root, 'data', 'raw');
  const latestPath = path.join(root, 'data', 'latest.json');
  const snapshot = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'handles.json'), 'utf8'));
  const baseline = loadWeeklyBaseline(path.join(root, 'data'), snapshot.meta.capturedAt, registry.rosterVersion);
  snapshot.meta.growthBaselineAt = baseline?.payload?.meta?.capturedAt || null;
  snapshot.meta.growthBaselineDays = baseline?.ageDays || null;
  snapshot.meta.growthWindowRule = 'Baseline must be 5–11 days old and use the same confirmed roster; nearest to 7 days is used and normalized to a weekly rate.';
  const baselineRecords = baseline?.payload?.records || null;
  const historical = POST_CACHE.loadHistorySnapshots(path.join(root, 'data', 'history'), {
    before: snapshot.meta.capturedAt,
    rosterVersion: registry.rosterVersion,
  });
  const rawLoader = snapshot.meta.source === 'live'
    ? record => {
        const rawPath = path.join(rawDir, safeRawName(record));
        return fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : null;
      }
    : null;
  rebuildDerived(snapshot, baselineRecords, rawLoader, registry, rawArg >= 0 ? [] : historical);

  const brandAccount = (registry.brandAccounts || []).find(account => (
    account.platform === 'instagram' && account.confirmed === true && account.handle
  ));
  if (brandAccount) {
    const safe = `brand_instagram_${brandAccount.handle}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const brandRawPath = path.join(rawDir, `${safe}.json`);
    if (fs.existsSync(brandRawPath)) {
      const brandRaw = JSON.parse(fs.readFileSync(brandRawPath, 'utf8'));
      const brandRecord = N.normalizeRecord({
        name: brandAccount.name,
        role: 'Company account',
        platform: 'instagram',
        handle: brandAccount.handle,
      }, brandRaw, snapshot.meta.capturedAt);
      snapshot.brand = [Object.assign(brandRecord, { isBrand: true, error: null })];
      snapshot.meta.brandAccounts = 1;
    }
  }

  // This is a calculation correction, never a new capture. Append a revision
  // instead of overwriting the historical evidence used by the old release.
  snapshot.meta.viewMetricVersion = 2;
  snapshot.meta.playbackBackfillNeeded = true;
  snapshot.meta.historyRevision = 'plays-v2';
  snapshot.meta.metricCorrection = {
    version: 2, correctedAt: new Date().toISOString(),
    reason: 'Use explicit video playback counters; retain legacy views separately. Capture time is unchanged.',
  };
  const pendingPath = path.join(root, 'data', '.latest.rebuilt.json');
  fs.writeFileSync(pendingPath, JSON.stringify(snapshot, null, 2));
  fs.renameSync(pendingPath, latestPath);
  const historyDir = path.join(root, 'data', 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  const stamp = snapshot.meta.capturedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(historyDir, `${stamp}-plays-v2.json`),
    JSON.stringify({ meta: snapshot.meta, records: snapshot.records }, null, 2) + '\n',
  );
  console.log('[rebuild] derived analytics rebuilt from normalized records and the nearest same-roster weekly baseline; validation remains pending');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { rebuildDerived };
