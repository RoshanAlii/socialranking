'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRecord } = require('./normalize');
const { buildLeaderboards, growth, WINDOW_DAYS } = require('./rank');
const { MockProvider, ApifyProvider, CapturedProvider, PROFILE_ACTOR, POSTS_ACTOR, INSTAGRAM_POST_LOOKBACK_DAYS, INSTAGRAM_POST_RESULTS_LIMIT } = require('./provider');

const DAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_TARGET_DAYS = 7;
const GROWTH_MIN_DAYS = 5;
const GROWTH_MAX_DAYS = 9;

function arg(flag, defaultValue) {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : defaultValue;
}
function has(flag) { return process.argv.includes(flag); }

async function run(registry, provider, platforms, capturedAt, opts = {}) {
  const employees = registry.employees.filter(employee => employee.dashboardRelevant !== false);
  const records = [];
  const states = { private: [], unresolved: [], unconfirmed: [], excludedBackOffice: [] };
  const prefetched = new Map();
  const batchErrors = new Map();

  if (typeof provider.fetchProfiles === 'function') {
    for (const platform of platforms) {
      const handles = employees
        .filter(employee => employee.confirmed === true && employee.handles && employee.handles[platform])
        .map(employee => employee.handles[platform]);
      try { prefetched.set(platform, await provider.fetchProfiles(platform, handles)); }
      catch (error) { batchErrors.set(platform, String(error.message || error)); }
    }
  }

  for (const employee of registry.employees) {
    if (employee.dashboardRelevant === false) {
      states.excludedBackOffice.push({ name: employee.name, role: employee.role });
      continue;
    }
    for (const platform of platforms) {
      const handle = employee.handles ? employee.handles[platform] : null;
      const entry = { name: employee.name, role: employee.role, platform, handle };
      if (!handle || employee.confirmed !== true) {
        records.push(normalizeRecord(entry, null, capturedAt));
        if (handle && employee.confirmed !== true) states.unconfirmed.push({ name: employee.name, platform, handle });
        continue;
      }

      let raw = null;
      let error = null;
      try {
        if (batchErrors.has(platform)) throw new Error(batchErrors.get(platform));
        raw = prefetched.has(platform)
          ? (prefetched.get(platform).get(handle) || { notFound: true })
          : await provider.fetchProfile(platform, handle);
      } catch (caught) {
        error = String(caught.message || caught);
        raw = { notFound: true };
      }

      if (opts.rawDir && raw && !raw.notFound) {
        fs.mkdirSync(opts.rawDir, { recursive: true });
        const safe = `${platform}_${handle}`.replace(/[^a-zA-Z0-9._-]/g, '_');
        fs.writeFileSync(path.join(opts.rawDir, `${safe}.json`), JSON.stringify(raw, null, 2));
      }

      const record = normalizeRecord(entry, raw, capturedAt);
      records.push(record);
      if (!record.resolved) states.unresolved.push({ name: employee.name, platform, handle, error });
      else if (record.isPrivate) states.private.push({ name: employee.name, platform, handle });
    }
  }

  return { records, states, relevantCount: employees.length };
}

function parseHistoryFile(file) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = payload?.meta?.capturedAt ? new Date(payload.meta.capturedAt).getTime() : NaN;
    return Number.isFinite(at) && Array.isArray(payload.records) ? { payload, at, file } : null;
  } catch (_) { return null; }
}
function loadWeeklyBaseline(dir, currentCapturedAt) {
  const historyDir = path.join(dir, 'history');
  if (!fs.existsSync(historyDir)) return null;
  const current = new Date(currentCapturedAt).getTime();
  if (!Number.isFinite(current)) return null;
  const candidates = fs.readdirSync(historyDir)
    .filter(file => file.endsWith('.json'))
    .map(file => parseHistoryFile(path.join(historyDir, file)))
    .filter(Boolean)
    .map(item => Object.assign(item, { ageDays: (current - item.at) / DAY_MS }))
    .filter(item => item.ageDays >= GROWTH_MIN_DAYS && item.ageDays <= GROWTH_MAX_DAYS)
    .sort((a, b) => Math.abs(a.ageDays - GROWTH_TARGET_DAYS) - Math.abs(b.ageDays - GROWTH_TARGET_DAYS));
  return candidates[0] || null;
}

async function main() {
  const registryPath = arg('--registry', 'handles.json');
  const outDir = arg('--out', 'data');
  const platforms = arg('--platforms', 'instagram').split(',').map(value => value.trim()).filter(Boolean);
  if (platforms.some(platform => platform !== 'instagram')) {
    throw new Error('Instagram is the only active platform. TikTok and Facebook are available soon.');
  }
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
  const source = useCaptured || useLive ? 'live' : 'sample';
  const capturedAt = new Date().toISOString();
  const baseline = loadWeeklyBaseline(outDir, capturedAt);
  const { records, states, relevantCount } = await run(
    registry, provider, platforms, capturedAt,
    useLive ? { rawDir: path.join(outDir, 'raw') } : {},
  );

  const leaderboards = buildLeaderboards(records, platforms, { now: new Date(capturedAt).getTime(), windowDays: WINDOW_DAYS });
  const trend = baseline ? growth(baseline.payload.records, records) : [];
  const baselineDays = baseline ? (new Date(capturedAt).getTime() - baseline.at) / DAY_MS : null;
  const payload = {
    meta: {
      company: registry.company,
      orn: registry.orn,
      measurementVersion: 3,
      capturedAt,
      source,
      provider: useCaptured ? 'Apify captured run' : useLive ? 'Apify' : 'mock',
      platforms,
      relevantCount,
      resolvedProfiles: records.filter(record => record.resolved && !record.isPrivate).length,
      cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30',
      cadenceWindowDays: WINDOW_DAYS,
      postLookbackDays: INSTAGRAM_POST_LOOKBACK_DAYS,
      postResultsLimitPerProfile: INSTAGRAM_POST_RESULTS_LIMIT,
      profileActor: PROFILE_ACTOR,
      postsActor: POSTS_ACTOR,
      note: source === 'sample'
        ? 'SAMPLE data for layout testing only.'
        : 'Live public Instagram profile details plus a dedicated date-bounded posts pull. TikTok and Facebook are available soon.',
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

  const attempted = records.filter(record => record.handle).length;
  if (useLive && attempted > 0 && payload.meta.resolvedProfiles === 0) {
    const reason = states.unresolved.find(item => item.error)?.error || 'no profiles returned';
    console.error(`\n[ingest] FAILED — attempted ${attempted} handle(s), resolved 0. First error: ${reason}\n`);
    process.exit(3);
  }

  fs.mkdirSync(path.join(outDir, 'history'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(payload, null, 2));
  const stamp = capturedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, 'history', `${stamp}.json`), JSON.stringify({ meta: payload.meta, records }, null, 2));
  const coverage = payload.leaderboards.instagram?.coverage;
  console.log(`[ingest] ${source} Instagram snapshot @ ${capturedAt} — ${payload.meta.resolvedProfiles} profiles, ${coverage?.completeWindowProfiles || 0} complete cadence windows`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { run, loadWeeklyBaseline, GROWTH_TARGET_DAYS, GROWTH_MIN_DAYS, GROWTH_MAX_DAYS };
