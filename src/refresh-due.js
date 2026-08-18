'use strict';

const fs = require('fs');
const path = require('path');

const FOUR_DAY_DUE_HOURS = Number(process.env.SOCIAL_REFRESH_DUE_HOURS || 95);

function refreshDue(snapshot, now = new Date(), dueHours = FOUR_DAY_DUE_HOURS) {
  const capturedMs = new Date(snapshot?.meta?.capturedAt || 0).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(capturedMs) || !Number.isFinite(nowMs)) {
    return { due: true, ageHours: null, reason: 'No valid published capture timestamp exists.' };
  }
  const ageHours = Math.max(0, (nowMs - capturedMs) / 36e5);
  return {
    due: ageHours >= dueHours,
    ageHours,
    reason: ageHours >= dueHours
      ? `The validated snapshot is ${ageHours.toFixed(1)} hours old.`
      : `The validated snapshot is only ${ageHours.toFixed(1)} hours old.`,
  };
}

function appendOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', 'data', 'latest.json');
  let snapshot = null;
  try { snapshot = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* due by default */ }
  const result = refreshDue(snapshot);
  appendOutput('due', String(result.due));
  appendOutput('age_hours', result.ageHours == null ? 'unknown' : result.ageHours.toFixed(1));
  console.log(`[refresh-due] ${result.due ? 'due' : 'not due'}: ${result.reason}`);
}

module.exports = { FOUR_DAY_DUE_HOURS, refreshDue };
