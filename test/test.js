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
  await t('mostViewed still ranks views, and only among videos/reels', () => {
    const records = [
      rec({ name: 'A', recentPosts: [{ id: 'v', type: 'reel', views: 5000, likes: 1, comments: 1, postedAt: now }] }),
      rec({ name: 'B', recentPosts: [{ id: 'w', type: 'reel', views: 90000, likes: 1, comments: 1, postedAt: now }] }),
      rec({ name: 'C', recentPosts: [{ id: 'img', type: 'image', views: 999999, likes: 1, comments: 1, postedAt: now }] }),
    ];
    const top = R.mostViewed(records, 'instagram');
    assert.strictEqual(top.name, 'B'); assert.strictEqual(top.post.views, 90000);
  });
  await t('the headline post board ranks interactions, not view availability', () => {
    const records = [
      rec({ name: 'A', recentPosts: [{ id: 'v', type: 'reel', views: 900000, likes: 2, comments: 0, postedAt: now }] }),
      rec({ name: 'B', recentPosts: [{ id: 'w', type: 'reel', views: null, likes: 5000, comments: 400, postedAt: now }] }),
    ];
    const top = R.topPost(records, 'instagram', Date.parse(now));
    assert.strictEqual(top.name, 'B', 'B has far more interactions; missing views must not disqualify');
  });
  await t('mostCommented picks highest comment count', () => {
    const top = R.mostCommented([rec({ name: 'A', recentPosts: [{ comments: 5, postedAt: now }] }), rec({ name: 'B', recentPosts: [{ comments: 900, postedAt: now }] })], 'instagram');
    assert.strictEqual(top.name, 'B');
  });
  await t('postsPerWeek divides by the shared window, not the person\u2019s own span', () => {
    const N = Date.parse('2026-07-22T00:00:00Z');
    const r = rec({ recentPosts: [{ postedAt: '2026-07-01T00:00:00Z' }, { postedAt: '2026-07-08T00:00:00Z' }, { postedAt: '2026-07-15T00:00:00Z' }] });
    // 3 posts over a fixed 30-day window = 3 / (30/7) weeks.
    const expected = 3 / (R.WINDOW_DAYS / 7);
    assert.ok(Math.abs(R.postsPerWeek(r, N) - expected) < 1e-9,
      'got ' + R.postsPerWeek(r, N) + ', expected ' + expected);
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
  await t('pinned posts never count as recent activity', () => {
    const N = Date.parse('2026-07-22T00:00:00Z');
    // A pinned post sits at the top of a profile regardless of age. Counting it
    // would credit someone for activity they did not do in this window.
    const recentPin = [{ postedAt: '2026-07-19T00:00:00Z', isPinned: true },
                       { postedAt: '2026-07-20T00:00:00Z' }, { postedAt: '2026-07-21T00:00:00Z' }];
    assert.strictEqual(R.windowPosts({ recentPosts: recentPin }, N).length, 2,
      'the pinned post must be dropped even though it falls inside the window');
    const oldPin = [{ postedAt: '2024-01-01T00:00:00Z', isPinned: true },
                    { postedAt: '2026-07-20T00:00:00Z' }, { postedAt: '2026-07-21T00:00:00Z' }];
    assert.strictEqual(R.postsPerWeek({ recentPosts: oldPin }, N),
                       R.postsPerWeek({ recentPosts: recentPin }, N),
      'pinned age is irrelevant \u2014 the window is fixed either way');
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

  console.log('\nTIKTOK PAUSED + SUPPLIED HANDLES');
  await t('TikTok is excluded from the default weekly pull', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ingest.js'), 'utf8');
    const m = src.match(/arg\('--platforms',\s*'([^']+)'\)/);
    assert.ok(m, 'default platform list should be findable');
    assert.ok(!m[1].split(',').includes('tiktok'), 'tiktok must not be pulled while paused');
    assert.ok(m[1].split(',').includes('instagram'), 'instagram must still be pulled');
  });
  await t('dashboard gates TikTok behind a flag and shows an availability notice', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(/const TIKTOK_ENABLED = false;/.test(html), 'flag must be present and off');
    assert.ok(html.includes('Available soon'), 'roster must show the notice, not a bare dash');
    assert.ok(/LIVE_PLATFORMS/.test(html), 'aggregates must run off the filtered platform list');
    assert.ok(!/for\(const pf of \['instagram','tiktok','facebook'\]\)/.test(html),
      'no hard-coded platform loop may bypass the flag');
  });
  await t('TikTok handles stay null while paused', () => {
    const reg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'handles.json'), 'utf8'));
    const supplied = reg.employees.filter(e => e.name !== 'Manpreet Kaur' && e.handles.instagram);
    assert.ok(supplied.every(e => e.handles.tiktok === null), 'no new tiktok handles while paused');
  });
  await t('supplied Instagram handles are registered, confirmed and sourced', () => {
    const reg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'handles.json'), 'utf8'));
    const want = {
      'Dr. Jai Chatha': 'jai.kirpa', 'Kamalpreet Kaur': 'kamalpreet.kirpa',
      'Saloni Bedi': 'saloni.kirpa', 'Lipika Madan': 'lipika.kirpa',
      'Samaksh Malhotra': 'samaksh.kirpa' };
    for (const [name, handle] of Object.entries(want)) {
      const e = reg.employees.find(x => x.name === name);
      assert.ok(e, name + ' must exist in the registry');
      assert.strictEqual(e.handles.instagram, handle, name + ' handle');
      assert.strictEqual(e.confirmed, true, name + ' must be confirm-gated open');
      assert.ok(e.sourcedFrom, name + ' must record where the handle came from');
    }
  });
  await t('a handle that resolves to another company is rejected, not counted', () => {
    const reg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'handles.json'), 'utf8'));
    // Verified against the live bio: this handle is Priyanka Mehta of Danube
    // Properties, not Priyanka Jayanna of Kirpa. It must never reach a board.
    // She has since been matched to a real Kirpa account (priyanka.kirpa, company
    // email in bio). What must never come back is the Danube-branded handle.
    const anywhere = reg.employees.some(x => x.handles.instagram === 'priyanka.danubeproperties');
    assert.ok(!anywhere, 'the off-brand handle must not survive anywhere in the registry');
    const claimed = reg.employees.find(x => x.name === 'Priyanka Jayanna');
    assert.notStrictEqual(claimed.handles.instagram, 'priyanka.danubeproperties');
    if (claimed.confirmed) {
      assert.ok(/kirpaproperties\.com|@kirpa\.properties/.test(claimed.sourcedFrom),
        'her replacement handle must be justified by Kirpa-owned evidence');
    }
  });
  await t('no published number exists without a capture behind it', () => {
    // A newly confirmed handle legitimately has no data until the next pipeline run.
    // The invariant is the other direction: anything the dashboard SHOWS as resolved
    // must trace back to a real captured payload.
    const fs = require('fs'), path = require('path');
    const snap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'latest.json'), 'utf8'));
    for (const r of snap.records.filter(x => x.resolved)) {
      const f = path.join(__dirname, '..', 'data', 'raw', `${r.platform}_${r.handle}.json`);
      assert.ok(fs.existsSync(f), `${r.name} is published as resolved but has no capture at ${f}`);
    }
  });
  await t('handles awaiting their first pull are visible as pending, not as zero', () => {
    const fs = require('fs'), path = require('path');
    const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'handles.json'), 'utf8'));
    const snap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'latest.json'), 'utf8'));
    const published = new Set(snap.records.filter(r => r.resolved).map(r => r.handle));
    const pending = reg.employees.filter(e => e.confirmed && e.handles.instagram
                                         && !published.has(e.handles.instagram));
    // Pending is fine. Silently showing them with 0 followers would not be.
    for (const e of pending) {
      const rec = snap.records.find(r => r.name === e.name && r.platform === 'instagram');
      if (rec) assert.strictEqual(rec.followers, null,
        `${e.name} has not been pulled yet, so followers must be null - never 0`);
    }
  });
  await t('the weekly workflow exists and is scheduled', () => {
    const fs = require('fs'), path = require('path');
    const f = path.join(__dirname, '..', '.github', 'workflows', 'weekly.yml');
    assert.ok(fs.existsSync(f), 'without this file nothing ever refreshes the dashboard');
    const y = fs.readFileSync(f, 'utf8');
    assert.ok(/schedule:/.test(y) && /cron:/.test(y), 'must be on a cron schedule');
    assert.ok(/APIFY_TOKEN/.test(y), 'must pass the token through to ingest');
    assert.ok(/node test\/test\.js/.test(y), 'must gate the pull on the test suite');
  });

  console.log('\nHANDLE DISCOVERY \u2014 EVIDENCE GATE');
  const REG = () => JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, '..', 'handles.json'), 'utf8'));
  await t('every confirmed handle records the evidence it was accepted on', () => {
    for (const e of REG().employees.filter(x => x.confirmed && x.handles.instagram)) {
      assert.ok(e.sourcedFrom, e.name + ' has no sourcedFrom');
      // The gate is evidence about the ACCOUNT, never the handle pattern.
      const ALLOWED = ['bio', 'company-tag', 'posting-context'];
      assert.ok(ALLOWED.includes(e.evidenceClass),
        e.name + ': evidenceClass missing or unrecognised -> ' + e.evidenceClass);
      // The weakest class is permitted, but it may never pass silently.
      if (e.evidenceClass === 'posting-context') {
        assert.strictEqual(e.needsHumanConfirmation, true,
          e.name + ': circumstantial evidence must be flagged for human confirmation');
      }
    }
  });
  await t('a resolving account with no Kirpa evidence is rejected', () => {
    // nikita.kirpa is a real, reachable account. It is still not proof of employment.
    const e = REG().employees.find(x => x.name === 'Nikita Lal Tekwani');
    assert.strictEqual(e.handles.instagram, null, 'pattern-only match must not be stored as a handle');
    assert.strictEqual(e.confirmed, false);
    assert.ok(/REJECTED/.test(e.sourcedFrom), 'the rejection must be recorded, not silent');
  });
  await t('no competitor-branded handle survives anywhere', () => {
    for (const e of REG().employees) {
      const h = e.handles.instagram;
      if (!h) continue;
      assert.ok(!/danube|emaar|damac|sobha/i.test(h), e.name + ': handle brands to another company -> ' + h);
    }
  });
  await t('name mismatches are disclosed rather than smoothed over', () => {
    // Several profiles show a different surname to the HR roster. That is allowed,
    // but it must be visible to whoever reads the board.
    const e = REG().employees.find(x => x.handles.instagram === 'jagraaj.kirpa');
    assert.ok(/differs from roster/.test(e.sourcedFrom), 'surname discrepancy must be stated');
  });

  console.log('\nMETRIC VALIDITY \u2014 regression guards');
  const NOW = Date.parse('2026-07-22T00:00:00Z');
  const day = d => new Date(NOW - d * 864e5).toISOString();
  const mk = (name, followers, posts) => ({
    name, role: 'Agent', platform: 'instagram', handle: name.toLowerCase(),
    capturedAt: new Date(NOW).toISOString(), resolved: true, isPrivate: false,
    followers, following: 10, postCount: posts.length, recentPosts: posts, warnings: [],
  });
  const post = (d, likes, extra) => Object.assign(
    { id: 'p' + d + '_' + likes, type: 'reel', likes, comments: 0, shares: null,
      views: null, postedAt: day(d), isPinned: false }, extra || {});

  await t('one viral post cannot distort a person\u2019s engagement rate', () => {
    // Real case: a 51k-like reel on a 12k-follower account produced 86.87%.
    const steady = mk('Steady', 10000, [post(2,100), post(5,100), post(9,100), post(14,100)]);
    const viral  = mk('Viral',  10000, [post(2,100), post(5,100), post(9,100), post(14,900000)]);
    const a = R.engagementRate(steady, NOW), b = R.engagementRate(viral, NOW);
    assert.ok(b < 0.5, 'rate must stay plausible despite an outlier, got ' + b);
    assert.strictEqual(a, b, 'a single outlier must not move the typical-post rate at all');
  });

  await t('engagement rate never exceeds a sane ceiling on real data', () => {
    const snap = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'data', 'latest.json'), 'utf8'));
    for (const row of R.buildLeaderboards(snap.records, ['instagram']).instagram.engagement) {
      assert.ok(row.engagementRate < 1,
        row.name + ' has an implausible engagement rate: ' + (row.engagementRate * 100).toFixed(2) + '%');
    }
  });

  await t('content that out-reaches the following is surfaced, not hidden', () => {
    const viral = mk('Viral', 1000, [post(2,50), post(4,50), post(6,900000)]);
    assert.strictEqual(R.beyondFollowingCount(viral, NOW), 1);
  });

  await t('cadence uses one shared window, not each person\u2019s own span', () => {
    // Before: a 4-day span and a 485-day span were compared directly.
    const burst = mk('Burst', 1000, [post(1,10), post(2,10), post(3,10), post(4,10)]);
    const spread = mk('Spread', 1000, [post(1,10), post(2,10), post(3,10), post(4,10), post(400,10)]);
    // The 400-day-old post is outside the window and must not stretch the denominator.
    assert.strictEqual(R.postsPerWeek(burst, NOW), R.postsPerWeek(spread, NOW));
  });

  await t('posts outside the window are excluded from every rate', () => {
    const old = mk('Old', 1000, [post(200, 5000)]);
    assert.strictEqual(R.postsPerWeek(old, NOW), null, 'no recent posts -> null, never a number');
    assert.strictEqual(R.engagementRate(old, NOW), null);
  });

  await t('the top-post board is winnable by someone whose posts report no views', () => {
    // Dr. Jai Chatha had 0 of 10 videos reporting views, so the old view-ranked
    // board made him structurally ineligible however well he performed.
    const noViews = mk('NoViews', 1000, [post(1, 9000)]);
    const hasViews = mk('HasViews', 1000, [post(3, 10, { views: 500000 })]);
    const top = R.topPost([noViews, hasViews], 'instagram', NOW);
    assert.strictEqual(top.name, 'NoViews', 'interactions must decide, not view availability');
  });

  await t('the most-viewed board states how little of the data it saw', () => {
    const snap = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'data', 'latest.json'), 'utf8'));
    const mv = R.buildLeaderboards(snap.records, ['instagram']).instagram.mostViewed;
    assert.ok(mv.coverage.videosReportingViews < mv.coverage.videosSeen, 'fixture should be partial');
    assert.ok(/not necessarily the best video/.test(mv.caveat), 'scope must be stated on the card');
  });

  await t('an unmeasured metric is never scored as zero', () => {
    // A real agent with real followers but no posts yet was ranked last as
    // though assessed. Unknown must stay unknown.
    const active = mk('Active', 10000, [post(2,100), post(5,100)]);
    const fresh  = mk('Fresh', 9000, []);
    const rows = R.compositeLeaderboard([active, fresh], undefined, NOW);
    const f = rows.find(r => r.name === 'Fresh');
    assert.strictEqual(f.rank, null, 'a person with one measurable metric must not be ranked');
    assert.strictEqual(f.provisional, true);
    assert.ok(f.missingMetrics.includes('engagementRate') && f.missingMetrics.includes('postsPerWeek'));
    assert.ok(f.note && /Not ranked yet/.test(f.note), 'the reason must be shown to the reader');
  });

  await t('provisional people stay visible rather than vanishing', () => {
    const active = mk('Active', 10000, [post(2,100), post(5,100)]);
    const fresh  = mk('Fresh', 9000, []);
    const rows = R.compositeLeaderboard([active, fresh], undefined, NOW);
    assert.strictEqual(rows.length, 2, 'nobody may be silently dropped from the board');
  });

  await t('composite weights recent behaviour over accumulated followers', () => {
    assert.ok(R.DEFAULT_WEIGHTS.followers < R.DEFAULT_WEIGHTS.engagementRate);
    assert.ok(R.DEFAULT_WEIGHTS.followers < R.DEFAULT_WEIGHTS.postsPerWeek);
    const sum = Object.values(R.DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, 'weights must sum to 1, got ' + sum);
  });

  await t('scoring is reproducible from the snapshot, not from wall-clock time', () => {
    const snap = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'data', 'latest.json'), 'utf8'));
    const a = R.buildLeaderboards(snap.records, ['instagram']).instagram.engagement;
    const b = R.buildLeaderboards(snap.records, ['instagram']).instagram.engagement;
    assert.deepStrictEqual(a, b);
    assert.strictEqual(R.asOf(snap.records), Date.parse(snap.meta.capturedAt));
  });

  await t('every board reports the window it was measured over', () => {
    const snap = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'data', 'latest.json'), 'utf8'));
    const c = R.buildLeaderboards(snap.records, ['instagram']).instagram.coverage;
    assert.strictEqual(c.windowDays, R.WINDOW_DAYS);
    assert.ok(c.asOf && c.profiles > 0);
    assert.ok(c.videoViewReporting.pct !== null, 'view-reporting coverage must be published');
  });

  console.log('\nDASHBOARD RENDERING');
  await t('leaderboards are not capped \u2014 everyone can find their own line', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    // A slice(0,N) here silently hid most of the roster: with 6 people only 5
    // showed, and with 24 confirmed agents 19 would never see themselves.
    const fn = html.slice(html.indexOf('function boardList('), html.indexOf('function renderBoards('));
    assert.ok(!/rows\.slice\(/.test(fn), 'boardList must not slice the rows it was given');
    assert.ok(/rows\.map\(/.test(fn), 'boardList should map over every row');
  });
  await t('the composite card reads its weights from the data, never hardcoded', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(!/followers 35%/.test(html), 'a hardcoded weight label goes stale the moment weights change');
    assert.ok(/combined\.weights/.test(html), 'weights must come from the snapshot');
  });
  await t('unranked people render as pending, not as rank null or score 0', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    const fn = html.slice(html.indexOf('function boardList('), html.indexOf('function renderBoards('));
    assert.ok(/r\.rank===null\|\|r\.rank===undefined/.test(fn), 'must detect the unranked state');
    assert.ok(/prov/.test(fn), 'unranked rows need their own styling hook');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
