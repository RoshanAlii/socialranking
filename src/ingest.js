'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRecord } = require('./normalize');
const { buildLeaderboards, growth, median, engagementRate, windowCoverage, WINDOW_DAYS } = require('./rank');
const {
  buildContentIntelligence, postingWeeks, daysSinceLastPost, goalProgress, nextActions,
  personContentPillars, personPostingTime,
} = require('./content');
const { appendSnapshot, emptySeries } = require('./series');
const { MockProvider, ApifyProvider, CapturedProvider, PROFILE_ACTOR, POSTS_ACTOR, INSTAGRAM_POST_LOOKBACK_DAYS, INSTAGRAM_POST_RESULTS_LIMIT } = require('./provider');
const U = require('./usage');
const POST_CACHE = require('./post-cache');

const DAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_TARGET_DAYS = 7;
const GROWTH_MIN_DAYS = 5;
const GROWTH_MAX_DAYS = 11;
const SHORT_WINDOW_DAYS = 7;
const DEFAULT_TARGETS = { postsPerWeek: 3, engagementRate: 0.02 };

function arg(flag, defaultValue) {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : defaultValue;
}
function has(flag) { return process.argv.includes(flag); }

function safeError(value) {
  return String(value?.message || value || 'Provider refresh failed')
    .replace(/token=[^&\s]+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function writeGithubOutput(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  fs.appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

function writeRefreshStatus(outDir, value) {
  const file = path.join(outDir, 'refresh-status.json');
  fs.mkdirSync(outDir, { recursive: true });
  U.atomicWrite(file, value);
}

async function run(registry, provider, platforms, capturedAt, opts = {}) {
  const employees = registry.employees.filter(employee => employee.dashboardRelevant !== false);
  const records = [];
  const states = { private: [], unresolved: [], unconfirmed: [], excludedBackOffice: [], optedOut: [] };
  const prefetched = new Map();
  const batchErrors = new Map();

  if (typeof provider.fetchProfiles === 'function') {
    for (const platform of platforms) {
      const handles = employees
        .filter(employee => employee.confirmed === true && employee.optOut !== true && employee.handles && employee.handles[platform])
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
      /*
       * An opt-out is honoured at the network boundary, not in the renderer.
       * The person keeps a roster row saying they opted out and nothing about
       * their account is fetched, stored, or ranked.
       */
      if (employee.optOut === true) {
        records.push(Object.assign(normalizeRecord(entry, null, capturedAt), { optOut: true }));
        states.optedOut.push({ name: employee.name, platform });
        continue;
      }
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

/*
 * The company account is the page every employee tags. Leaving it out meant the
 * board could not answer whether staff posting moves the brand at all. It is
 * pulled and charted, but deliberately kept out of `records` so it can never
 * enter a leaderboard and compete against individuals.
 */
async function runBrandAccounts(registry, provider, capturedAt, opts = {}) {
  const accounts = (registry.brandAccounts || []).filter(account => (
    account.confirmed === true && account.platform === 'instagram' && account.handle
  ));
  const out = [];
  for (const account of accounts) {
    let raw = null;
    let error = null;
    try {
      raw = typeof provider.fetchBrandProfile === 'function'
        ? await provider.fetchBrandProfile(account.platform, account.handle)
        : typeof provider.fetchProfile === 'function'
          ? await provider.fetchProfile(account.platform, account.handle)
          : (await provider.fetchProfiles(account.platform, [account.handle])).get(account.handle);
    } catch (caught) {
      error = String(caught.message || caught);
      raw = { notFound: true };
    }
    if (opts.rawDir && raw && !raw.notFound) {
      fs.mkdirSync(opts.rawDir, { recursive: true });
      const safe = `brand_${account.platform}_${account.handle}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.writeFileSync(path.join(opts.rawDir, `${safe}.json`), JSON.stringify(raw, null, 2));
    }
    const record = normalizeRecord(
      { name: account.name, role: 'Company account', platform: account.platform, handle: account.handle },
      raw,
      capturedAt,
    );
    out.push(Object.assign(record, { isBrand: true, error }));
  }
  return out;
}

function benchmarksFrom(leaderboards, platform = 'instagram') {
  const board = leaderboards?.[platform] || {};
  return {
    engagement: median((board.engagement || []).map(row => row.engagementRate)),
    cadence: median((board.postingFrequency || []).map(row => row.postsPerWeek)),
  };
}

/*
 * Per-person coaching state: streaks, goal progress and the ranked next steps.
 * Everything here is derived from the same gated window as the leaderboards, so
 * a person whose window could not be proved gets no advice rather than advice
 * built on a partial feed.
 */
function buildPeople(records, registry, content, leaderboards, now, days = WINDOW_DAYS) {
  const employees = new Map((registry.employees || []).map(employee => [employee.name, employee]));
  const benchmarks = benchmarksFrom(leaderboards);
  const defaults = registry.targets || DEFAULT_TARGETS;
  const hashtags = (content?.hashtags || []).slice(0, 12);
  const board = leaderboards?.instagram || {};
  const composite = leaderboards?.combined?.composite || [];
  return records.filter(record => (
    record.platform === 'instagram' && record.optOut !== true && record.resolved === true && record.isPrivate === false
  )).map(record => {
    const employee = employees.get(record.name);
    const complete = windowCoverage(record, now, days).complete;
    const rate = complete ? engagementRate(record, now, days) : null;
    const analytics = (board.analytics || []).find(row => row.handle === record.handle) || null;
    const score = composite.find(row => row.handle === record.handle) || null;
    const cadenceRank = (board.postingFrequency || []).find(row => row.handle === record.handle) || null;
    const achievements = [];
    if (score?.rank === 1) achievements.push({ key: 'momentum-leader', label: 'Momentum leader', evidence: `Rank 1 of ${composite.filter(row => row.rank).length}` });
    else if (score?.rank && score.rank <= Math.max(1, Math.ceil(composite.filter(row => row.rank).length * 0.1))) {
      achievements.push({ key: 'top-momentum', label: 'Top 10% momentum', evidence: `Rank ${score.rank} of ${composite.filter(row => row.rank).length}` });
    }
    if (cadenceRank?.rank === 1) achievements.push({ key: 'cadence-leader', label: 'Cadence leader', evidence: `${cadenceRank.postsPerWeek.toFixed(2)} posts/week` });
    if ((postingWeeks(record, now, days)?.currentStreakWeeks || 0) >= 4) achievements.push({ key: 'consistent', label: '4-week consistency', evidence: 'Published in every measured week' });
    if (analytics?.viewEfficiency >= 1) achievements.push({ key: 'beyond-following', label: 'Beyond the following', evidence: `Typical reported video views are ${(analytics.viewEfficiency).toFixed(1)}× followers` });
    if ((score?.components?.followerGrowth || 0) > 0) achievements.push({ key: 'growing', label: 'Audience growing', evidence: `${(score.components.followerGrowth * 100).toFixed(2)}% weekly-equivalent growth` });
    return {
      name: record.name,
      handle: record.handle,
      windowComplete: complete,
      daysSinceLastPost: daysSinceLastPost(record, now, days),
      cadence: postingWeeks(record, now, days),
      goals: goalProgress(record, employee, defaults, now, days),
      score: score ? {
        rank: score.rank,
        value: score.score,
        components: score.components,
        held: score.rank === null,
        sample: score.sample || null,
        eligibilityReasons: score.eligibilityReasons || [],
      } : null,
      teamBenchmarks: board.teamBenchmarks || null,
      teamPercentiles: analytics?.percentiles || null,
      postingTime: personPostingTime(record, now, days),
      contentPillars: personContentPillars(record, now, days),
      achievements,
      nextActions: nextActions(record, {
        now, days, benchmarks, hashtags,
        timing: content?.timing,
        teamMedianRate: content?.teamMedianRate,
        engagementRate: rate,
        targets: Object.assign({}, defaults, employee?.targets || {}),
      }),
    };
  });
}

function parseHistoryFile(file) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = payload?.meta?.capturedAt ? new Date(payload.meta.capturedAt).getTime() : NaN;
    return Number.isFinite(at) && Array.isArray(payload.records) ? { payload, at, file } : null;
  } catch (_) { return null; }
}
function loadWeeklyBaseline(dir, currentCapturedAt, rosterVersion = null) {
  const historyDir = path.join(dir, 'history');
  if (!fs.existsSync(historyDir)) return null;
  const current = new Date(currentCapturedAt).getTime();
  if (!Number.isFinite(current)) return null;
  const candidates = fs.readdirSync(historyDir)
    .filter(file => file.endsWith('.json'))
    .map(file => parseHistoryFile(path.join(historyDir, file)))
    .filter(Boolean)
    .filter(item => !rosterVersion || item.payload?.meta?.rosterVersion === rosterVersion)
    .map(item => Object.assign(item, { ageDays: (current - item.at) / DAY_MS }))
    .filter(item => item.ageDays >= GROWTH_MIN_DAYS && item.ageDays <= GROWTH_MAX_DAYS)
    .sort((a, b) => Math.abs(a.ageDays - GROWTH_TARGET_DAYS) - Math.abs(b.ageDays - GROWTH_TARGET_DAYS));
  return candidates[0] || null;
}

async function main() {
  const registryPath = arg('--registry', 'handles.json');
  const outDir = arg('--out', 'data');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  /*
   * The active platform set lives in the registry rather than in an exception
   * here, so turning TikTok on is a reviewed data change with confirmed handles
   * behind it — not a code edit made in a hurry.
   */
  const allowed = registry.activePlatforms || ['instagram'];
  const platforms = arg('--platforms', allowed.join(',')).split(',').map(value => value.trim()).filter(Boolean);
  const unsupported = platforms.filter(platform => !allowed.includes(platform));
  if (unsupported.length) {
    throw new Error(`${unsupported.join(', ')} is not in registry.activePlatforms (${allowed.join(', ')}). Confirm handles and enable it there first.`);
  }
  const allowSample = has('--allow-sample');
  const useCaptured = has('--captured');
  if (!process.env.APIFY_TOKEN && !allowSample && !useCaptured) {
    console.error('\n[ingest] STOPPED — no APIFY_TOKEN. Live data only; no placeholders written.\n');
    process.exit(2);
  }

  const useLive = !!process.env.APIFY_TOKEN && !useCaptured;
  const source = useLive ? 'live' : useCaptured ? 'captured' : 'sample';
  /*
   * A replay must wear the timestamp of the capture it replays. Stamping stored
   * captures with today's date would silently shift the 30-day window forward
   * over days nobody measured, turning "we have no data for last week" into
   * "nobody posted last week".
   */
  const asOf = arg('--as-of', null);
  if (asOf && !useCaptured) throw new Error('--as-of only applies to a --captured replay.');
  if (asOf && !Number.isFinite(Date.parse(asOf))) throw new Error(`--as-of needs an ISO timestamp, got ${asOf}`);
  const capturedAt = asOf || new Date().toISOString();
  const latestPath = path.join(outDir, 'latest.json');
  let previousSnapshot = null;
  try { previousSnapshot = JSON.parse(fs.readFileSync(latestPath, 'utf8')); } catch (_) { /* first live run */ }
  if (previousSnapshot?.meta?.capturedAt && Array.isArray(previousSnapshot.records)) {
    const historical = POST_CACHE.loadHistorySnapshots(path.join(outDir, 'history'), {
      before: previousSnapshot.meta.capturedAt,
      rosterVersion: registry.rosterVersion,
    });
    previousSnapshot.records = POST_CACHE.recoverRecords(
      previousSnapshot.records,
      historical,
      previousSnapshot.meta.capturedAt,
    );
  }
  const provider = useCaptured
    ? new CapturedProvider(path.join(outDir, 'raw'))
    : useLive ? new ApifyProvider(undefined, { previousSnapshot, capturedAt }) : new MockProvider();
  const baseline = loadWeeklyBaseline(outDir, capturedAt, registry.rosterVersion);
  const { records, states, relevantCount } = await run(
    registry, provider, platforms, capturedAt,
    useLive ? { rawDir: path.join(outDir, 'raw') } : {},
  );

  const nowMs = new Date(capturedAt).getTime();
  const baselineDays = baseline ? (nowMs - baseline.at) / DAY_MS : null;
  const trend = baseline ? growth(baseline.payload.records, records, { baselineDays }) : [];
  const leaderboards = buildLeaderboards(records, platforms, {
    now: nowMs,
    windowDays: WINDOW_DAYS,
    growth: trend,
    alternateWindows: [SHORT_WINDOW_DAYS],
  });
  const content = buildContentIntelligence(records, 'instagram', { now: nowMs, days: WINDOW_DAYS });
  const people = buildPeople(records, registry, content, leaderboards, nowMs, WINDOW_DAYS);
  const expectedPulls = registry.employees.filter(employee => (
    employee.dashboardRelevant !== false && employee.confirmed === true && employee.optOut !== true && employee.handles?.instagram
  )).length;
  const resolvedProfiles = records.filter(record => record.resolved && !record.isPrivate).length;
  const completeProfiles = leaderboards.instagram?.coverage?.completeWindowProfiles || 0;
  const requiredResolved = expectedPulls ? Math.ceil(expectedPulls * 0.8) : 0;
  const requiredComplete = resolvedProfiles ? Math.ceil(resolvedProfiles * 0.8) : 0;

  const usagePath = path.join(outDir, 'apify-usage.json');
  let usageLedger = useLive
    ? U.appendTelemetry(U.loadLedger(usagePath), provider.telemetry, capturedAt)
    : U.loadLedger(usagePath);
  const recordedTelemetryEvents = provider.telemetry?.events?.length || 0;
  const usageSummary = U.currentSummary(usageLedger, capturedAt);

  if (useLive && (resolvedProfiles < requiredResolved || completeProfiles < requiredComplete)) {
    const providerError = states.unresolved.find(item => item.error)?.error ||
      records.find(record => record.fetchMeta?.postsQueryError)?.fetchMeta?.postsQueryError ||
      `coverage ${resolvedProfiles}/${expectedPulls} profiles and ${completeProfiles}/${resolvedProfiles} complete windows`;
    U.atomicWrite(usagePath, usageLedger);
    writeRefreshStatus(outDir, {
      schemaVersion: 1,
      outcome: 'preserved',
      attemptedAt: capturedAt,
      lastValidSnapshotAt: previousSnapshot?.meta?.validation?.status === 'passed' ? previousSnapshot.meta.capturedAt : null,
      reason: safeError(providerError),
      dataPreserved: true,
      resolvedProfiles,
      expectedProfiles: expectedPulls,
      completeProfiles,
      usage: usageSummary,
    });
    writeGithubOutput({ published: 'false', preserved: 'true' });
    console.warn(`[ingest] provider refresh could not clear coverage gates; preserved the validated ${previousSnapshot?.meta?.capturedAt || 'existing'} snapshot`);
    console.warn(`[ingest] ${safeError(providerError)}`);
    return;
  }

  const brand = await runBrandAccounts(registry, provider, capturedAt, useLive ? { rawDir: path.join(outDir, 'raw') } : {});
  if (useLive) {
    usageLedger = U.appendTelemetry(usageLedger, {
      events: (provider.telemetry?.events || []).slice(recordedTelemetryEvents),
    }, capturedAt);
  }
  const payload = {
    meta: {
      company: registry.company,
      orn: registry.orn,
      rosterVersion: registry.rosterVersion,
      rosterSourceSha256: registry.sourceSha256,
      measurementVersion: 3,
      capturedAt,
      source,
      provider: useCaptured ? 'Apify captured run' : useLive ? 'Apify' : 'mock',
      platforms,
      relevantCount,
      resolvedProfiles,
      cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30',
      cadenceWindowDays: WINDOW_DAYS,
      postLookbackDays: INSTAGRAM_POST_LOOKBACK_DAYS,
      postResultsLimitPerProfile: INSTAGRAM_POST_RESULTS_LIMIT,
      profileActor: PROFILE_ACTOR,
      postsActor: POSTS_ACTOR,
      validation: {
        status: 'pending',
        validatorVersion: 2,
        snapshotCapturedAt: capturedAt,
        rosterVersion: registry.rosterVersion,
      },
      note: source === 'sample'
        ? 'SAMPLE data for layout testing only.'
        : source === 'captured'
          ? `Recomputed from the stored provider captures of ${capturedAt}. Every number is real public data from that pull; it is not a fresh capture.`
          : 'Live public Instagram profile details plus a dedicated date-bounded posts pull. Production remains Instagram-only.',
      replay: useCaptured
        ? { of: capturedAt, rawSource: path.join(outDir, 'raw'), reason: 'Recomputed from stored captures against the current roster.' }
        : null,
      trendAvailable: trend.length > 0,
      growthBaselineAt: baseline?.payload?.meta?.capturedAt || null,
      growthBaselineDays: baselineDays,
      growthWindowRule: 'Baseline must be 5–11 days old and use the same confirmed roster; nearest to 7 days is used and normalized to a weekly rate.',
      shortWindowDays: SHORT_WINDOW_DAYS,
      optedOut: states.optedOut.length,
      targets: registry.targets || DEFAULT_TARGETS,
      timezone: content.timezone,
      brandAccounts: brand.length,
      providerTelemetry: provider.telemetry
        ? Object.assign({}, provider.telemetry, {
          monthly: U.currentSummary(usageLedger, capturedAt),
          costNote: 'Run ids and exact charges are retained when Apify reports them; the dashboard warns before the configured monthly soft limit.',
        })
        : null,
    },
    records,
    leaderboards,
    states,
    trend,
    content,
    people,
    brand,
  };

  fs.mkdirSync(path.join(outDir, 'history'), { recursive: true });
  const pendingPath = path.join(outDir, '.latest.pending.json');
  fs.writeFileSync(pendingPath, JSON.stringify(payload, null, 2));
  fs.renameSync(pendingPath, latestPath);
  const stamp = capturedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, 'history', `${stamp}.json`), JSON.stringify({ meta: payload.meta, records }, null, 2));

  /*
   * The trend file is the only history the dashboard reads. It carries numbers
   * and no post bodies, so a year of four-day captures stays very small.
   */
  const seriesPath = path.join(outDir, 'series.json');
  const existingSeries = fs.existsSync(seriesPath)
    ? JSON.parse(fs.readFileSync(seriesPath, 'utf8'))
    : emptySeries();
  const series = appendSnapshot(existingSeries, records, capturedAt, WINDOW_DAYS, platforms, brand, registry.rosterVersion || null);
  const seriesPending = path.join(outDir, '.series.pending.json');
  fs.writeFileSync(seriesPending, JSON.stringify(series));
  fs.renameSync(seriesPending, seriesPath);

  if (useLive) {
    U.atomicWrite(usagePath, usageLedger);
    writeRefreshStatus(outDir, {
      schemaVersion: 1,
      outcome: 'success',
      attemptedAt: capturedAt,
      lastValidSnapshotAt: capturedAt,
      reason: null,
      dataPreserved: false,
      resolvedProfiles,
      expectedProfiles: expectedPulls,
      completeProfiles,
      usage: U.currentSummary(usageLedger, capturedAt),
    });
  }
  writeGithubOutput({ published: 'true', preserved: 'false' });

  const coverage = payload.leaderboards.instagram?.coverage;
  console.log(`[ingest] ${source} ${platforms.join('+')} snapshot @ ${capturedAt} — ${payload.meta.resolvedProfiles} profiles, ${coverage?.completeWindowProfiles || 0} complete cadence windows, ${Object.keys(series.profiles).length} tracked in series`);
  if (provider.telemetry) {
    console.log(`[ingest] actor runs: ${provider.telemetry.runs} (${provider.telemetry.failedRuns} failed, ${provider.telemetry.retries} retried) in ${Math.round(provider.telemetry.totalMs / 1000)}s`);
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = {
  run, runBrandAccounts, buildPeople, benchmarksFrom, loadWeeklyBaseline,
  GROWTH_TARGET_DAYS, GROWTH_MIN_DAYS, GROWTH_MAX_DAYS, SHORT_WINDOW_DAYS, DEFAULT_TARGETS,
};
