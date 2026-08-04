'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const N = require('../src/normalize');
const R = require('../src/rank');
const P = require('../src/provider');
const { run, loadWeeklyBaseline } = require('../src/ingest');
const { validateSnapshot } = require('../src/validate-snapshot');
const { rebuildDerived } = require('../src/rebuild-derived');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}\n${error.stack || error.message}`); failed++; }
}
const now = '2026-07-24T00:00:00.000Z';
const nowMs = Date.parse(now);
const day = 86400000;
function rawPost(i, over = {}) {
  return Object.assign({
    id: `p${i}`,
    ownerUsername: 'a',
    type: 'Image',
    likesCount: 100,
    commentsCount: 10,
    timestamp: new Date(nowMs - i * day).toISOString(),
    url: `https://instagram.com/p/p${i}/`,
  }, over);
}
function post(i, over = {}) {
  return Object.assign({
    id: `p${i}`,
    ownerUsername: 'a',
    type: 'image',
    likes: 100,
    comments: 10,
    shares: null,
    postedAt: new Date(nowMs - i * day).toISOString(),
    url: `https://instagram.com/p/p${i}/`,
  }, over);
}
function rec(over = {}) {
  const recentPosts = Array.from({ length: 31 }, (_, i) => post(i));
  return Object.assign({
    name: 'A', role: 'Consultant', platform: 'instagram', handle: 'a',
    capturedAt: now, resolved: true, isPrivate: false,
    followers: 10000, following: 100, postCount: 500,
    recentPosts,
    fetchMeta: {
      profileSource: P.PROFILE_ACTOR,
      postSource: P.POSTS_ACTOR,
      postsQuerySucceeded: true,
      postsLookbackDays: 31,
      postsResultLimit: 200,
      postsTruncated: false,
      postsOwnershipComplete: true,
      missingOwnerCount: 0,
      rawPostCount: 31,
      authoredPostCount: 31,
      duplicatePostCount: 0,
    },
  }, over);
}

