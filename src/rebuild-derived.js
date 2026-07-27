'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./rank');
const N = require('./normalize');
const { findBaselineRecords, safeRawName } = require('./validate-snapshot');

function rebuildDerived(snapshot, baselineRecords = null, rawLoader = null) {
  if (snapshot?.meta?.source !== 'live') {
    throw new Error('Only a live candidate snapshot can be rebuilt.');
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

  snapshot.leaderboards = R.buildLeaderboards(snapshot.records, ['instagram'], {
    now: capturedAt,
    windowDays: R.WINDOW_DAYS,
  });

  const baselineDays = snapshot.meta.growthBaselineDays;
  if (snapshot.meta.growthBaselineAt) {
    if (!Array.isArray(baselineRecords)) {
      throw new Error('The declared growth baseline is not available.');
    }
    snapshot.trend = R.growth(baselineRecords, snapshot.records, { baselineDays });
  } else {
    snapshot.trend = [];
  }
  snapshot.meta.trendAvailable = snapshot.trend.length > 0;
  snapshot.meta.validation = {
    status: 'pending',
    validatorVersion: 1,
    snapshotCapturedAt: snapshot.meta.capturedAt,
  };
  return snapshot;
}

function main() {
  const root = path.join(__dirname, '..');
  const latestPath = path.join(root, 'data', 'latest.json');
  const snapshot = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const baselineRecords = findBaselineRecords(root, snapshot.meta?.growthBaselineAt);
  rebuildDerived(snapshot, baselineRecords, record => {
    const rawPath = path.join(root, 'data', 'raw', safeRawName(record));
    return fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : null;
  });

  const pendingPath = path.join(root, 'data', '.latest.rebuilt.json');
  fs.writeFileSync(pendingPath, JSON.stringify(snapshot, null, 2));
  fs.renameSync(pendingPath, latestPath);
  const historyDir = path.join(root, 'data', 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  const stamp = snapshot.meta.capturedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(historyDir, `${stamp}.json`),
    JSON.stringify({ meta: snapshot.meta, records: snapshot.records }, null, 2),
  );
  console.log('[rebuild] derived analytics rebuilt from normalized live records; validation remains pending');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { rebuildDerived };
