'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ACCOUNTS_DIR = path.join(ROOT, 'accounts');
const DATA_DIR = path.join(ACCOUNTS_DIR, 'data');
const MANIFEST_PATH = path.join(ACCOUNTS_DIR, 'manifest.json');
const PORTAL_VERSION = 1;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function stripHonorific(name) {
  return String(name || '')
    .trim()
    .replace(/^((dr|mr|mrs|ms|miss)\.?\s+)+/i, '')
    .trim();
}

function firstNameOf(name) {
  const first = stripHonorific(name).split(/\s+/)[0] || 'Kirpa';
  return first.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || 'Kirpa';
}

function slugBase(name) {
  return stripHonorific(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'employee';
}

function canonicalHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function safeEmployee(employee) {
  return {
    name: employee?.name || 'Kirpa employee',
    role: employee?.role || null,
    dashboardRelevant: employee?.dashboardRelevant !== false,
    handles: employee?.handles || {},
    confirmed: employee?.confirmed === true,
    private: employee?.private === true,
    targets: employee?.targets || null,
    strategy: employee?.strategy || employee?.accountStrategy || employee?.strategyProfile || null,
  };
}

function safeMeta(meta) {
  return {
    company: meta?.company || 'Kirpa Properties L.L.C',
    orn: meta?.orn || null,
    rosterVersion: meta?.rosterVersion || null,
    capturedAt: meta?.capturedAt || null,
    source: meta?.source || null,
    provider: meta?.provider || null,
    measurementVersion: meta?.measurementVersion || null,
    validation: meta?.validation || null,
    timezone: meta?.timezone || 'Asia/Dubai (UTC+4)',
    growthBaselineAt: meta?.growthBaselineAt || null,
    growthBaselineDays: meta?.growthBaselineDays || null,
    trendAvailable: meta?.trendAvailable === true,
    shortWindowDays: meta?.shortWindowDays || 7,
  };
}

function findByHandleOrName(rows, handle, name) {
  const canonical = canonicalHandle(handle);
  return (Array.isArray(rows) ? rows : []).find(row => (
    (canonical && canonicalHandle(row?.handle) === canonical) ||
    (!canonical && row?.name === name)
  )) || null;
}

function profilePoints(series, handle) {
  if (!handle) return [];
  const key = `instagram::${canonicalHandle(handle)}`;
  return series?.profiles?.[key]?.points || [];
}

function findDeveloperRow(value, handle, name) {
  if (!value || typeof value !== 'object') return null;
  const keys = ['creators', 'people', 'accounts', 'profiles', 'results'];
  for (const key of keys) {
    const found = findByHandleOrName(value[key], handle, name);
    if (found) return found;
  }
  return null;
}

function statusFor(employee, record, analytics) {
  if (employee?.dashboardRelevant === false) {
    return { key: 'role-not-ranked', label: 'Role not currently ranked', detail: 'This employee has a personal link, but the current social-ranking scope excludes this role.' };
  }
  if (!employee?.handles?.instagram || employee?.confirmed !== true) {
    return { key: 'setup-pending', label: 'Account setup pending', detail: 'A confirmed Instagram handle is required before performance can be measured.' };
  }
  if (!record) {
    return { key: 'awaiting-pull', label: 'Awaiting data pull', detail: 'The handle is confirmed, but no matching profile record is present in the current snapshot.' };
  }
  if (record.isPrivate === true || employee.private === true) {
    return { key: 'private', label: 'Private account', detail: 'Public performance data cannot be collected from a private profile.' };
  }
  if (record.resolved !== true) {
    return { key: 'unresolved', label: 'Profile unresolved', detail: 'The latest collection could not resolve this Instagram profile.' };
  }
  if (analytics?.windowComplete !== true) {
    return { key: 'partial', label: 'Partial data', detail: analytics?.coverageReason || 'The latest pull could not prove a complete 30-day post window.' };
  }
  return { key: 'complete', label: 'Complete and current', detail: 'The latest validated snapshot contains a complete owner-verified 30-day post window.' };
}

function accountHtml(config) {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="theme-color" content="#f15a29">
  <title>${escapeHtml(config.name)} · Kirpa Social Performance</title>
  <link rel="icon" type="image/svg+xml" href="../../favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css?v=${PORTAL_VERSION}">
</head>
<body>
  <main id="employee-portal" aria-live="polite">
    <div class="portal-loading">Preparing personal performance portal…</div>
  </main>
  <script>window.KIRPA_EMPLOYEE_PORTAL = ${json};</script>
  <script src="../app.js?v=${PORTAL_VERSION}"></script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function directoryHtml(entries, generatedAt) {
  const cards = entries.map(entry => `
      <article class="directory-card">
        <div>
          <span class="directory-status ${escapeHtml(entry.status.key)}">${escapeHtml(entry.status.label)}</span>
          <h2>${escapeHtml(entry.name)}</h2>
          <p>${escapeHtml(entry.role || 'Kirpa employee')} ${entry.handle ? `· @${escapeHtml(entry.handle)}` : ''}</p>
        </div>
        <div class="directory-access">
          <span>Password: <b>${escapeHtml(entry.firstName)}</b></span>
          <a href="./${encodeURIComponent(entry.slug)}/">Open personal portal →</a>
        </div>
      </article>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="theme-color" content="#f15a29">
  <title>Kirpa employee portal directory</title>
  <script src="../access-gate.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css?v=${PORTAL_VERSION}">
</head>
<body class="directory-page">
  <header class="directory-hero">
    <div>
      <span class="eyebrow">Kirpa Properties · Admin directory</span>
      <h1>Employee performance portals</h1>
      <p>Each link opens only that employee’s generated portal payload. The password is the employee’s first name and is checked without case sensitivity.</p>
    </div>
    <div class="directory-meta"><b>${entries.length}</b><span>personal links</span></div>
  </header>
  <main class="directory-main">
    <div class="directory-warning"><b>Interim access model</b><span>These are static GitHub Pages links. Use them for the current internal rollout only; first-name passwords are not strong authentication.</span></div>
    <div class="directory-grid">${cards}</div>
  </main>
  <footer class="directory-footer">Generated ${escapeHtml(new Date(generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' }))} Dubai time.</footer>
</body>
</html>
`;
}

function removePriorGenerated(prior) {
  for (const entry of prior?.entries || []) {
    if (!entry?.slug) continue;
    fs.rmSync(path.join(ACCOUNTS_DIR, entry.slug), { recursive: true, force: true });
    fs.rmSync(path.join(DATA_DIR, `${entry.slug}.json`), { force: true });
  }
}

function main() {
  const registry = readJson(path.join(ROOT, 'handles.json'), { employees: [] });
  const snapshot = readJson(path.join(ROOT, 'data', 'latest.json'), {});
  const series = readJson(path.join(ROOT, 'data', 'series.json'), {});
  const developer = readJson(path.join(ROOT, 'data', 'developer-intelligence.json'), {});
  const mentions = readJson(path.join(ROOT, 'data', 'reel-mentions.json'), {});
  const prior = readJson(MANIFEST_PATH, { entries: [] });

  removePriorGenerated(prior);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const board = snapshot?.leaderboards?.instagram || {};
  const composite = snapshot?.leaderboards?.combined?.composite || [];
  const people = Array.isArray(snapshot.people) ? snapshot.people : [];
  const trend = Array.isArray(snapshot.trend) ? snapshot.trend : [];
  const usedSlugs = new Set();
  const entries = [];
  const generatedAt = new Date().toISOString();

  for (const employee of registry.employees || []) {
    const firstName = firstNameOf(employee.name);
    let slug = slugBase(employee.name);
    let suffix = 2;
    while (usedSlugs.has(slug)) slug = `${slugBase(employee.name)}-${suffix++}`;
    usedSlugs.add(slug);

    const handle = employee?.handles?.instagram || null;
    const record = findByHandleOrName(records, handle, employee.name);
    const analytics = findByHandleOrName(board.analytics, handle, employee.name);
    const person = findByHandleOrName(people, handle, employee.name);
    const score = findByHandleOrName(composite, handle, employee.name);
    const engagement = findByHandleOrName(board.engagement, handle, employee.name);
    const cadence = findByHandleOrName(board.postingFrequency, handle, employee.name);
    const growth = findByHandleOrName(trend, handle, employee.name);
    const developerRow = findDeveloperRow(developer, handle, employee.name) || findDeveloperRow(mentions, handle, employee.name);
    const status = statusFor(employee, record, analytics);

    const payload = {
      schemaVersion: 1,
      generatedAt,
      employee: safeEmployee(employee),
      status,
      snapshot: safeMeta(snapshot.meta),
      record,
      analytics,
      person,
      score,
      engagement,
      cadence,
      growth,
      series: {
        windowDays: series?.windowDays || 30,
        points: profilePoints(series, handle),
      },
      developer: developerRow,
      team: {
        benchmarks: board.teamBenchmarks || null,
        eligibleMomentumProfiles: composite.filter(row => row?.rank).length,
        completeWindowProfiles: board?.coverage?.completeWindowProfiles ?? null,
      },
    };

    writeJson(path.join(DATA_DIR, `${slug}.json`), payload);
    const accountDir = path.join(ACCOUNTS_DIR, slug);
    fs.mkdirSync(accountDir, { recursive: true });
    fs.writeFileSync(path.join(accountDir, 'index.html'), accountHtml({
      slug,
      name: employee.name,
      role: employee.role || null,
      dataUrl: `../data/${slug}.json`,
      passwordHash: sha256(firstName.trim().toLowerCase()),
      sessionKey: `kirpa-employee-${slug}-v1`,
    }));

    entries.push({
      name: employee.name,
      firstName,
      role: employee.role || null,
      handle,
      slug,
      path: `accounts/${slug}/`,
      status,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    rosterVersion: registry.rosterVersion || null,
    entries,
  };
  writeJson(MANIFEST_PATH, manifest);
  fs.writeFileSync(path.join(ACCOUNTS_DIR, 'index.html'), directoryHtml(entries, generatedAt));
  console.log(`[employee-portals] generated ${entries.length} personal links from roster ${registry.rosterVersion || 'unknown'}`);
}

if (require.main === module) main();

module.exports = { firstNameOf, slugBase, statusFor, main };