(async () => {
  console.log('\nFORMULA AND WINDOW');
  await test('formula is N × 7 ÷ 30', () => {
    const r = rec({ recentPosts: Array.from({ length: 8 }, (_, i) => post(i)), fetchMeta: Object.assign({}, rec().fetchMeta, { authoredPostCount: 8, rawPostCount: 8 }) });
    assert.strictEqual(R.windowCoverage(r, nowMs).complete, true);
    assert.ok(Math.abs(R.postsPerWeek(r, nowMs) - (8 * 7 / 30)) < 1e-12);
  });
  await test('window is based on snapshot time, not browser current time', () => {
    const r = rec({ recentPosts: [post(0), post(29), post(30), post(31)] });
    assert.deepStrictEqual(R.windowPosts(r, nowMs).map(x => x.id), ['p0', 'p29', 'p30']);
  });
  await test('recent pinned posts count; old pinned posts do not', () => {
    const r = rec({ recentPosts: [post(1, { id: 'recent-pin', isPinned: true }), post(31, { id: 'old-pin', isPinned: true })] });
    assert.deepStrictEqual(R.windowPosts(r, nowMs).map(x => x.id), ['recent-pin']);
  });
  await test('duplicates count once', () => {
    const duplicate = post(1);
    const r = rec({ recentPosts: [duplicate, Object.assign({}, duplicate)] });
    assert.strictEqual(R.windowPosts(r, nowMs).length, 1);
    assert.ok(Math.abs(R.postsPerWeek(r, nowMs) - 7 / 30) < 1e-12);
  });
  await test('missing public interaction values stay unknown', () => {
    assert.strictEqual(R.postEngagement(post(1, { likes: null })), null);
    const r = rec({ recentPosts: [
      post(1),
      post(2),
      post(3),
      post(4, { comments: null }),
    ] });
    assert.strictEqual(R.comparableWindowPosts(r, nowMs).length, 3);
    assert.strictEqual(R.engagementRate(r, nowMs), 110 / 10000);
  });

  console.log('\nACCURACY GATE');
  await test('old 12-post profile snapshot is rejected', () => {
    const r = rec({
      name: 'Manpreet Kaur',
      postCount: 2105,
      recentPosts: Array.from({ length: 8 }, (_, i) => post(i)),
      fetchMeta: { authoredPostCount: 8, rawPostCount: 12, postsQuerySucceeded: false },
    });
    assert.strictEqual(R.windowCoverage(r, nowMs).complete, false);
    assert.strictEqual(R.postsPerWeek(r, nowMs), null);
  });
  await test('successful date-bounded non-truncated query is complete, including zero posts', () => {
    const r = rec({ recentPosts: [], fetchMeta: Object.assign({}, rec().fetchMeta, { authoredPostCount: 0, rawPostCount: 0 }) });
    assert.strictEqual(R.windowCoverage(r, nowMs).complete, true);
    assert.strictEqual(R.postsPerWeek(r, nowMs), 0);
  });
  await test('truncated query is rejected if it does not reach cutoff', () => {
    const r = rec({
      recentPosts: Array.from({ length: 200 }, (_, i) => post(i / 10)),
      fetchMeta: Object.assign({}, rec().fetchMeta, { postsTruncated: true, postsResultLimit: 200, authoredPostCount: 200 }),
    });
    assert.strictEqual(R.windowCoverage(r, nowMs).complete, false);
  });
  await test('truncated query is accepted if it reaches cutoff', () => {
    const rows = Array.from({ length: 200 }, (_, i) => post(i * 31 / 199));
    const r = rec({ recentPosts: rows, fetchMeta: Object.assign({}, rec().fetchMeta, { postsTruncated: true, postsResultLimit: 200, authoredPostCount: 200 }) });
    assert.strictEqual(R.windowCoverage(r, nowMs).complete, true);
  });
  await test('post coverage is rejected when ownership is incomplete', () => {
    const r = rec({ fetchMeta: Object.assign({}, rec().fetchMeta, { postsOwnershipComplete: false }) });
    assert.strictEqual(R.windowCoverage(r, nowMs).complete, false);
  });

  console.log('\nNORMALIZATION');
  await test('negative provider count sentinels stay unknown', () => {
    const normalized = N.normalizePost(rawPost(1, { likesCount: -1, commentsCount: 5 }), 'instagram');
    assert.strictEqual(normalized.likes, null);
    assert.strictEqual(normalized.comments, 5);
  });
  await test('takenAtTimestamp is normalized', () => {
    const normalized = N.normalizePost({ id: 'x', takenAtTimestamp: Math.floor(nowMs / 1000) }, 'instagram');
    assert.strictEqual(normalized.postedAt, now);
  });
  await test('foreign authors and duplicates are removed', () => {
    const raw = {
      followersCount: 1000, postsCount: 100,
      _postsQuerySucceeded: true, _postsOwnershipComplete: true,
      _postsLookbackDays: 31, _postsResultLimit: 200,
      recentPosts: [rawPost(1), rawPost(1), rawPost(2, { ownerUsername: 'other' })],
    };
    const r = N.normalizeRecord({ name: 'A', role: 'C', platform: 'instagram', handle: 'a' }, raw, now);
    assert.strictEqual(r.recentPosts.length, 1);
    assert.strictEqual(r.fetchMeta.duplicatePostCount, 1);
  });

  console.log('\nPROVIDER');
  await test('default post concurrency stays below Apify account memory capacity', () => {
    assert.ok(P.POST_FETCH_CONCURRENCY <= 3);
    assert.strictEqual(new P.ApifyProvider('token').postConcurrency, P.POST_FETCH_CONCURRENCY);
  });
  await test('post actor input uses dedicated posts mode and 31-day filter', () => {
    const input = P.instagramPostsInput('a');
    assert.strictEqual(input.resultsType, 'posts');
    assert.strictEqual(input.onlyPostsNewerThan, '31 days');
    assert.ok(input.resultsLimit >= 200);
  });
  await test('provider merges profile details with one date-bounded post query per handle', async () => {
    const calls = [];
    const runSync = async (actor, input) => {
      calls.push({ actor, input });
      if (actor === P.PROFILE_ACTOR) return [{ username: 'a', followersCount: 1000, postsCount: 50 }];
      return [rawPost(1)];
    };
    const provider = new P.ApifyProvider('token', { runSync, postConcurrency: 1 });
    const result = await provider.fetchProfiles('instagram', ['a']);
    const raw = result.get('a');
    assert.strictEqual(raw.followersCount, 1000);
    assert.strictEqual(raw.recentPosts.length, 1);
    assert.strictEqual(raw._postsQuerySucceeded, true);
    assert.strictEqual(calls.filter(c => c.actor === P.POSTS_ACTOR).length, 1);
  });
  await test('provider rejects post rows with unverifiable owners', async () => {
    const runSync = async actor => actor === P.PROFILE_ACTOR
      ? [{ username: 'a', followersCount: 1000, postsCount: 50 }]
      : [rawPost(1, { ownerUsername: null })];
    const provider = new P.ApifyProvider('token', { runSync, postConcurrency: 1 });
    const raw = (await provider.fetchProfiles('instagram', ['a'])).get('a');
    assert.strictEqual(raw._postsQuerySucceeded, false);
    assert.strictEqual(raw._postsOwnershipComplete, false);
    assert.strictEqual(raw.recentPosts.length, 0);
  });

  console.log('\nLEADERBOARD CROSS-CHECK');
  await test('postingFrequency stores the explicit formula inputs', () => {
    const board = R.postingFrequency([rec()], 'instagram', nowMs);
    assert.strictEqual(board[0].postsInWindow, 31);
    assert.strictEqual(board[0].formula, '31 × 7 ÷ 30');
    assert.ok(Math.abs(board[0].postsPerWeek - (31 * 7 / 30)) < 1e-12);
  });
  await test('topVideo ignores higher-interaction images', () => {
    const r = rec({ recentPosts: [
      post(1, { id: 'image', type: 'image', likes: 1000 }),
      post(2, { id: 'video', type: 'video', likes: 100 }),
      post(3, { id: 'reel', type: 'reel', likes: 200 }),
    ] });
    assert.strictEqual(R.topVideo([r], 'instagram', nowMs).post.id, 'reel');
  });
  await test('content records keep likes, comments, and views as separate facts', () => {
    const r = rec({ recentPosts: [
      post(1, { id: 'liked', type: 'image', likes: 900, comments: 20 }),
      post(2, { id: 'commented', type: 'carousel', likes: 100, comments: 250 }),
      post(3, { id: 'viewed', type: 'reel', likes: 80, comments: 10, views: 5000 }),
    ] });
    assert.strictEqual(R.mostLiked([r], 'instagram', nowMs).post.id, 'liked');
    assert.strictEqual(R.mostCommented([r], 'instagram', nowMs).post.id, 'commented');
    assert.strictEqual(R.mostViewed([r], 'instagram', nowMs).post.id, 'viewed');
  });
  await test('per-profile analytics recompute totals, medians, mix, and coverage', () => {
    const r = rec({ followers: 1000, recentPosts: [
      post(1, { id: 'a', type: 'image', likes: 100, comments: 10 }),
      post(2, { id: 'b', type: 'carousel', likes: 300, comments: 5 }),
      post(3, { id: 'c', type: 'reel', likes: 50, comments: 50, views: 1000 }),
      post(4, { id: 'd', type: 'video', likes: 20, comments: 100, views: 500 }),
    ] });
    const analytics = R.profileAnalytics([r], 'instagram', nowMs)[0];
    assert.strictEqual(analytics.postsInWindow, 4);
    assert.strictEqual(analytics.totalLikes, 470);
    assert.strictEqual(analytics.totalComments, 165);
    assert.strictEqual(analytics.medianLikes, 75);
    assert.strictEqual(analytics.medianComments, 30);
    assert.strictEqual(analytics.medianInteractions, 115);
    assert.strictEqual(analytics.interactionRate, 0.115);
    assert.strictEqual(analytics.videoCount, 2);
    assert.strictEqual(analytics.carouselCount, 1);
    assert.strictEqual(analytics.imageCount, 1);
    assert.strictEqual(analytics.totalShares, null);
    assert.deepStrictEqual(analytics.metricCoverage, {
      posts: 4, likes: 4, comments: 4, shares: 0, videos: 2, videoViews: 2,
    });
  });
  await test('team format analytics never mixes unsupported values into zero', () => {
    const r = rec({ recentPosts: [
      post(1, { id: 'a', type: 'image', likes: 100, comments: 10, views: null }),
      post(2, { id: 'b', type: 'image', likes: 200, comments: null, views: null }),
      post(3, { id: 'c', type: 'reel', likes: 50, comments: 5, views: 1000 }),
    ] });
    const formats = new Map(R.formatAnalytics([r], 'instagram', nowMs).map(row => [row.type, row]));
    assert.strictEqual(formats.get('image').posts, 2);
    assert.strictEqual(formats.get('image').comparablePosts, 1);
    assert.strictEqual(formats.get('image').medianInteractions, 110);
    assert.strictEqual(formats.get('image').medianViews, null);
    assert.strictEqual(formats.get('reel').medianViews, 1000);
  });
  await test('fresh normalized records can rebuild every derived analytics field', () => {
    const snapshot = {
      meta: {
        source: 'live',
        measurementVersion: 3,
        capturedAt: now,
        growthBaselineAt: null,
      },
      records: [rec()],
      leaderboards: {},
      trend: [],
    };
    rebuildDerived(snapshot, null, () => ({
      followersCount: 1000,
      postsCount: 1,
      _postsQuerySucceeded: true,
      _postsOwnershipComplete: true,
      _postsLookbackDays: 31,
      _postsResultLimit: 200,
      recentPosts: [rawPost(1, { likesCount: -1, commentsCount: 5 })],
    }));
    assert.strictEqual(snapshot.meta.validation.status, 'pending');
    assert.strictEqual(snapshot.leaderboards.instagram.analytics.length, 1);
    assert.strictEqual(snapshot.records[0].recentPosts[0].likes, null);
    assert.ok(snapshot.leaderboards.instagram.mostCommented);
    assert.ok(snapshot.leaderboards.instagram.formatAnalytics.length > 0);
  });
  await test('snapshot validator independently recomputes every cadence row', () => {
    const records = [rec()];
    const leaderboards = R.buildLeaderboards(records, ['instagram'], { now: nowMs });
    const snapshot = {
      meta: {
        source: 'live', provider: 'Apify', measurementVersion: 3, platforms: ['instagram'],
        capturedAt: now, relevantCount: 1, resolvedProfiles: 1, trendAvailable: false,
        cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30',
      },
      records, leaderboards,
    };
    const registry = { employees: [{ name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }] };
    const summary = validateSnapshot(snapshot, registry, { now, maxAgeHours: null, rawExists: () => true });
    assert.strictEqual(summary.cadenceRowsCrosschecked, 1);
  });
  await test('validator catches a tampered cadence value', () => {
    const records = [rec()];
    const leaderboards = R.buildLeaderboards(records, ['instagram'], { now: nowMs });
    leaderboards.instagram.postingFrequency[0].postsPerWeek = 999;
    const snapshot = {
      meta: { source: 'live', provider: 'Apify', measurementVersion: 3, platforms: ['instagram'], capturedAt: now, relevantCount: 1, resolvedProfiles: 1, trendAvailable: false, cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30' },
      records, leaderboards,
    };
    const registry = { employees: [{ name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }] };
    assert.throws(() => validateSnapshot(snapshot, registry, { now, maxAgeHours: null, rawExists: () => true }), /stored leaderboards/);
  });
  await test('validator catches a tampered momentum score', () => {
    const records = [rec()];
    const leaderboards = R.buildLeaderboards(records, ['instagram'], { now: nowMs });
    leaderboards.combined.composite[0].score = 999;
    const snapshot = {
      meta: { source: 'live', provider: 'Apify', measurementVersion: 3, platforms: ['instagram'], capturedAt: now, relevantCount: 1, resolvedProfiles: 1, trendAvailable: false, cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30' },
      records, leaderboards, trend: [],
    };
    const registry = { employees: [{ name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }] };
    assert.throws(() => validateSnapshot(snapshot, registry, { now, maxAgeHours: null }), /stored leaderboards/);
  });

  console.log('\nINGEST AND GROWTH');
  await test('only Instagram is ingested', async () => {
    const registry = { employees: [{ name: 'A', role: 'C', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }] };
    const output = await run(registry, new P.MockProvider(), ['instagram'], now);
    assert.deepStrictEqual([...new Set(output.records.map(r => r.platform))], ['instagram']);
  });
  await test('weekly baseline must be 5-9 days old and nearest seven', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirpa-history-'));
    fs.mkdirSync(path.join(dir, 'history'));
    for (const age of [1, 5.5, 7.2, 8.8]) {
      fs.writeFileSync(path.join(dir, 'history', `${age}.json`), JSON.stringify({ meta: { capturedAt: new Date(nowMs - age * day).toISOString() }, records: [rec()] }));
    }
    const baseline = loadWeeklyBaseline(dir, now);
    assert.ok(Math.abs(baseline.ageDays - 7.2) < 0.001);
  });
  await test('growth is normalized to a seven-day equivalent and ranked by percentage', () => {
    const previous = [
      rec({ name: 'Large', handle: 'large', followers: 10000 }),
      rec({ name: 'Small', handle: 'small', followers: 100 }),
    ];
    const current = [
      rec({ name: 'Large', handle: 'large', followers: 10100 }),
      rec({ name: 'Small', handle: 'small', followers: 110 }),
    ];
    const rows = R.growth(previous, current, { baselineDays: 5 });
    assert.strictEqual(rows[0].name, 'Small');
    assert.strictEqual(rows[0].baselineDays, 5);
    assert.ok(Math.abs(rows.find(row => row.name === 'Large').followerDelta - 140) < 1e-12);
  });

  console.log('\nRELEASE GUARDS');
  await test('published workflow runs and stamps the full validator', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'weekly.yml'), 'utf8');
    assert.match(workflow, /node src\/validate-snapshot\.js --stamp/);
    assert.match(workflow, /cron: "0 4 \* \* \*"/);
  });
  await test('dashboard requires roster lock, validator v2, and a 36-hour freshness gate', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /validation\?\.status === 'passed'/);
    assert.match(html, /validatorVersion === 2/);
    assert.match(html, /MAX_PUBLIC_AGE_HOURS = 36/);
    assert.match(html, /snapshotMatchesRoster/);
  });
  await test('published roster exactly reflects the 2026-07-30 Kirpa workbook corrections', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'handles.json'), 'utf8'));
    const byName = new Map(registry.employees.map(employee => [employee.name, employee]));
    assert.strictEqual(registry.rosterVersion, '2026-07-30-kirpa-workbook-v1');
    assert.strictEqual(registry.rosterRowCount, 44);
    assert.strictEqual(registry.employees.length, 44);
    for (const name of ['Riya Bhardwaj', 'Sleeja Misra', 'Anmol Singh']) {
      assert.strictEqual(byName.get(name).handles.instagram, null);
      assert.strictEqual(byName.get(name).confirmed, false);
    }
    for (const [name, handle] of [
      ['Sara Banu', 'sarafaisal.kirpa'],
      ['Nikita Lal Tekwani', 'nikitaa.kirpa'],
      ['Samaksh Malhotra', 'samaksh.kirpa'],
      ['Janisha Puri', 'janisha.kirpa'],
    ]) {
      assert.strictEqual(byName.get(name).handles.instagram, handle);
      assert.strictEqual(byName.get(name).confirmed, true);
    }
  });
  await test('validator rejects a snapshot stamped for a different roster version', () => {
    const records = [rec()];
    const snapshot = {
      meta: {
        source: 'live', provider: 'Apify', measurementVersion: 3, platforms: ['instagram'],
        capturedAt: now, relevantCount: 1, resolvedProfiles: 1, trendAvailable: false,
        cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30',
      },
      records,
      leaderboards: R.buildLeaderboards(records, ['instagram'], { now: nowMs }),
      trend: [],
    };
    const registry = {
      rosterVersion: 'current-roster',
      employees: [{ name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }],
    };
    assert.throws(() => validateSnapshot(snapshot, registry, { now, maxAgeHours: null }), /snapshot roster version missing/);
  });
  await test('legacy snapshots are rejected instead of ranked', () => {
    const records = [rec()];
    const snapshot = {
      meta: { source: 'live', provider: 'Apify', platforms: ['instagram'], capturedAt: now, relevantCount: 1, resolvedProfiles: 1, trendAvailable: false },
      records,
      leaderboards: R.buildLeaderboards(records, ['instagram'], { now: nowMs }),
      trend: [],
    };
    const registry = { employees: [{ name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }] };
    assert.throws(() => validateSnapshot(snapshot, registry, { maxAgeHours: null }), /measurementVersion must be 3/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
