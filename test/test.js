'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const N = require('../src/normalize');
const R = require('../src/rank');
const P = require('../src/provider');
const C = require('../src/content');
const SERIES = require('../src/series');
const { run, buildPeople, runBrandAccounts, loadWeeklyBaseline, SHORT_WINDOW_DAYS } = require('../src/ingest');
const ROSTER = require('../src/roster');
const { buildDigest } = require('../src/digest');
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

/*
 * The validator recomputes every published section, so a test snapshot has to
 * be the whole payload ingest writes — not a leaderboard with the derived
 * sections left off.
 */
function snapshotFor(records, registry, over = {}) {
  const trend = over.trend || [];
  const leaderboards = over.leaderboards || R.buildLeaderboards(records, ['instagram'], {
    now: nowMs, growth: trend, alternateWindows: [SHORT_WINDOW_DAYS],
  });
  const content = C.buildContentIntelligence(records, 'instagram', { now: nowMs, days: R.WINDOW_DAYS });
  return Object.assign({
    meta: Object.assign({
      source: 'live', provider: 'Apify', measurementVersion: 3, platforms: ['instagram'],
      capturedAt: now, relevantCount: 1, resolvedProfiles: 1, trendAvailable: trend.length > 0,
      cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30',
    }, over.meta || {}),
    records,
    leaderboards,
    trend,
    content,
    people: buildPeople(records, registry, content, leaderboards, nowMs, R.WINDOW_DAYS),
    brand: [],
  }, over.extra || {});
}
const soloRegistry = {
  employees: [{ name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }],
};

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
    const snapshot = snapshotFor([rec()], soloRegistry);
    const summary = validateSnapshot(snapshot, soloRegistry, { now, maxAgeHours: null, rawExists: () => true });
    assert.strictEqual(summary.cadenceRowsCrosschecked, 1);
  });
  await test('validator catches a tampered cadence value', () => {
    const snapshot = snapshotFor([rec()], soloRegistry);
    snapshot.leaderboards.instagram.postingFrequency[0].postsPerWeek = 999;
    assert.throws(() => validateSnapshot(snapshot, soloRegistry, { now, maxAgeHours: null, rawExists: () => true }), /stored leaderboards/);
  });
  await test('validator catches a tampered momentum score', () => {
    const snapshot = snapshotFor([rec()], soloRegistry);
    snapshot.leaderboards.combined.composite[0].score = 999;
    assert.throws(() => validateSnapshot(snapshot, soloRegistry, { now, maxAgeHours: null }), /stored leaderboards/);
  });
  await test('validator catches tampered content intelligence and coaching', () => {
    const hashtagged = rec({
      recentPosts: Array.from({ length: 31 }, (_, i) => post(i, { caption: 'tour #dubai #offplan' })),
    });
    const snapshot = snapshotFor([hashtagged], soloRegistry);
    snapshot.content.timing.best = { day: 0, dayName: 'Sunday', block: 'evening', blockLabel: '19:00–22:00', posts: 99, medianRate: 9 };
    assert.throws(() => validateSnapshot(snapshot, soloRegistry, { now, maxAgeHours: null }), /content intelligence/);

    const second = snapshotFor([hashtagged], soloRegistry);
    second.people[0].nextActions = [{ priority: 1, action: 'Buy followers.', because: 'invented' }];
    assert.throws(() => validateSnapshot(second, soloRegistry, { now, maxAgeHours: null }), /next actions/);
  });
  await test('validator rejects an opted-out person reappearing in the data', () => {
    const registry = {
      employees: [
        { name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } },
        { name: 'B', dashboardRelevant: true, optOut: true, handles: {} },
      ],
    };
    const optedOut = Object.assign(rec({ name: 'B', handle: null }), { optOut: true, resolved: false, recentPosts: [] });
    const snapshot = snapshotFor([rec(), optedOut], registry, {
      meta: { relevantCount: 2, resolvedProfiles: 1, optedOut: 1 },
    });
    validateSnapshot(snapshot, registry, { now, maxAgeHours: null });

    const leaky = snapshotFor([rec(), Object.assign(rec({ name: 'B', handle: 'b' }), { optOut: true })], registry, {
      meta: { relevantCount: 2, resolvedProfiles: 1, optedOut: 1 },
    });
    assert.throws(() => validateSnapshot(leaky, registry, { now, maxAgeHours: null }), /opted out but a profile was still fetched/);
  });
  await test('validator recomputes every trend-series point it publishes', () => {
    const records = [rec()];
    const registry = Object.assign({ rosterVersion: 'roster-a' }, soloRegistry);
    const snapshot = snapshotFor(records, registry, { meta: { rosterVersion: 'roster-a' } });
    const series = SERIES.appendSnapshot(SERIES.emptySeries(), records, now, R.WINDOW_DAYS, ['instagram'], [], 'roster-a');
    validateSnapshot(snapshot, registry, { now, maxAgeHours: null, series });
    series.profiles['instagram::a'].points[0].postsPerWeek = 99;
    assert.throws(
      () => validateSnapshot(snapshot, registry, { now, maxAgeHours: null, series }),
      /trend series point does not match/,
    );
  });
  await test('a trend point measured against another roster is rejected', () => {
    const records = [rec()];
    const registry = Object.assign({ rosterVersion: 'roster-b' }, soloRegistry);
    const snapshot = snapshotFor(records, registry, { meta: { rosterVersion: 'roster-b' } });
    const stale = SERIES.appendSnapshot(SERIES.emptySeries(), records, now, R.WINDOW_DAYS, ['instagram'], [], 'roster-a');
    assert.throws(
      () => validateSnapshot(snapshot, registry, { now, maxAgeHours: null, series: stale }),
      /stamped for roster roster-a/,
    );
  });
  await test('only the validator marks a trend point as validated', () => {
    const records = [rec()];
    const series = SERIES.appendSnapshot(SERIES.emptySeries(), records, now, R.WINDOW_DAYS, ['instagram'], [], 'roster-a');
    assert.strictEqual(series.profiles['instagram::a'].points[0].validated, false, 'ingest can never self-certify');
    const { series: stamped, stamped: count } = SERIES.stampValidated(series, now);
    assert.strictEqual(stamped.profiles['instagram::a'].points[0].validated, true);
    assert.strictEqual(stamped.team.instagram[0].validated, true);
    assert.strictEqual(count, 2);
    const other = SERIES.stampValidated(series, '2020-01-01T00:00:00.000Z');
    assert.strictEqual(other.stamped, 0, 'a different capture is never stamped by association');
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

  console.log('\nTREND SERIES');
  await test('series keeps one point per capture day and never invents a rate', () => {
    const complete = rec();
    const partial = rec({ fetchMeta: Object.assign({}, rec().fetchMeta, { postsQuerySucceeded: false }) });
    let series = SERIES.appendSnapshot(SERIES.emptySeries(), [complete], now, R.WINDOW_DAYS, ['instagram']);
    series = SERIES.appendSnapshot(series, [partial], now, R.WINDOW_DAYS, ['instagram']);
    const points = SERIES.profileHistory(series, 'instagram', 'a');
    assert.strictEqual(points.length, 1, 'a same-day recapture replaces rather than duplicates');
    assert.strictEqual(points[0].complete, false);
    assert.strictEqual(points[0].postsPerWeek, null, 'an unprovable window records no cadence');
    assert.strictEqual(points[0].followers, 10000, 'followers stay because they are observed directly');
  });
  await test('series carries a real trend across captures and stays small', () => {
    let series = SERIES.emptySeries();
    for (const [index, followers] of [1000, 1100, 1250].entries()) {
      const at = new Date(nowMs - (2 - index) * 7 * day).toISOString();
      series = SERIES.appendSnapshot(series, [rec({ followers, capturedAt: at })], at, R.WINDOW_DAYS, ['instagram']);
    }
    const points = SERIES.profileHistory(series, 'instagram', 'a');
    assert.deepStrictEqual(points.map(point => point.followers), [1000, 1100, 1250]);
    const change = SERIES.changeOver(points, 'followers', 7);
    assert.strictEqual(change.delta, 150);
    assert.ok(JSON.stringify(series).length < 4000, 'three captures stay tiny next to a 1 MB snapshot');
  });
  await test('a change over a window is withheld when no baseline sits in that window', () => {
    const points = [
      { at: new Date(nowMs - 40 * day).toISOString(), followers: 100 },
      { at: now, followers: 200 },
    ];
    assert.strictEqual(SERIES.changeOver(points, 'followers', 7), null);
    assert.ok(SERIES.changeOver(points, 'followers', 40));
  });

  console.log('\nCONTENT INTELLIGENCE');
  await test('a hashtag is judged against its own posters, not against the team', () => {
    /*
     * #small is used only by two tiny, naturally high-engagement accounts, so
     * its raw rate is the best on the board while telling nobody anything.
     * #boost is used by two large accounts and doubles what those same accounts
     * normally achieve. Ranking by rate crowns #small; ranking by lift over the
     * poster's own baseline — which is what a third person could actually copy —
     * crowns #boost.
     */
    const large = [1, 2, 3].map(index => rec({
      name: `Large${index}`, handle: `large${index}`, followers: 100000,
      recentPosts: [
        ...Array.from({ length: 3 }, (_, i) => post(i, { likes: 4000, comments: 0, caption: 'launch day #boost' })),
        ...Array.from({ length: 3 }, (_, i) => post(i + 10, { likes: 2000, comments: 0, caption: 'ordinary post' })),
      ],
    }));
    const small = [1, 2, 3].map(index => rec({
      name: `Small${index}`, handle: `small${index}`, followers: 1000,
      recentPosts: Array.from({ length: 6 }, (_, i) => post(i, { likes: 100, comments: 0, caption: 'hello #small #solo' })),
    }));
    const rows = C.hashtagPerformance([...large, ...small], 'instagram', nowMs);
    const boost = rows.find(row => row.tag === 'boost');
    const tiny = rows.find(row => row.tag === 'small');
    assert.strictEqual(rows[0].tag, 'boost', 'the tag that beat its own posters wins');
    assert.ok(tiny.medianRate > boost.medianRate, 'even though the other tag shows a higher raw rate');
    assert.ok(boost.authorLift > 1.3 && tiny.authorLift === 1, 'lift is measured against each author, not the team');
    assert.strictEqual(boost.posts, 9);
    assert.strictEqual(boost.profiles, 3);
    assert.ok(rows.every(row => row.posts >= C.MIN_POSTS_PER_HASHTAG && row.profiles >= C.MIN_PROFILES_PER_HASHTAG));
  });
  await test('timing analysis reports in Dubai time and withholds thin cells', () => {
    const posts = Array.from({ length: 8 }, (_, i) => post(i, {
      // 17:00Z is 21:00 in Dubai — the evening block of the following local hour set.
      postedAt: new Date(Date.UTC(2026, 6, 5 + i, 17, 0, 0)).toISOString(),
    }));
    const timing = C.timingPerformance([rec({ recentPosts: posts })], 'instagram', Date.UTC(2026, 6, 20));
    assert.match(timing.timezone, /Dubai/);
    assert.ok(timing.byBlock.every(row => row.block === 'evening'), '17:00Z lands in the Dubai evening block');
    const thin = C.timingPerformance([rec({ recentPosts: [posts[0]] })], 'instagram', Date.UTC(2026, 6, 20));
    assert.strictEqual(thin.best, null, 'one post is not a best time to post');
  });
  await test('streaks and quiet time come from the gated window', () => {
    const weekly = rec({
      recentPosts: [0, 3, 8, 15, 22].map(offset => post(offset, { postedAt: new Date(nowMs - offset * day).toISOString() })),
    });
    const cadence = C.postingWeeks(weekly, nowMs);
    assert.strictEqual(cadence.weeksMeasured, 4);
    assert.strictEqual(cadence.currentStreakWeeks, 4);
    assert.strictEqual(C.daysSinceLastPost(weekly, nowMs), 0);

    const gap = rec({ recentPosts: [post(12, { postedAt: new Date(nowMs - 12 * day).toISOString() })] });
    assert.strictEqual(C.postingWeeks(gap, nowMs).currentStreakWeeks, 0);
    assert.strictEqual(C.daysSinceLastPost(gap, nowMs), 12);

    const unprovable = rec({ fetchMeta: Object.assign({}, rec().fetchMeta, { postsQuerySucceeded: false }) });
    assert.strictEqual(C.postingWeeks(unprovable, nowMs), null);
  });
  await test('goal progress is null rather than zero when the window is unprovable', () => {
    const targets = { postsPerWeek: 3, engagementRate: 0.02 };
    const met = C.goalProgress(rec(), {}, targets, nowMs);
    assert.strictEqual(met.goals.find(goal => goal.metric === 'postsPerWeek').met, true);
    const blind = C.goalProgress(
      rec({ fetchMeta: Object.assign({}, rec().fetchMeta, { postsQuerySucceeded: false }) }), {}, targets, nowMs,
    );
    assert.ok(blind.goals.every(goal => goal.met === null && goal.progress === null));
    assert.strictEqual(blind.measurableCount, 0);
    const override = C.targetsFor({ targets: { postsPerWeek: 5 } }, targets);
    assert.strictEqual(override.postsPerWeek, 5);
    assert.strictEqual(override.engagementRate, 0.02);
  });
  await test('next actions carry the number that produced them and stay silent without data', () => {
    const silent = rec({ recentPosts: [post(20, { postedAt: new Date(nowMs - 20 * day).toISOString() })] });
    const actions = C.nextActions(silent, { now: nowMs, targets: { postsPerWeek: 3 } });
    assert.ok(actions.length && actions.length <= 3);
    assert.match(actions[0].because, /\d/);
    assert.match(actions[0].action, /48 hours|Publish/);
    const unprovable = rec({ fetchMeta: Object.assign({}, rec().fetchMeta, { postsQuerySucceeded: false }) });
    assert.deepStrictEqual(C.nextActions(unprovable, { now: nowMs }), [], 'no advice from a partial feed');
  });

  console.log('\nSCORE, OPT-OUT AND WINDOWS');
  await test('follower growth joins the momentum score only when a baseline exists', () => {
    const records = [
      rec({ name: 'Steady', handle: 'steady', followers: 10000 }),
      rec({ name: 'Rising', handle: 'rising', followers: 10000 }),
    ];
    const withoutGrowth = R.buildLeaderboards(records, ['instagram'], { now: nowMs });
    assert.strictEqual(withoutGrowth.combined.growthIncluded, false);
    assert.deepStrictEqual(withoutGrowth.combined.weights, R.BASE_WEIGHTS);

    const trend = R.growth(
      [rec({ name: 'Steady', handle: 'steady', followers: 9990 }), rec({ name: 'Rising', handle: 'rising', followers: 9000 })],
      records,
      { baselineDays: 7 },
    );
    const withGrowth = R.buildLeaderboards(records, ['instagram'], { now: nowMs, growth: trend });
    assert.strictEqual(withGrowth.combined.growthIncluded, true);
    assert.ok(withGrowth.combined.weights.followerGrowth > 0);
    assert.ok(Math.abs(Object.values(withGrowth.combined.weights).reduce((a, b) => a + b, 0) - 1) < 1e-6);
    assert.strictEqual(withGrowth.combined.composite[0].name, 'Rising', 'improvement now moves the score');
    assert.strictEqual(withGrowth.combined.composite[0].handle, 'rising', 'a composite row can be joined to the other boards');
  });
  await test('a profile with no follower baseline is held, not scored as flat', () => {
    const records = [
      rec({ name: 'Known', handle: 'known', followers: 10000 }),
      rec({ name: 'New', handle: 'new', followers: 500 }),
    ];
    const trend = R.growth([rec({ name: 'Known', handle: 'known', followers: 9000 })], records, { baselineDays: 7 });
    const board = R.buildLeaderboards(records, ['instagram'], { now: nowMs, growth: trend });
    const held = board.combined.composite.find(row => row.name === 'New');
    assert.strictEqual(held.rank, null);
    assert.match(held.note, /no 5–9 day follower baseline/);
  });
  await test('a shorter window is recomputed from the same posts', () => {
    const board = R.buildLeaderboards([rec()], ['instagram'], { now: nowMs, alternateWindows: [7] });
    const week = board.alternateWindows['7'].instagram;
    assert.strictEqual(week.coverage.windowDays, 7);
    // The window is inclusive at both ends, so a daily poster shows 8 posts in
    // seven days and 31 in thirty — the same convention as the main board.
    assert.strictEqual(week.postingFrequency[0].postsInWindow, 8);
    assert.strictEqual(board.instagram.postingFrequency[0].postsInWindow, 31);
  });
  await test('an opted-out record is excluded from every board and analytic', () => {
    const records = [rec(), Object.assign(rec({ name: 'B', handle: 'b' }), { optOut: true })];
    const board = R.buildLeaderboards(records, ['instagram'], { now: nowMs });
    const serialized = JSON.stringify(board);
    assert.ok(!serialized.includes('"B"'), 'no leaderboard, record or analytic row mentions them');
    assert.strictEqual(board.instagram.analytics.length, 1);
    assert.strictEqual(R.isUsable(records[1]), false);
  });
  await test('ingest never fetches an opted-out profile', async () => {
    const asked = [];
    const provider = {
      async fetchProfile(platform, handle) { asked.push(handle); return { notFound: true }; },
    };
    const registry = {
      employees: [
        { name: 'A', role: 'C', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } },
        { name: 'B', role: 'C', dashboardRelevant: true, confirmed: true, optOut: true, handles: { instagram: 'b' } },
      ],
    };
    const output = await run(registry, provider, ['instagram'], now);
    assert.deepStrictEqual(asked, ['a']);
    assert.deepStrictEqual(output.states.optedOut, [{ name: 'B', platform: 'instagram' }]);
    assert.strictEqual(output.records.find(record => record.name === 'B').optOut, true);
  });
  await test('the company account is measured but never ranked', async () => {
    const registry = {
      brandAccounts: [{ name: 'Kirpa Properties', platform: 'instagram', handle: 'kirpa.properties', confirmed: true }],
      employees: [],
    };
    const brand = await runBrandAccounts(registry, new P.MockProvider(), now);
    assert.strictEqual(brand.length, 1);
    assert.strictEqual(brand[0].isBrand, true);
    assert.ok(brand[0].followers > 0);
    // The guarantee that matters is that the company account never reaches the
    // ranked record set, and the validator refuses a snapshot where it does.
    const snapshot = snapshotFor([rec()], soloRegistry, { extra: { brand } });
    validateSnapshot(snapshot, soloRegistry, { now, maxAgeHours: null });
    const leaked = snapshotFor(
      [rec(), rec({ name: 'Kirpa Properties', handle: 'kirpa.properties' })],
      { employees: soloRegistry.employees.concat([{ name: 'Kirpa Properties', dashboardRelevant: true, confirmed: true, handles: { instagram: 'kirpa.properties' } }]) },
      { extra: { brand }, meta: { relevantCount: 2, resolvedProfiles: 2 } },
    );
    assert.throws(
      () => validateSnapshot(leaked, { employees: leaked.records.map(record => ({ name: record.name, dashboardRelevant: true, confirmed: true, handles: { instagram: record.handle } })) }, { now, maxAgeHours: null }),
      /also appears in the ranked record set/,
    );
  });

  console.log('\nPROVIDER RESILIENCE AND SECOND PLATFORM');
  await test('a rate-limited run is retried and a bad request is not', async () => {
    assert.strictEqual(P.isRetryable({ statusCode: 429 }), true);
    assert.strictEqual(P.isRetryable({ statusCode: 503 }), true);
    assert.strictEqual(P.isRetryable({ statusCode: 400 }), false);
    assert.strictEqual(P.isRetryable(new Error('socket hang up')), true);

    let attempts = 0;
    const rows = await P.apifyRunSync('actor', {}, 'token', {
      backoffMs: 0,
      runOnce: async () => {
        attempts++;
        if (attempts < 3) throw Object.assign(new Error('Apify 429'), { statusCode: 429 });
        return [{ ok: true }];
      },
    });
    assert.strictEqual(attempts, 3);
    assert.strictEqual(rows.length, 1);

    let badRequests = 0;
    await assert.rejects(() => P.apifyRunSync('actor', {}, 'token', {
      backoffMs: 0,
      runOnce: async () => {
        badRequests++;
        throw Object.assign(new Error('Apify 400: bad input'), { statusCode: 400 });
      },
    }), /400/);
    assert.strictEqual(badRequests, 1, 'a wrong request is not paid for three times');
  });
  await test('actor runs are counted for cost tracing', async () => {
    const provider = new P.ApifyProvider('token', {
      runSync: async (actor, input, token, opts) => {
        const rows = actor === P.PROFILE_ACTOR
          ? [{ username: 'a', followersCount: 100 }]
          : [{ id: '1', ownerUsername: 'a', timestamp: now, likesCount: 1, commentsCount: 1 }];
        opts?.onAttempt?.({ actor, attempt: 1, ok: true, ms: 5, items: rows.length });
        return rows;
      },
    });
    await provider.fetchProfiles('instagram', ['a']);
    assert.strictEqual(provider.telemetry.runs, 2);
    assert.strictEqual(provider.telemetry.failedRuns, 0);
    assert.ok(provider.telemetry.byActor[P.POSTS_ACTOR].runs === 1);
  });
  await test('TikTok returns the same record shape through one date-bounded query', async () => {
    const provider = new P.ApifyProvider('token', {
      runSync: async (actor, input) => {
        assert.strictEqual(actor, P.TIKTOK_ACTOR);
        assert.deepStrictEqual(input.profiles, ['manpreet.kirpa']);
        assert.ok(input.oldestPostDateUnified, 'the query is bounded by date, not by a post count');
        return [{
          id: 'v1',
          createTimeISO: now,
          diggCount: 500,
          commentCount: 25,
          shareCount: 10,
          playCount: 9000,
          webVideoUrl: 'https://www.tiktok.com/@manpreet.kirpa/video/1',
          authorMeta: { name: 'manpreet.kirpa', fans: 447400, following: 12, video: 800 },
        }];
      },
    });
    const raw = (await provider.fetchProfiles('tiktok', ['manpreet.kirpa'])).get('manpreet.kirpa');
    assert.strictEqual(raw.followersCount, 447400);
    const record = N.normalizeRecord(
      { name: 'Manpreet Kaur', role: 'Founder', platform: 'tiktok', handle: 'manpreet.kirpa' }, raw, now,
    );
    assert.strictEqual(record.followers, 447400);
    assert.strictEqual(record.recentPosts[0].likes, 500);
    assert.strictEqual(record.recentPosts[0].views, 9000);
    assert.strictEqual(record.recentPosts[0].type, 'video');
    assert.strictEqual(R.postEngagement(record.recentPosts[0]), 525);
  });
  await test('a platform outside registry.activePlatforms cannot be ingested', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ingest.js'), 'utf8');
    assert.match(source, /registry\.activePlatforms/);
    assert.match(source, /is not in registry\.activePlatforms/);
    const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'handles.json'), 'utf8'));
    assert.deepStrictEqual(registry.activePlatforms, ['instagram']);
  });

  console.log('\nROSTER MAINTENANCE AND DIGEST');
  await test('the roster tool refuses a duplicate handle and clears confirmation on a change', () => {
    const registry = {
      rosterVersion: '2026-07-30-kirpa-workbook-v1',
      rosterRowCount: 2,
      employees: [
        { name: 'A', confirmed: true, sourcedFrom: 'bio', handles: { instagram: 'a' } },
        { name: 'B', confirmed: false, handles: { instagram: null } },
      ],
    };
    assert.deepStrictEqual(ROSTER.verify(registry), []);
    registry.employees[1].handles.instagram = 'a';
    assert.match(ROSTER.verify(registry).join(' '), /shared by A and B/);
    registry.employees[1].handles.instagram = null;
    registry.employees[1].confirmed = true;
    assert.match(ROSTER.verify(registry).join(' '), /confirmed but has no Instagram handle/);
  });
  await test('a roster change bumps the version that gates every stale snapshot', () => {
    const day0 = new Date().toISOString().slice(0, 10);
    assert.strictEqual(ROSTER.bumpVersion(`${day0}-kirpa-workbook-v1`), `${day0}-kirpa-workbook-v2`);
    assert.strictEqual(ROSTER.bumpVersion('2020-01-01-kirpa-workbook-v3'), `${day0}-kirpa-workbook-v1`);
  });
  await test('an opted-out person keeps no published handle', () => {
    const registry = {
      rosterVersion: '2026-07-30-kirpa-workbook-v1',
      rosterRowCount: 1,
      employees: [{ name: 'A', optOut: true, handles: { instagram: 'a' } }],
    };
    assert.match(ROSTER.verify(registry).join(' '), /opted out but a handle is still published/);
  });
  await test('the digest refuses to summarise an unvalidated or stale snapshot', () => {
    const registry = { rosterVersion: 'r1' };
    const stale = { meta: { capturedAt: new Date(Date.now() - 80 * 3600000).toISOString(), company: 'Kirpa', validation: { status: 'passed', validatorVersion: 2, rosterVersion: 'r1' } } };
    assert.strictEqual(buildDigest(stale, null, registry).ok, false);
    assert.match(buildDigest(stale, null, registry).text, /hours old/);
    const unvalidated = { meta: { capturedAt: new Date().toISOString(), validation: { status: 'pending' } } };
    assert.match(buildDigest(unvalidated, null, registry).text, /not passed the validator/);
  });
  await test('the digest reports only measured numbers when the snapshot is good', () => {
    const registry = { rosterVersion: 'r1' };
    const capturedAt = new Date().toISOString();
    const records = [rec({ capturedAt })];
    const series = SERIES.appendSnapshot(SERIES.emptySeries(), records, capturedAt, R.WINDOW_DAYS, ['instagram']);
    const snapshot = {
      meta: { company: 'Kirpa', capturedAt, validation: { status: 'passed', validatorVersion: 2, rosterVersion: 'r1' } },
      leaderboards: R.buildLeaderboards(records, ['instagram'], { now: Date.parse(capturedAt) }),
      trend: [],
      people: [{ name: 'A', windowComplete: true, daysSinceLastPost: 14 }],
      states: {},
    };
    const digest = buildDigest(snapshot, series, registry);
    assert.strictEqual(digest.ok, true);
    assert.match(digest.text, /Quiet accounts/);
    assert.match(digest.text, /A — 14 days since last post/);
  });

  console.log('\nRELEASE GUARDS');
  await test('published workflow runs and stamps the full validator', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'weekly.yml'), 'utf8');
    assert.match(workflow, /node src\/validate-snapshot\.js --stamp/);
    assert.match(workflow, /cron: "0 4 \* \* \*"/);
    assert.match(workflow, /cron: "0 16 \* \* \*"/, 'a second daily attempt keeps the 36-hour gate reachable');
    assert.match(workflow, /if: failure\(\)/, 'a silent failure looks exactly like a stalled board');
    assert.match(workflow, /node src\/roster\.js verify/);
    assert.ok(!/git add[^\n]*data\/raw/.test(workflow), 'raw captures are an artifact, not repository history');
    assert.match(workflow, /git add data\/latest\.json data\/history data\/series\.json/);
    const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    assert.match(ignore, /data\/raw\//);
  });
  await test('dashboard requires roster lock, validator v2, and a 36-hour freshness gate', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /validation\?\.status === 'passed'/);
    assert.match(html, /validatorVersion === 2/);
    assert.match(html, /MAX_PUBLIC_AGE_HOURS = 36/);
    assert.match(html, /snapshotMatchesRoster/);
  });
  await test('a replay is validated on everything except freshness', () => {
    const records = [rec()];
    const capturedAt = new Date(Date.now() - 9 * day).toISOString();
    const aged = [rec({ capturedAt, recentPosts: Array.from({ length: 31 }, (_, i) => post(i, {
      postedAt: new Date(Date.parse(capturedAt) - i * day).toISOString(),
    })) })];
    const snapshot = snapshotFor(aged, soloRegistry, {
      meta: { source: 'captured', capturedAt, replay: { of: capturedAt } },
      leaderboards: R.buildLeaderboards(aged, ['instagram'], {
        now: Date.parse(capturedAt), alternateWindows: [SHORT_WINDOW_DAYS],
      }),
    });
    snapshot.content = C.buildContentIntelligence(aged, 'instagram', { now: Date.parse(capturedAt), days: R.WINDOW_DAYS });
    snapshot.people = buildPeople(aged, soloRegistry, snapshot.content, snapshot.leaderboards, Date.parse(capturedAt), R.WINDOW_DAYS);

    // Without --replay the same snapshot is refused for not being live.
    assert.throws(() => validateSnapshot(snapshot, soloRegistry, {}), /source must be live/);
    // With it, freshness is waived and nothing else is.
    validateSnapshot(snapshot, soloRegistry, { replay: true });
    const unmarked = JSON.parse(JSON.stringify(snapshot));
    delete unmarked.meta.replay;
    assert.throws(
      () => validateSnapshot(unmarked, soloRegistry, { replay: true }),
      /must record the capture timestamp it replays/,
    );
    const tampered = JSON.parse(JSON.stringify(snapshot));
    tampered.leaderboards.instagram.postingFrequency[0].postsPerWeek = 42;
    assert.throws(
      () => validateSnapshot(tampered, soloRegistry, { replay: true }),
      /stored leaderboards/,
      'a replay is still recomputed in full',
    );
    assert.strictEqual(records.length, 1);
  });
  await test('an old board is dated rather than blanked, and only fresh data speaks in the present tense', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /const isFresh = \(\) =>[^\n]*MAX_PUBLIC_AGE_HOURS/, 'freshness is still a distinct, enforced idea');
    assert.match(html, /const isArchived = \(\) => isAudited\(\) && !isFresh\(\)/);
    assert.match(html, /Showing the validated board as of/, 'a dated board says so in the alert');
    assert.match(html, /What did we know on \$\{asOfLabel\(\)\}/, 'and in the headline');
    assert.match(html, /Led the normalized Instagram momentum score on/, 'and in the past tense');
    // Wrong data is still withheld outright; only old data is shown with a date.
    assert.match(html, /Roster changed · refresh required/);
    assert.match(html, /Snapshot verification required/);
  });
  await test('charts refuse points from a superseded roster or an unvalidated capture', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /point\.validated === true && point\.rosterVersion === REGISTRY\?\.rosterVersion/);
    assert.match(html, /setAsidePoints/, 'excluded captures are counted and reported, not hidden');
    assert.ok(
      /const teamPoints = \(\) => trustedPoints\(/.test(html) && /const profilePoints = handle => trustedPoints\(/.test(html),
      'every chart and sparkline reads through the trusted filter',
    );
  });
  await test('the post explorer never shows an opted-out or unprovable profile', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const body = html.slice(html.indexOf('function explorerRows()'), html.indexOf('function filteredExplorerRows()'));
    assert.match(body, /if \(!isAudited\(\)\) return \[\]/);
    assert.match(body, /record\.optOut === true/);
    assert.match(body, /audits\.get\(record\.handle\)\?\.complete/);
  });
  await test('the shorter window is read from the snapshot, never recomputed in the browser', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /DATA\?\.leaderboards\?\.alternateWindows\?\.\[String\(ACTIVE_WINDOW\)\]/);
    assert.match(html, /This snapshot predates the \$\{ACTIVE_WINDOW\}-day view/);
  });
  await test('the next move prefers the validated snapshot recommendation', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /const computed = personBlock\(person\.handle\)\?\.nextActions\?\.\[0\]/);
    assert.match(html, /Excluded at their own request/);
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
