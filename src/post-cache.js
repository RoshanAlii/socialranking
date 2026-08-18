'use strict';

const fs = require('fs');
const path = require('path');
const N = require('./normalize');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 32;

function snapshotTime(snapshot) {
  const value = Date.parse(snapshot?.meta?.capturedAt || '');
  return Number.isFinite(value) ? value : null;
}

function loadHistorySnapshots(historyDir, opts = {}) {
  if (!fs.existsSync(historyDir)) return [];
  const before = Date.parse(opts.before || '');
  return fs.readdirSync(historyDir)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      try { return JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8')); }
      catch (_) { return null; }
    })
    .filter(snapshot => snapshot && Array.isArray(snapshot.records) && snapshotTime(snapshot) !== null)
    .filter(snapshot => !opts.rosterVersion || snapshot.meta?.rosterVersion === opts.rosterVersion)
    .filter(snapshot => !Number.isFinite(before) || snapshotTime(snapshot) < before)
    .sort((a, b) => snapshotTime(b) - snapshotTime(a));
}

function recoverRecord(record, snapshots, capturedAt, retentionDays = DEFAULT_RETENTION_DAYS) {
  if (!record?.handle || record.platform !== 'instagram' || record.resolved !== true || record.isPrivate === true) {
    return record;
  }
  const current = Date.parse(capturedAt || record.capturedAt || '');
  if (!Number.isFinite(current)) return record;
  const cutoff = current - retentionDays * DAY_MS;
  const expectedOwner = N.canonicalHandle(record.handle);
  const sources = [{ at: current, record }];
  for (const snapshot of snapshots || []) {
    const source = snapshot.records.find(item => (
      item.platform === 'instagram' && N.canonicalHandle(item.handle) === expectedOwner &&
      item.resolved === true && item.isPrivate === false &&
      item.fetchMeta?.postsQuerySucceeded === true && item.fetchMeta?.postsOwnershipComplete !== false
    ));
    if (source) sources.push({ at: snapshotTime(snapshot), record: source });
  }

  const seen = new Set();
  const posts = [];
  let recovered = 0;
  let oldestObservation = null;
  for (const source of sources.sort((a, b) => b.at - a.at)) {
    for (const item of source.record.recentPosts || []) {
      if (N.canonicalHandle(item.ownerUsername) !== expectedOwner) continue;
      const postedAt = Date.parse(item.postedAt || '');
      if (!Number.isFinite(postedAt) || postedAt < cutoff || postedAt > current) continue;
      const key = N.postKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      const historical = source.record !== record;
      const observation = item.metricsObservedAt || new Date(source.at).toISOString();
      const copy = Object.assign({}, item);
      if (historical) copy.metricsObservedAt = observation;
      else if (copy.metricsObservedAt === new Date(current).toISOString()) delete copy.metricsObservedAt;
      posts.push(copy);
      if (historical) recovered++;
      const observedAt = Date.parse(observation);
      if (Number.isFinite(observedAt) && (oldestObservation === null || observedAt < oldestObservation)) {
        oldestObservation = observedAt;
      }
    }
  }
  if (!recovered) return Object.assign({}, record, { recentPosts: posts });

  const meta = Object.assign({}, record.fetchMeta || {}, {
    authoredPostCount: posts.length,
    reusedPostCount: (record.fetchMeta?.reusedPostCount || 0) + recovered,
    historyRecoveredPostCount: recovered,
    historyOldestMetricsObservedAt: oldestObservation === null ? null : new Date(oldestObservation).toISOString(),
  });
  const warnings = (record.warnings || []).filter(message => !/^\d+ post\(s\) retained from validated history/.test(message));
  warnings.push(`${recovered} post(s) retained from validated history after the latest provider response omitted them`);
  return Object.assign({}, record, { recentPosts: posts, fetchMeta: meta, warnings });
}

function recoverRecords(records, snapshots, capturedAt, retentionDays = DEFAULT_RETENTION_DAYS) {
  return (records || []).map(record => recoverRecord(record, snapshots, capturedAt, retentionDays));
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  loadHistorySnapshots,
  recoverRecord,
  recoverRecords,
};
