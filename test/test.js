'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeRecord } = require('../src/normalize');
const R = require('../src/rank');
const { MockProvider, apifyInput, groupApifyItems, INSTAGRAM_RESULTS_LIMIT } = require('../src/provider');
const { run, loadWeeklyBaseline } = require('../src/ingest');

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.stack || e.message}`); fail++; }
}

const now = '2026-07-23T12:00:00.000Z';
const nowMs = Date.parse(now);
const day = 86400000;
function post(i, interactions = 100) {
  return {
    id: `p${i}`,
    type: 'reel',
    likes: interactions,
    comments: 10,
    shares: 5,
    views: 1000,
    postedAt: new Date(nowMs - i * day).toISOString(),
  };
}
function rec(over = {}) {
  const recentPosts = Array.from({ length: 36 }, (_, i) => post(i, 100 + i));
  return Object.assign({
    name: 'A', role: 'Consultant', platform: 'instagram', handle: 'a',
    capturedAt: now, resolved: true, isPrivate: false,
    followers: 10000, following: 500, postCount: 36,
    recentPosts,
    fetchMeta: { requestedLimit: 100, rawPostCount: 36, authoredPostCount: 36 },
  }, over);
}

(async () => {
  console.log('\nNORMALIZATION');
  await t('missing profile stays unresolved', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'instagram', handle: 'x' }, null, now);
    assert.strictEqual(r.resolved, false);
    assert.strictEqual(r.followers, null);
  });
  await t('fetch metadata is retained', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'instagram', handle: 'x' }, {
      followersCount: 1000, postsCount: 2, _fetchLimit: 100,
      latestPosts: [{ ownerUsername: 'x', timestamp: now, likesCount: 10 }, { ownerUsername: 'other', timestamp: now, likesCount: 99 }],
    }, now);
    assert.strictEqual(r.fetchMeta.requestedLimit, 100);
    assert.strictEqual(r.fetchMeta.rawPostCount, 2);
    assert.strictEqual(r.fetchMeta.authoredPostCount, 1);
    assert.strictEqual(r.recentPosts.length, 1);
  });

  console.log('\n30-DAY FAIRNESS');
  await t('complete coverage requires feed to reach cutoff', () => {
    assert.strictEqual(R.windowCoverage(rec(), nowMs).complete, true);
    const partial = rec({ postCount: 500, recentPosts: [post(0), post(1), post(2)], fetchMeta: { authoredPostCount: 3 } });
    assert.strictEqual(R.windowCoverage(partial, nowMs).complete, false);
  });
  await t('partial feeds are excluded from cadence and engagement', () => {
    const partial = rec({ name: 'Partial', postCount: 500, recentPosts: [post(0), post(1), post(2)], fetchMeta: { authoredPostCount: 3 } });
    assert.strictEqual(R.engagementLeaderboard([partial], 'instagram', nowMs).length, 0);
    assert.strictEqual(R.postingFrequency([partial], 'instagram', nowMs).length, 0);
  });
  await t('engagement requires at least three posts', () => {
    const two = rec({ name: 'Two', postCount: 2, recentPosts: [post(0), post(1)], fetchMeta: { authoredPostCount: 2 } });
    assert.strictEqual(R.windowCoverage(two, nowMs).complete, true);
    assert.strictEqual(R.engagementLeaderboard([two], 'instagram', nowMs).length, 0);
    const three = rec({ name: 'Three', postCount: 3, recentPosts: [post(0), post(1), post(2)], fetchMeta: { authoredPostCount: 3 } });
    assert.strictEqual(R.engagementLeaderboard([three], 'instagram', nowMs).length, 1);
  });
  await t('pinned posts do not affect recent performance', () => {
    const r = rec({ recentPosts: [Object.assign(post(0, 999999), { isPinned: true }), post(1, 100), post(2, 100), post(3, 100), post(31, 100)], postCount: 5, fetchMeta: { authoredPostCount: 5 } });
    const board = R.engagementLeaderboard([r], 'instagram', nowMs);
    assert.strictEqual(board[0].typicalEngagement, 115);
  });
  await t('top post ignores incomplete profiles', () => {
    const fair = rec({ name: 'Fair', recentPosts: [post(0, 500), post(1, 200), post(31, 50)], postCount: 3, fetchMeta: { authoredPostCount: 3 } });
    const partial = rec({ name: 'Partial', recentPosts: [post(0, 50000)], postCount: 500, fetchMeta: { authoredPostCount: 1 } });
    assert.strictEqual(R.topPost([fair, partial], 'instagram', nowMs).name, 'Fair');
  });
  await t('composite requires all three measured metrics', () => {
    const eligible = rec({ name: 'Eligible' });
    const insufficient = rec({ name: 'Insufficient', postCount: 2, recentPosts: [post(0), post(1)], fetchMeta: { authoredPostCount: 2 } });
    const board = R.compositeLeaderboard([eligible, insufficient], undefined, nowMs);
    assert.strictEqual(board.find(x => x.name === 'Eligible').rank, 1);
    assert.strictEqual(board.find(x => x.name === 'Insufficient').rank, null);
  });

  console.log('\nINSTAGRAM INGESTION');
  await t('Instagram actor requests enough posts for a 30-day audit', () => {
    const input = apifyInput('instagram', ['a']);
    assert.strictEqual(input.resultsLimit, INSTAGRAM_RESULTS_LIMIT);
    assert.ok(input.resultsLimit >= 100);
  });
  await t('Apify grouping adds fetch metadata', () => {
    const found = groupApifyItems('instagram', ['a'], [{ username: 'a', followersCount: 1000, postsCount: 1, latestPosts: [{ ownerUsername: 'a' }] }]);
    const r = found.get('a');
    assert.strictEqual(r._fetchLimit, INSTAGRAM_RESULTS_LIMIT);
    assert.strictEqual(r._rawPostCount, 1);
  });
  await t('only requested Instagram platform is ingested', async () => {
    const registry = { employees: [{ name: 'A', role: 'C', dashboardRelevant: true, confirmed: true, handles: { instagram: 'a', tiktok: 'a', facebook: 'a' } }] };
    const out = await run(registry, new MockProvider(), ['instagram'], now);
    assert.deepStrictEqual([...new Set(out.records.map(r => r.platform))], ['instagram']);
  });

  console.log('\nWEEKLY GROWTH');
  await t('same-day and one-day snapshots are rejected as weekly baselines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirpa-history-'));
    fs.mkdirSync(path.join(dir, 'history'));
    fs.writeFileSync(path.join(dir, 'history', 'one.json'), JSON.stringify({ meta: { capturedAt: new Date(nowMs - day).toISOString() }, records: [rec()] }));
    assert.strictEqual(loadWeeklyBaseline(dir, now), null);
  });
  await t('nearest snapshot between five and nine days is selected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirpa-history-'));
    fs.mkdirSync(path.join(dir, 'history'));
    for (const d of [5.2, 7.1, 8.8]) {
      fs.writeFileSync(path.join(dir, 'history', `${d}.json`), JSON.stringify({ meta: { capturedAt: new Date(nowMs - d * day).toISOString() }, records: [rec()] }));
    }
    const b = loadWeeklyBaseline(dir, now);
    assert.ok(Math.abs(b.ageDays - 7.1) < 0.01);
  });
  await t('growth math uses matching Instagram handles', () => {
    const g = R.growth([rec({ followers: 1000 })], [rec({ followers: 1100 })]);
    assert.strictEqual(g[0].followerDelta, 100);
    assert.ok(Math.abs(g[0].followerPct - 0.1) < 1e-9);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
