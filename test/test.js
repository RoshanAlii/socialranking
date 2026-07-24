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

  console.log('\nNORMALIZATION');
  await test('takenAtTimestamp is normalized', () => {
    const normalized = N.normalizePost({ id: 'x', takenAtTimestamp: Math.floor(nowMs / 1000) }, 'instagram');
    assert.strictEqual(normalized.postedAt, now);
  });
  await test('foreign authors and duplicates are removed', () => {
    const raw = {
      followersCount: 1000, postsCount: 100,
      _postsQuerySucceeded: true, _postsLookbackDays: 31, _postsResultLimit: 200,
      recentPosts: [rawPost(1), rawPost(1), rawPost(2, { ownerUsername: 'other' })],
    };
    const r = N.normalizeRecord({ name: 'A', role: 'C', platform: 'instagram', handle: 'a' }, raw, now);
    assert.strictEqual(r.recentPosts.length, 1);
    assert.strictEqual(r.fetchMeta.duplicatePostCount, 1);
  });

  console.log('\nPROVIDER');
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

  console.log('\nLEADERBOARD CROSS-CHECK');
  await test('postingFrequency stores the explicit formula inputs', () => {
    const board = R.postingFrequency([rec()], 'instagram', nowMs);
    assert.strictEqual(board[0].postsInWindow, 31);
    assert.strictEqual(board[0].formula, '31 × 7 ÷ 30');
    assert.ok(Math.abs(board[0].postsPerWeek - (31 * 7 / 30)) < 1e-12);
  });
  await test('snapshot validator independently recomputes every cadence row', () => {
    const records = [rec()];
    const leaderboards = R.buildLeaderboards(records, ['instagram'], { now: nowMs });
    const snapshot = {
      meta: {
        source: 'live', provider: 'Apify', measurementVersion: 3, platforms: ['instagram'],
        capturedAt: now, relevantCount: 1, resolvedProfiles: 1,
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
      meta: { source: 'live', provider: 'Apify', measurementVersion: 3, platforms: ['instagram'], capturedAt: now, relevantCount: 1, resolvedProfiles: 1, cadenceFormula: 'postsPerWeek = unique authored Instagram posts in the last 30 days × 7 ÷ 30' },
      records, leaderboards,
    };
    const registry = { employees: [{ name: 'A', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a' } }] };
    assert.throws(() => validateSnapshot(snapshot, registry, { now, maxAgeHours: null, rawExists: () => true }), /stored cadence/);
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
