'use strict';

/*
 * Weekly digest.
 *
 * A dashboard nobody opens is a dashboard nobody uses, so the numbers go to
 * where the team already is. This renders the published snapshot into a short
 * message and, when SLACK_WEBHOOK_URL is set, posts it. Without the webhook it
 * only prints — sending is opt-in by configuration, never by default.
 *
 * The digest refuses to speak for a snapshot the validator has not passed. A
 * cheerful weekly summary built on unvalidated numbers is exactly the failure
 * mode the rest of this repository exists to prevent.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { teamHistory, changeOver } = require('./series');

const MAX_PUBLIC_AGE_HOURS = 36;

function arg(flag, defaultValue) {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : defaultValue;
}
function has(flag) { return process.argv.includes(flag); }
function fmt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Math.abs(value) >= 10000
    ? `${(value / 1000).toFixed(1)}k`
    : String(Math.round(value * 100) / 100);
}
function pct(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
}
function signed(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${fmt(value)}`;
}

function digestState(snapshot, registry) {
  const meta = snapshot?.meta || {};
  const validation = meta.validation || {};
  const ageHours = Number.isFinite(Date.parse(meta.capturedAt))
    ? (Date.now() - Date.parse(meta.capturedAt)) / 3600000
    : Infinity;
  if (validation.status !== 'passed' || validation.validatorVersion !== 2) {
    return { ok: false, reason: 'the latest snapshot has not passed the validator' };
  }
  if (registry?.rosterVersion && validation.rosterVersion !== registry.rosterVersion) {
    return { ok: false, reason: `the snapshot is stamped for roster ${validation.rosterVersion || 'unknown'}, not ${registry.rosterVersion}` };
  }
  if (ageHours > MAX_PUBLIC_AGE_HOURS) {
    return { ok: false, reason: `the latest snapshot is ${Math.round(ageHours)} hours old` };
  }
  return { ok: true, ageHours };
}

function buildDigest(snapshot, series, registry, opts = {}) {
  const state = digestState(snapshot, registry);
  const title = `${snapshot?.meta?.company || 'Kirpa'} · social weekly`;
  if (!state.ok) {
    return {
      ok: false,
      title,
      text: `*${title}*\nNo verified numbers this week — ${state.reason}. Nothing is being reported until a validated pull lands.`,
    };
  }

  const board = snapshot.leaderboards?.instagram || {};
  const composite = (snapshot.leaderboards?.combined?.composite || []).filter(row => row.rank);
  const coverage = board.coverage || {};
  const team = teamHistory(series, 'instagram');
  const followerChange = changeOver(team, 'followers', 7);
  const activeChange = changeOver(team, 'activeProfiles', 7);
  const lines = [];

  lines.push(`*${title}* · window ${coverage.windowDays || 30} days · captured ${snapshot.meta.capturedAt.slice(0, 16).replace('T', ' ')}Z`);
  lines.push('');
  lines.push(`• Team audience ${fmt(team[team.length - 1]?.followers)}${followerChange ? ` (${signed(followerChange.delta)} in ${Math.round(followerChange.days)}d)` : ''}`);
  lines.push(`• ${coverage.profilesWithPostsInWindow || 0} of ${coverage.completeWindowProfiles || 0} measured profiles posted${activeChange ? ` (${signed(activeChange.delta)} vs last week)` : ''}`);
  lines.push(`• ${coverage.postsInWindow || 0} posts measured across the window`);

  if (composite.length) {
    lines.push('');
    lines.push('*Momentum top three*');
    composite.slice(0, 3).forEach(row => {
      lines.push(`${row.rank}. ${row.name} — ${row.role || 'team'}`);
    });
  }

  const risers = (snapshot.trend || [])
    .filter(row => typeof row.followerPct === 'number' && row.followerPct > 0)
    .slice(0, 3);
  if (risers.length) {
    lines.push('');
    lines.push('*Fastest follower growth*');
    risers.forEach(row => lines.push(`• ${row.name} ${pct(row.followerPct)} (${signed(Math.round(row.followerDelta))}/wk)`));
  }

  const top = board.topPost;
  if (top) {
    lines.push('');
    lines.push(`*Top post* — ${top.name}, ${fmt(top.engagement)} interactions${top.post?.url ? ` <${top.post.url}|view>` : ''}`);
  }

  const quiet = (snapshot.people || [])
    .filter(person => person.windowComplete && typeof person.daysSinceLastPost === 'number' && person.daysSinceLastPost >= 10)
    .sort((a, b) => b.daysSinceLastPost - a.daysSinceLastPost)
    .slice(0, 5);
  if (quiet.length) {
    lines.push('');
    lines.push('*Quiet accounts*');
    quiet.forEach(person => lines.push(`• ${person.name} — ${person.daysSinceLastPost} days since last post`));
  }

  const attention = (snapshot.states?.unresolved?.length || 0) + (snapshot.states?.unconfirmed?.length || 0);
  if (attention) lines.push('', `_${attention} profile(s) still need a confirmed handle or a successful pull._`);
  if (opts.boardUrl) lines.push('', `Full board: ${opts.boardUrl}`);

  return { ok: true, title, text: lines.join('\n') };
}

function postToSlack(webhook, text) {
  const body = JSON.stringify({ text });
  const url = new URL(webhook);
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => (res.statusCode >= 400
        ? reject(new Error(`Slack ${res.statusCode}: ${data.slice(0, 200)}`))
        : resolve(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const dir = arg('--out', 'data');
  const registryPath = arg('--registry', 'handles.json');
  const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  const seriesPath = path.join(dir, 'series.json');
  const series = fs.existsSync(seriesPath) ? JSON.parse(fs.readFileSync(seriesPath, 'utf8')) : null;
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const digest = buildDigest(snapshot, series, registry, { boardUrl: process.env.BOARD_URL || arg('--url', '') });

  console.log(digest.text);
  const outFile = arg('--write', '');
  if (outFile) fs.writeFileSync(outFile, digest.text);

  if (!has('--post')) return;
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.log('[digest] SLACK_WEBHOOK_URL is not set — nothing was sent.');
    return;
  }
  if (!digest.ok && !has('--post-unvalidated')) {
    console.log('[digest] snapshot is not validated — refusing to post a weekly summary.');
    return;
  }
  await postToSlack(webhook, digest.text);
  console.log('[digest] posted.');
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { buildDigest, digestState };
