'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRecord } = require('./normalize');
const { buildLeaderboards, growth } = require('./rank');
const { MockProvider, ApifyProvider, CapturedProvider } = require('./provider');

const DAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_TARGET_DAYS = 7;
const GROWTH_MIN_DAYS = 5;
const GROWTH_MAX_DAYS = 9;

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
}
function has(flag) { return process.argv.includes(flag); }

async function run(registry, provider, platforms, capturedAt, opts = {}) {
  const employees = registry.employees.filter(e => e.dashboardRelevant !== false);
  const records = [];
  const states = { private: [], unresolved: [], unconfirmed: [], excludedBackOffice: [] };
  const prefetched = new Map();
  const batchErrors = new Map();

  if (typeof provider.fetchProfiles === 'function') {
    for (const pf of platforms) {
      const handles = employees
        .filter(e => e.confirmed === true && e.handles && e.handles[pf])
        .map(e => e.handles[pf]);
      try { prefetched.set(pf, await provider.fetchProfiles(pf, handles)); }
      catch (err) { batchErrors.set(pf, String(err.message || err)); }
    }
  }

  for (const e of registry.employees) {
    if (e.dashboardRelevant === false) {
      states.excludedBackOffice.push({ name: e.name, role: e.role });
      continue;
    }
    for (const pf of platforms) {
      const handle = e.handles ? e.handles[pf] : null;
      const entry = { name: e.name, role: e.role, platform: pf, handle };
      if (!handle || e.confirmed !== true) {
        records.push(normalizeRecord(entry, null, capturedAt));
        if (handle && e.confirmed !== true) states.unconfirmed.push({ name: e.name, platform: pf, handle });
        continue;
      }

      let raw = null;
      let error = null;
      try {
        if (batchErrors.has(pf)) throw new Error(batchErrors.get(pf));
        raw = prefetched.has(pf)
          ? (prefetched.get(pf).get(handle) || { notFound: true })
          : await provider.fetchProfile(pf, handle);
      } catch (err) {
        error = String(err.message || err);
        raw = { notFound: true };
      }

      if (opts.rawDir && raw && !raw.notFound) {
        fs.mkdirSync(opts.rawDir, { recursive: true });
        const safe = `${pf}_${handle}`.replace(/[^a-zA-Z0-9._-]/g, '_');
        fs.writeFileSync(path.join(opts.rawDir, `${safe}.json`), JSON.stringify(raw, null, 2));
      }

      const rec = normalizeRecord(entry, raw, capturedAt);
      records.push(rec);
      if (!rec.resolved) states.unresolved.push({ name: e.name, platform: pf, handle, error });
      else if (rec.isPrivate) states.private.push({ name: e.name, platform: pf, handle });
    }
  }

  return { records, states, relevantCount: employees.length };
}

function parseHistoryFile(file) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = payload?.meta?.capturedAt ? new Date(payload.meta.capturedAt).getTime() : NaN;
    return Number.isFinite(at) && Array.isArray(payload.records) ? { payload, at, file } : null;
  } catch (_) {
    return null;
  }
}

/*
 * Growth must be genuinely weekly. We accept a baseline only when it is 5–9
 * days old and choose the snapshot closest to exactly seven days.
 */
function loadWeeklyBaseline(dir, currentCapturedAt) {
  const hdir = path.join(dir, 'history');
  if (!fs.existsSync(hdir)) return null;
  const current = new Date(currentCapturedAt).getTime();
  if (!Number.isFinite(current)) return null;

  const candidates = fs.readdirSync(hdir)
    .filter(f => f.endsWith('.json'))
    .map(f => parseHistoryFile(path.join(hdir, f)))
    .filter(Boolean)
    .map(x => Object.assign(x, { ageDays: (current - x.at) / DAY_MS }))
    .filter(x => x.ageDays >= GROWTH_MIN_DAYS && x.ageDays <= GROWTH_MAX_DAYS)
    .sort((a, b) => Math.abs(a.ageDays - GROWTH_TARGET_DAYS) - Math.abs(b.ageDays - GROWTH_TARGET_DAYS));

  return candidates[0] || null;
}

async function main() {
  const registryPath = arg('--registry', 'handles.json');
  const outDir = arg('--out', 'data');
  const platforms = arg('--platforms', 'instagram').split(',').map(x => x.trim()).filter(Boolean);
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  const allowSample = has('--allow-sample');
  const useCaptured = has('--captured');
  if (!process.env.APIFY_TOKEN && !allowSample && !useCaptured) {
    console.error('\n[ingest] STOPPED — no APIFY_TOKEN. Live data only; no placeholders written.\n');
    process.exit(2);
  }

  const useLive = !!process.env.APIFY_TOKEN && !useCaptured;
  const provider = useCaptured
    ? new CapturedProvider(path.join(outDir, 'raw'))
    : useLive ? new ApifyProvider() : new MockProvider();
  const source = useCaptured ? 'live' : useLive ? 'live' : 'sample';
  const capturedAt = new Date().toISOString();

  const baseline = loadWeeklyBaseline(outDir, capturedAt);
  const { records, states, relevantCount } = await run(
    registry,
    provider,
    platforms,
    capturedAt,
    useLive ? { rawDir: path.join(outDir, 'raw') } : {},
  );

  const leaderboards = buildLeaderboards(records, platforms);
  const trend = baseline ? growth(baseline.payload.records, records) : [];
  const baselineDays = baseline ? (new Date(capturedAt).getTime() - baseline.at) / DAY_MS : null;

  const payload = {
    meta: {
      company: registry.company,
      orn: registry.orn,
      measurementVersion: 2,
      capturedAt,
      source,
      provider: useCaptured ? 'apify (captured run)' : useLive ? 'apify' : 'mock',
      platforms,
      relevantCount,
      resolvedProfiles: records.filter(r => r.resolved && !r.isPrivate).length,
      note: source === 'sample'
        ? 'SAMPLE data for layout testing only.'
        : 'Live Instagram public-surface snapshot via Apify. TikTok and Facebook are not yet included.',
      trendAvailable: trend.length > 0,
      growthBaselineAt: baseline?.payload?.meta?.capturedAt || null,
      growthBaselineDays: baselineDays,
      growthWindowRule: 'Baseline must be 5–9 days old; nearest to 7 days is used.',
    },
    records,
    leaderboards,
    states,
    trend,
  };

  const attempted = records.filter(r => r.handle).length;
  if (useLive && attempted > 0 && payload.meta.resolvedProfiles === 0) {
    const why = states.unresolved.find(u => u.error)?.error || 'no profiles returned';
    console.error(`\n[ingest] FAILED — attempted ${attempted} handle(s), resolved 0. First error: ${why}\n`);
    process.exit(3);
  }

  fs.mkdirSync(path.join(outDir, 'history'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(payload, null, 2));
  const stamp = capturedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, 'history', `${stamp}.json`), JSON.stringify({ meta: payload.meta, records }, null, 2));
  console.log(`[ingest] ${source} Instagram snapshot @ ${capturedAt} — ${payload.meta.resolvedProfiles} profiles, weeklyTrend=${payload.meta.trendAvailable}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = {
  run,
  loadWeeklyBaseline,
  GROWTH_TARGET_DAYS,
  GROWTH_MIN_DAYS,
  GROWTH_MAX_DAYS,
};
