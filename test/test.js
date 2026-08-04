'use strict';

const assert = require('assert');
const { normalizeRecord } = require('../src/normalize');
const R = require('../src/rank');
const { propose, slugCandidates } = require('../src/resolver');
const { MockProvider } = require('../src/provider');
const { run } = require('../src/ingest');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
const now = '2026-07-21T00:00:00.000Z';

function rec(over = {}) {
  return Object.assign({
    name: 'A', role: 'Consultant', platform: 'instagram', handle: 'a',
    capturedAt: now, resolved: true, isPrivate: false,
    followers: 10000, following: 500, postCount: 100,
    recentPosts: [
      { id: 'p1', type: 'reel', likes: 1000, comments: 100, shares: 50, views: 40000, postedAt: '2026-07-14T00:00:00Z' },
      { id: 'p2', type: 'image', likes: 500, comments: 20, shares: 0, views: null, postedAt: '2026-07-07T00:00:00Z' },
    ],
  }, over);
}

(async () => {
  console.log('\nNORMALIZE');
  await t('missing raw -> unresolved shell, no invented numbers', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'tiktok', handle: 'x' }, null, now);
    assert.strictEqual(r.resolved, false);
    assert.strictEqual(r.followers, null);
    assert.deepStrictEqual(r.recentPosts, []);
  });
  await t('private account -> shell with counts, no media', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'instagram', handle: 'x' },
      { isPrivate: true, followers: 3000, recentPosts: [{ likeCount: 9 }] }, now);
    assert.strictEqual(r.isPrivate, true);
    assert.strictEqual(r.followers, 3000);
    assert.strictEqual(r.recentPosts.length, 0);
  });
  await t('tolerates varied field names + string numbers', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'tiktok', handle: 'x' },
      { fansCount: '12,345', recentPosts: [{ diggCount: 10, playCount: 500, createTime: 1720000000 }] }, now);
    assert.strictEqual(r.followers, 12345);
    assert.strictEqual(r.recentPosts[0].likes, 10);
    assert.strictEqual(r.recentPosts[0].views, 500);
    assert.strictEqual(r.recentPosts[0].type, 'video');
    assert.ok(r.recentPosts[0].postedAt.startsWith('2024'));
  });

  console.log('\nRANK - exclusion & correctness');
  await t('private and unresolved are excluded from rankings', () => {
    const records = [rec({ name: 'A', followers: 5000 }), rec({ name: 'B', followers: 9000, isPrivate: true }), rec({ name: 'C', followers: 20000, resolved: false })];
    const board = R.mostFollowers(records, 'instagram');
    assert.strictEqual(board.length, 1);
    assert.strictEqual(board[0].name, 'A');
  });
  await t('followers ranked desc with correct rank numbers', () => {
    const board = R.mostFollowers([rec({ name: 'A', followers: 100 }), rec({ name: 'B', followers: 300 }), rec({ name: 'C', followers: 200 })], 'instagram');
    assert.deepStrictEqual(board.map(x => x.name), ['B', 'C', 'A']);
    assert.deepStrictEqual(board.map(x => x.rank), [1, 2, 3]);
  });
  await t('ties share a rank', () => {
    const board = R.mostFollowers([rec({ name: 'A', followers: 200 }), rec({ name: 'B', followers: 200 }), rec({ name: 'C', followers: 100 })], 'instagram');
    assert.strictEqual(board[0].rank, 1); assert.strictEqual(board[1].rank, 1); assert.strictEqual(board[2].rank, 3);
  });

  console.log('\nRANK - engagement math');
  await t('engagementRate = avg interactions per post / followers', () => {
    assert.ok(Math.abs(R.engagementRate(rec()) - 0.0835) < 1e-9);
  });
  await t('views are NOT counted as engagement', () => {
    const b = R.avgEngagementPerPost(rec({ recentPosts: [{ likes: 1000, comments: 100, shares: 50, views: 999999, postedAt: now }] }));
    assert.strictEqual(b, 1150);
  });
  await t('zero followers does not divide-by-zero', () => {
    assert.strictEqual(R.engagementRate(rec({ followers: 0 })), null);
  });
  await t('no posts -> engagement excluded, not zero-ranked', () => {
    const board = R.engagementLeaderboard([rec({ name: 'A' }), rec({ name: 'B', recentPosts: [] })], 'instagram');
    assert.deepStrictEqual(board.map(x => x.name), ['A']);
  });

  console.log('\nRANK - video, comments, cadence, composite');
  await t('topVideo picks highest views among videos/reels only', () => {
    const records = [
      rec({ name: 'A', recentPosts: [{ id: 'v', type: 'reel', views: 5000, likes: 1, comments: 1, postedAt: now }] }),
      rec({ name: 'B', recentPosts: [{ id: 'w', type: 'reel', views: 90000, likes: 1, comments: 1, postedAt: now }] }),
      rec({ name: 'C', recentPosts: [{ id: 'img', type: 'image', views: 999999, likes: 1, comments: 1, postedAt: now }] }),
    ];
    const top = R.topVideo(records, 'instagram');
    assert.strictEqual(top.name, 'B'); assert.strictEqual(top.post.views, 90000);
  });
  await t('mostCommented picks highest comment count', () => {
    const top = R.mostCommented([rec({ name: 'A', recentPosts: [{ comments: 5, postedAt: now }] }), rec({ name: 'B', recentPosts: [{ comments: 900, postedAt: now }] })], 'instagram');
    assert.strictEqual(top.name, 'B');
  });
  await t('postsPerWeek reflects cadence', () => {
    const r = rec({ recentPosts: [{ postedAt: '2026-07-01T00:00:00Z' }, { postedAt: '2026-07-08T00:00:00Z' }, { postedAt: '2026-07-15T00:00:00Z' }] });
    assert.ok(Math.abs(R.postsPerWeek(r) - 1.5) < 1e-9);
  });
  await t('composite is bounded and ranks everyone once', () => {
    const board = R.compositeLeaderboard([rec({ name: 'A', followers: 50000 }), rec({ name: 'B', followers: 1000, platform: 'tiktok' })]);
    assert.strictEqual(board.length, 2);
    assert.ok(board.every(r => r.score >= 0 && r.score <= 1));
    assert.strictEqual(board[0].rank, 1);
  });

  console.log('\nRANK - growth needs two snapshots');
  await t('single snapshot -> no fabricated trend', () => { assert.deepStrictEqual(R.growth([], [rec()]), []); });
  await t('two snapshots -> follower delta', () => {
    const g = R.growth([rec({ name: 'A', followers: 10000 })], [rec({ name: 'A', followers: 12000 })]);
    assert.strictEqual(g[0].followerDelta, 2000);
    assert.ok(Math.abs(g[0].followerPct - 0.2) < 1e-9);
  });

  console.log('\nRESOLVER - proposes, never confirms');
  await t('propose always returns verified:false', async () => {
    const p = await propose('Riya Bhardwaj', 'instagram', { searchFn: async () => [{ handle: 'riya.kirpa', name: 'Riya Bhardwaj', bio: 'Kirpa Properties', followers: 8000 }] });
    assert.strictEqual(p.verified, false);
    assert.strictEqual(p.candidates[0].handle, 'riya.kirpa');
    assert.strictEqual(p.candidates[0].confidence, 'high');
  });
  await t('no searchFn -> no candidates, only slug guesses', async () => {
    const p = await propose('Barkha Kalia', 'tiktok', {});
    assert.strictEqual(p.candidates.length, 0);
    assert.ok(p.guesses.length > 0);
  });
  await t('slug candidates derive from the name', () => { assert.ok(slugCandidates('Manpreet Kaur').includes('manpreet.kaur')); });

  console.log('\nINGEST - states & honesty gate');
  await t('unconfirmed handles are never pulled', async () => {
    const registry = { company: 'K', orn: '1', employees: [{ name: 'A', role: 'C', dashboardRelevant: true, handles: { instagram: 'a', tiktok: null, facebook: null }, confirmed: false }] };
    const { records, states } = await run(registry, new MockProvider(), ['instagram'], now);
    assert.strictEqual(records[0].resolved, false);
    assert.strictEqual(states.unconfirmed.length, 1);
  });
  await t('confirmed handle IS pulled; back-office excluded', async () => {
    const registry = { company: 'K', orn: '1', employees: [
      { name: 'A', role: 'Consultant', dashboardRelevant: true, handles: { instagram: 'a', tiktok: null, facebook: null }, confirmed: true },
      { name: 'Acc', role: 'Accountant', dashboardRelevant: false, handles: { instagram: null, tiktok: null, facebook: null }, confirmed: false },
    ] };
    const { records, states } = await run(registry, new MockProvider(), ['instagram'], now);
    const a = records.find(r => r.name === 'A');
    assert.strictEqual(a.resolved, true); assert.ok(a.followers > 0);
    assert.strictEqual(states.excludedBackOffice.length, 1);
  });
  await t('private handle surfaces as state, not a ranking', async () => {
    const registry = { company: 'K', orn: '1', employees: [{ name: 'P', role: 'Consultant', dashboardRelevant: true, handles: { instagram: 'p', tiktok: null, facebook: null }, confirmed: true }] };
    const { records, states } = await run(registry, new MockProvider({ privateHandles: ['p'] }), ['instagram'], now);
    assert.strictEqual(states.private.length, 1);
    assert.strictEqual(R.mostFollowers(records, 'instagram').length, 0);
  });

  console.log('\nLIVE-ONLY - refuses to fabricate');
  await t('ingest exits non-zero without APIFY_TOKEN', async () => {
    const { execFileSync } = require('child_process');
    const env = Object.assign({}, process.env); delete env.APIFY_TOKEN;
    let code = 0;
    try { execFileSync(process.execPath, ['src/ingest.js'], { env, cwd: require('path').join(__dirname, '..'), stdio: 'pipe' }); }
    catch (e) { code = e.status; }
    assert.strictEqual(code, 2, 'expected exit code 2 when no token is present');
  });
  await t('shipped data is real, sourced from a live capture', () => {
    const fs = require('fs'), path = require('path');
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'latest.json'), 'utf8'));
    assert.strictEqual(d.meta.source, 'live', 'shipped snapshot must be live, never sample');
    assert.ok(/apify/.test(d.meta.provider), 'provider must be apify');
    // Every follower number present must trace back to a captured raw payload.
    for (const r of d.records.filter(r => r.followers !== null)) {
      const raw = path.join(__dirname, '..', 'data', 'raw', `${r.platform}_${r.handle}.json`);
      assert.ok(fs.existsSync(raw), `metric for ${r.handle} has no captured source file`);
    }
  });
  await t('dashboard ships without a bundled sample blob', () => {
    const h = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(!/const SAMPLE_DATA = \{/.test(h), 'index.html must not embed placeholder data');
  });
  await t('founder handles are confirmed across all three platforms', () => {
    const reg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'handles.json'), 'utf8'));
    const m = reg.employees.find(e => e.name === 'Manpreet Kaur');
    assert.strictEqual(m.confirmed, true);
    assert.strictEqual(m.handles.instagram, 'manpreet.kirpa');
    assert.strictEqual(m.handles.tiktok, 'manpreet.kirpa');
    assert.ok(m.handles.facebook, 'facebook Page id expected');
  });

  console.log('\nREAL-DATA GUARDS - found via live Apify pull');
  await t('zero followers on an active account becomes null, not zero', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'tiktok', handle: 'x' },
      { fans: 0, video: 2183, posts: [{ diggCount: 500, createTimeISO: now, author: 'x' }] }, now);
    assert.strictEqual(r.followers, null, 'must not record a false zero');
    assert.ok(r.warnings.some(w => /follower count unavailable/.test(w)));
  });
  await t('a false zero can never be ranked last or divide engagement', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'tiktok', handle: 'x' },
      { fans: 0, video: 10, posts: [{ diggCount: 5, createTimeISO: now, author: 'x' }] }, now);
    assert.strictEqual(R.mostFollowers([r], 'tiktok').length, 0);
    assert.strictEqual(R.engagementRate(r), null);
  });
  await t('posts authored by another account are excluded', () => {
    const r = normalizeRecord({ name: 'X', role: 'C', platform: 'instagram', handle: 'mine' },
      { followersCount: 100, latestPosts: [
        { shortCode: 'a', likesCount: 10, ownerUsername: 'mine', timestamp: now },
        { shortCode: 'b', likesCount: 99999, ownerUsername: 'someonelse', timestamp: now }] }, now);
    assert.strictEqual(r.recentPosts.length, 1);
    assert.strictEqual(r.recentPosts[0].id, 'a');
    assert.ok(r.warnings.some(w => /another account/.test(w)));
  });
  await t('pinned posts are excluded from posting cadence', () => {
    const posts = [
      { postedAt: '2024-01-01T00:00:00Z', isPinned: true },
      { postedAt: '2026-07-20T00:00:00Z' }, { postedAt: '2026-07-21T00:00:00Z' }];
    const withPin = R.postsPerWeek({ recentPosts: posts });
    assert.ok(withPin >= 2, 'an old pinned post must not stretch the window');
  });
  await t('losing follower count does not erase video performance', () => {
    const r = { name: 'X', role: 'C', platform: 'tiktok', handle: 'x', resolved: true, isPrivate: false,
      followers: null, recentPosts: [{ type: 'video', views: 5000, comments: 10, likes: 1, postedAt: now }] };
    assert.ok(R.topVideo([r], 'tiktok'), 'top video should still rank');
    assert.ok(R.mostCommented([r], 'tiktok'), 'most commented should still rank');
    assert.strictEqual(R.mostFollowers([r], 'tiktok').length, 0, 'follower board should still exclude');
  });
  await t('real captured Instagram payload parses to real numbers', () => {
    const raw = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'raw', 'instagram_manpreet.kirpa.json'), 'utf8'));
    const r = normalizeRecord({ name: 'Manpreet Kaur', role: 'Founder/CEO', platform: 'instagram', handle: 'manpreet.kirpa' }, raw, now);
    assert.strictEqual(r.followers, 724016);
    assert.strictEqual(r.recentPosts.length, 11); // 12 fetched, 1 authored by another account
    assert.ok(R.engagementRate(r) > 0);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
