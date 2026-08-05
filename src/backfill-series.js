'use strict';

/*
 * Rebuild data/series.json from every stored snapshot.
 *
 * The trend file is derived state: it can always be thrown away and rebuilt
 * from the full history, which is what makes it safe to keep the heavy
 * snapshots out of the repository later. Points are recomputed here with the
 * same gated functions the live run uses, so a backfilled trend line and a
 * freshly captured one mean exactly the same thing.
 */

const fs = require('fs');
const path = require('path');
const { appendSnapshot, emptySeries, stampValidated } = require('./series');
const { WINDOW_DAYS } = require('./rank');

function arg(flag, defaultValue) {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : defaultValue;
}

function loadSnapshots(dir) {
  const historyDir = path.join(dir, 'history');
  const files = fs.existsSync(historyDir)
    ? fs.readdirSync(historyDir).filter(file => file.endsWith('.json'))
    : [];
  const snapshots = [];
  for (const file of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
      const capturedAt = payload?.meta?.capturedAt;
      if (!capturedAt || !Array.isArray(payload.records)) continue;
      if (!Number.isFinite(Date.parse(capturedAt))) continue;
      snapshots.push({
        file,
        capturedAt,
        records: payload.records,
        platforms: payload.meta.platforms || ['instagram'],
        rosterVersion: payload.meta.rosterVersion || null,
        validated: payload.meta.validation?.status === 'passed' && payload.meta.validation?.validatorVersion === 2,
      });
    } catch (error) {
      console.warn(`[backfill] skipped ${file}: ${error.message || error}`);
    }
  }
  const latestPath = path.join(dir, 'latest.json');
  if (fs.existsSync(latestPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      if (payload?.meta?.capturedAt && Array.isArray(payload.records)) {
        snapshots.push({
          file: 'latest.json',
          capturedAt: payload.meta.capturedAt,
          records: payload.records,
          platforms: payload.meta.platforms || ['instagram'],
          rosterVersion: payload.meta.rosterVersion || null,
          validated: payload.meta.validation?.status === 'passed' && payload.meta.validation?.validatorVersion === 2,
        });
      }
    } catch (error) {
      console.warn(`[backfill] skipped latest.json: ${error.message || error}`);
    }
  }
  return snapshots.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function backfill(dir, windowDays = WINDOW_DAYS) {
  const snapshots = loadSnapshots(dir);
  let series = emptySeries();
  for (const snapshot of snapshots) {
    series = appendSnapshot(
      series, snapshot.records, snapshot.capturedAt, windowDays, snapshot.platforms, [], snapshot.rosterVersion,
    );
    /*
     * A rebuild must not launder an old capture into a validated one. Only
     * snapshots that carry a validator-v2 stamp of their own get the flag back.
     */
    if (snapshot.validated) series = stampValidated(series, snapshot.capturedAt).series;
  }
  return { series, snapshots };
}

function main() {
  const dir = arg('--out', 'data');
  const { series, snapshots } = backfill(dir);
  const target = path.join(dir, 'series.json');
  const pending = path.join(dir, '.series.pending.json');
  fs.writeFileSync(pending, JSON.stringify(series));
  fs.renameSync(pending, target);
  const points = Object.values(series.profiles).reduce((sum, entry) => sum + entry.points.length, 0);
  const bytes = fs.statSync(target).size;
  console.log(`[backfill] ${snapshots.length} snapshot(s) → ${Object.keys(series.profiles).length} profiles, ${points} points, ${(bytes / 1024).toFixed(1)} KB`);
}

if (require.main === module) main();
module.exports = { backfill, loadSnapshots };
