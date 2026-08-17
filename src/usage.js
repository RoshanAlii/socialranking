'use strict';

const fs = require('fs');

const DEFAULT_SOFT_LIMIT_USD = Number(process.env.APIFY_MONTHLY_SOFT_LIMIT_USD || 23.2);
const DEFAULT_PLAN_LIMIT_USD = Number(process.env.APIFY_PLAN_LIMIT_USD || 29);

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function monthKey(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : null;
}

function emptyLedger() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    softLimitUsd: DEFAULT_SOFT_LIMIT_USD,
    planLimitUsd: DEFAULT_PLAN_LIMIT_USD,
    observations: [],
    runs: [],
  };
}

function loadLedger(file) {
  try {
    return Object.assign(emptyLedger(), JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    return emptyLedger();
  }
}

function atomicWrite(file, value) {
  const pending = `${file}.pending`;
  fs.writeFileSync(pending, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(pending, file);
}

function appendTelemetry(ledger, telemetry, capturedAt) {
  const next = Object.assign(emptyLedger(), ledger || {});
  next.runs = Array.isArray(next.runs) ? next.runs : [];
  for (const event of telemetry?.events || []) {
    next.runs.push({
      at: event.at || capturedAt,
      captureAt: capturedAt,
      actor: event.actor || null,
      attempt: event.attempt || 1,
      status: event.status || (event.ok ? 'SUCCEEDED' : 'FAILED'),
      ok: event.ok === true,
      runId: event.runId || null,
      itemCount: typeof event.items === 'number' ? event.items : null,
      durationMs: typeof event.ms === 'number' ? event.ms : null,
      costUsd: typeof event.costUsd === 'number' ? roundMoney(event.costUsd) : null,
      error: event.ok ? null : String(event.error || 'Actor run failed').slice(0, 240),
    });
  }
  const retention = Date.now() - 400 * 24 * 60 * 60 * 1000;
  next.runs = next.runs.filter(run => {
    const at = Date.parse(run.at || run.captureAt || '');
    return !Number.isFinite(at) || at >= retention;
  }).slice(-5000);
  next.updatedAt = capturedAt;
  return next;
}

function currentSummary(ledger, at = new Date().toISOString()) {
  const key = monthKey(at);
  const runs = (ledger?.runs || []).filter(run => monthKey(run.at || run.captureAt) === key);
  const knownCost = roundMoney(runs.reduce((sum, run) => sum + (typeof run.costUsd === 'number' ? run.costUsd : 0), 0));
  const observation = (ledger?.observations || [])
    .filter(row => monthKey(row.at) === key && typeof row.platformUsageUsd === 'number')
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;
  const observed = observation ? Number(observation.platformUsageUsd) : 0;
  const observedAt = observation ? Date.parse(observation.at) : NaN;
  const postObservationCost = Number.isFinite(observedAt)
    ? runs.filter(run => Date.parse(run.at || run.captureAt || '') > observedAt)
      .reduce((sum, run) => sum + (typeof run.costUsd === 'number' ? run.costUsd : 0), 0)
    : knownCost;
  // A fresh console observation is the billing system's authoritative total.
  // This also handles an in-month plan upgrade/reset: older run costs remain
  // auditable but are not incorrectly added back above the new observed total.
  const usageUsd = roundMoney(observation ? observed + postObservationCost : knownCost);
  const softLimitUsd = Number(ledger?.softLimitUsd || DEFAULT_SOFT_LIMIT_USD);
  const planLimitUsd = Number(ledger?.planLimitUsd || DEFAULT_PLAN_LIMIT_USD);
  return {
    month: key,
    usageUsd,
    knownRunCostUsd: knownCost,
    softLimitUsd,
    planLimitUsd,
    remainingToSoftLimitUsd: roundMoney(Math.max(0, softLimitUsd - usageUsd)),
    softWarning: usageUsd >= softLimitUsd,
    runs: runs.length,
    successfulRuns: runs.filter(run => run.ok).length,
    failedRuns: runs.filter(run => !run.ok).length,
    costKnownRuns: runs.filter(run => typeof run.costUsd === 'number').length,
    unknownCostRuns: runs.filter(run => typeof run.costUsd !== 'number').length,
    observedAt: observation?.at || null,
    periodStart: observation?.periodStart || null,
    periodEnd: observation?.periodEnd || null,
  };
}

module.exports = {
  emptyLedger, loadLedger, atomicWrite, appendTelemetry, currentSummary,
  monthKey, roundMoney, DEFAULT_SOFT_LIMIT_USD, DEFAULT_PLAN_LIMIT_USD,
};
