'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const MIN_ENGAGEMENT_POSTS = 3;
const MIN_MEASURED = 3;
const DEFAULT_WEIGHTS = { followers: 0.15, engagementRate: 0.45, postsPerWeek: 0.40 };

function num(x) { return typeof x === 'number' && Number.isFinite(x) ? x : 0; }
function isUsable(r) { return !!r && r.resolved === true && r.isPrivate === false; }
function isRankable(r) { return isUsable(r) && typeof r.followers === 'number' && r.followers >= 0; }
function forPlatform(records, platform) { return (records || []).filter(r => r.platform === platform); }
function ts(p) {
  if (!p || !p.postedAt) return NaN;
  const t = new Date(p.postedAt).getTime();
  return Number.isFinite(t) ? t : NaN;
}
function asOf(records) {
  const times = (records || []).map(r => r?.capturedAt ? new Date(r.capturedAt).getTime() : NaN)
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : Date.now();
}
function postEngagement(p) { return num(p?.likes) + num(p?.comments) + num(p?.shares); }
function median(xs) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function windowPosts(r, now, days = WINDOW_DAYS) {
  const cutoff = now - days * DAY_MS;
  return (Array.isArray(r?.recentPosts) ? r.recentPosts : [])
    .filter(p => !p.isPinned)
    .filter(p => {
      const t = ts(p);
      return Number.isFinite(t) && t >= cutoff && t <= now;
    });
}

/*
 * A 30-day metric is comparable only when the fetched feed reaches the start
 * of the window (or the account has fewer total posts than were fetched).
 * Otherwise a highly active account could have only its latest few days scored.
 */
function windowCoverage(r, now, days = WINDOW_DAYS) {
  const cutoff = now - days * DAY_MS;
  if (!isUsable(r)) return { complete: false, reason: 'profile unavailable' };

  const dated = (Array.isArray(r.recentPosts) ? r.recentPosts : [])
    .filter(p => !p.isPinned && Number.isFinite(ts(p)))
    .sort((a, b) => ts(a) - ts(b));
  const fetched = r.fetchMeta?.authoredPostCount ?? r.recentPosts?.length ?? 0;
  const total = typeof r.postCount === 'number' ? r.postCount : null;

  if (total === 0) return { complete: true, reason: 'account has no posts', oldestFetchedAt: null };
  if (dated.length && ts(dated[0]) <= cutoff) {
    return { complete: true, reason: 'feed reaches window start', oldestFetchedAt: dated[0].postedAt };
  }
  if (total !== null && fetched >= total) {
    return { complete: true, reason: 'all account posts fetched', oldestFetchedAt: dated[0]?.postedAt || null };
  }
  if (!dated.length && total === null) {
    return { complete: false, reason: 'no dated posts returned', oldestFetchedAt: null };
  }
  return {
    complete: false,
    reason: 'fetched feed does not reach the 30-day cutoff',
    oldestFetchedAt: dated[0]?.postedAt || null,
  };
}

function typicalEngagement(r, now, days = WINDOW_DAYS) {
  const posts = windowPosts(r, now, days);
  return posts.length ? median(posts.map(postEngagement)) : null;
}
function avgEngagementPerPost(r, now = asOf([r]), days = WINDOW_DAYS) {
  const posts = windowPosts(r, now, days);
  return posts.length ? posts.reduce((s, p) => s + postEngagement(p), 0) / posts.length : null;
}
function engagementRate(r, now = asOf([r]), days = WINDOW_DAYS) {
  const posts = windowPosts(r, now, days);
  if (!r?.followers || posts.length < MIN_ENGAGEMENT_POSTS) return null;
  const typical = median(posts.map(postEngagement));
  return typical === null ? null : typical / r.followers;
}
function beyondFollowingCount(r, now = asOf([r]), days = WINDOW_DAYS) {
  if (!r?.followers) return null;
  return windowPosts(r, now, days).filter(p => postEngagement(p) > r.followers).length;
}
function postsPerWeek(r, now = asOf([r]), days = WINDOW_DAYS) {
  if (!windowCoverage(r, now, days).complete) return null;
  return windowPosts(r, now, days).length / (days / 7);
}

function byDesc(key) {
  return (a, b) => (b[key] === null) - (a[key] === null) || num(b[key]) - num(a[key]);
}
function rankRows(rows, key) {
  const sorted = rows.slice().sort(byDesc(key));
  let lastVal = Symbol('none');
  let lastRank = 0;
  return sorted.map((row, i) => {
    const rank = row[key] === lastVal ? lastRank : (lastRank = i + 1, lastVal = row[key], lastRank);
    return Object.assign({ rank }, row);
  });
}

function mostFollowers(records, platform) {
  return rankRows(forPlatform(records, platform).filter(isRankable)
    .map(r => ({ name: r.name, role: r.role, handle: r.handle, followers: r.followers })), 'followers');
}

function engagementLeaderboard(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  const rows = forPlatform(records, platform).filter(isRankable).map(r => {
    const posts = windowPosts(r, now, days);
    const coverage = windowCoverage(r, now, days);
    return {
      name: r.name,
      role: r.role,
      handle: r.handle,
      followers: r.followers,
      engagementRate: coverage.complete ? engagementRate(r, now, days) : null,
      typicalEngagement: coverage.complete && posts.length >= MIN_ENGAGEMENT_POSTS
        ? median(posts.map(postEngagement)) : null,
      avgEngagement: coverage.complete && posts.length >= MIN_ENGAGEMENT_POSTS
        ? posts.reduce((s, p) => s + postEngagement(p), 0) / posts.length : null,
      postsInWindow: posts.length,
      minimumPosts: MIN_ENGAGEMENT_POSTS,
      windowComplete: coverage.complete,
      beyondFollowing: coverage.complete ? beyondFollowingCount(r, now, days) : null,
      basis: `median interactions per post ÷ followers; minimum ${MIN_ENGAGEMENT_POSTS} posts`,
    };
  }).filter(r => r.engagementRate !== null);
  return rankRows(rows, 'engagementRate');
}

function postingFrequency(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  const rows = forPlatform(records, platform).filter(isUsable).map(r => ({
    name: r.name,
    role: r.role,
    handle: r.handle,
    postsPerWeek: postsPerWeek(r, now, days),
    postsInWindow: windowPosts(r, now, days).length,
    windowDays: days,
    windowComplete: windowCoverage(r, now, days).complete,
  })).filter(r => r.postsPerWeek !== null);
  return rankRows(rows, 'postsPerWeek');
}

function topPost(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(r, now, days).complete) continue;
    for (const p of windowPosts(r, now, days)) {
      const engagement = postEngagement(p);
      if (!best || engagement > best.engagement) {
        best = { name: r.name, role: r.role, handle: r.handle, post: p, engagement };
      }
    }
  }
  return best;
}
function topVideo(records, platform, now, days) { return topPost(records, platform, now, days); }
function mostCommented(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(r, now, days).complete) continue;
    for (const p of windowPosts(r, now, days)) {
      if (typeof p.comments !== 'number') continue;
      if (!best || p.comments > best.post.comments) best = { name: r.name, role: r.role, handle: r.handle, post: p };
    }
  }
  return best;
}
function mostViewed(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  let eligible = 0;
  let considered = 0;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(r, now, days).complete) continue;
    for (const p of windowPosts(r, now, days)) {
      if (p.type !== 'video' && p.type !== 'reel') continue;
      considered++;
      if (typeof p.views !== 'number') continue;
      eligible++;
      if (!best || p.views > best.post.views) best = { name: r.name, role: r.role, handle: r.handle, post: p };
    }
  }
  if (best) {
    best.coverage = { videosSeen: considered, videosReportingViews: eligible };
    best.caveat = `Best of ${eligible} of ${considered} recent videos that publicly reported views.`;
  }
  return best;
}

function minMax(vals) {
  const nums = vals.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return () => 0;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return v => (typeof v !== 'number' || !Number.isFinite(v) || hi === lo) ? 0 : (v - lo) / (hi - lo);
}

function compositeLeaderboard(records, weights = DEFAULT_WEIGHTS, now = asOf(records), days = WINDOW_DAYS) {
  const people = forPlatform(records, 'instagram').filter(isRankable).map(r => ({
    name: r.name,
    role: r.role,
    platforms: ['instagram'],
    followers: r.followers,
    engagementRate: windowCoverage(r, now, days).complete ? engagementRate(r, now, days) : null,
    postsPerWeek: postsPerWeek(r, now, days),
  }));

  const norm = {
    followers: minMax(people.map(p => p.followers)),
    engagementRate: minMax(people.map(p => p.engagementRate)),
    postsPerWeek: minMax(people.map(p => p.postsPerWeek)),
  };

  const rows = people.map(p => {
    const measured = Object.keys(weights).filter(k => typeof p[k] === 'number' && Number.isFinite(p[k]));
    const missing = Object.keys(weights).filter(k => !measured.includes(k));
    const provisional = measured.length < MIN_MEASURED;
    const score = provisional ? null : measured.reduce((s, k) => s + weights[k] * norm[k](p[k]), 0);
    return {
      name: p.name,
      role: p.role,
      platforms: p.platforms,
      score,
      measuredMetrics: measured,
      missingMetrics: missing,
      provisional,
    };
  });

  const ranked = rankRows(rows.filter(r => !r.provisional && r.score !== null), 'score');
  const held = rows.filter(r => r.provisional || r.score === null).map(r => Object.assign({ rank: null }, r, {
    note: `Not ranked yet — ${r.missingMetrics.join(', ') || 'required data'} unavailable or sample too small.`,
  }));
  return ranked.concat(held);
}

function keyOf(r) { return `${r.name}::${r.platform}::${r.handle}`; }
function growth(prevRecords, currRecords) {
  if (!Array.isArray(prevRecords) || !prevRecords.length) return [];
  const prev = new Map(prevRecords.filter(isRankable).map(r => [keyOf(r), r]));
  const rows = [];
  for (const c of (currRecords || []).filter(isRankable)) {
    const p = prev.get(keyOf(c));
    if (!p) continue;
    rows.push({
      name: c.name,
      role: c.role,
      platform: c.platform,
      handle: c.handle,
      followerDelta: c.followers - p.followers,
      followerPct: p.followers ? (c.followers - p.followers) / p.followers : null,
    });
  }
  return rankRows(rows, 'followerDelta');
}

function buildLeaderboards(records, platforms = ['instagram'], opts = {}) {
  const days = opts.windowDays || WINDOW_DAYS;
  const now = opts.now === undefined ? asOf(records) : opts.now;
  const out = {};
  for (const pf of platforms) {
    const pool = forPlatform(records, pf).filter(isUsable);
    const coverageRows = pool.map(r => ({ r, coverage: windowCoverage(r, now, days), posts: windowPosts(r, now, days) }));
    const complete = coverageRows.filter(x => x.coverage.complete);
    const videos = complete.reduce((sum, x) => sum + x.posts.filter(p => p.type === 'video' || p.type === 'reel').length, 0);
    const videosWithViews = complete.reduce((sum, x) => sum + x.posts.filter(p => (p.type === 'video' || p.type === 'reel') && typeof p.views === 'number').length, 0);
    out[pf] = {
      mostFollowers: mostFollowers(records, pf),
      engagement: engagementLeaderboard(records, pf, now, days),
      postingFrequency: postingFrequency(records, pf, now, days),
      topPost: topPost(records, pf, now, days),
      topVideo: topPost(records, pf, now, days),
      mostViewed: mostViewed(records, pf, now, days),
      mostCommented: mostCommented(records, pf, now, days),
      coverage: {
        windowDays: days,
        asOf: new Date(now).toISOString(),
        profiles: pool.length,
        completeWindowProfiles: complete.length,
        incompleteWindowProfiles: coverageRows.filter(x => !x.coverage.complete).map(x => x.r.name),
        profilesWithPostsInWindow: complete.filter(x => x.posts.length > 0).length,
        eligibleEngagementProfiles: complete.filter(x => x.posts.length >= MIN_ENGAGEMENT_POSTS && x.r.followers > 0).length,
        postsInWindow: complete.reduce((sum, x) => sum + x.posts.length, 0),
        minimumEngagementPosts: MIN_ENGAGEMENT_POSTS,
        videoViewReporting: {
          videos,
          reportingViews: videosWithViews,
          pct: videos ? Math.round(100 * videosWithViews / videos) : null,
        },
      },
    };
  }
  out.combined = {
    note: 'Instagram momentum score: 15% followers, 45% typical engagement rate, 40% posting cadence. Profiles need complete 30-day coverage and at least three posts.',
    composite: compositeLeaderboard(records, opts.weights || DEFAULT_WEIGHTS, now, days),
    weights: opts.weights || DEFAULT_WEIGHTS,
    windowDays: days,
  };
  return out;
}

module.exports = {
  isRankable,
  isUsable,
  postEngagement,
  engagementRate,
  avgEngagementPerPost,
  postsPerWeek,
  typicalEngagement,
  beyondFollowingCount,
  windowPosts,
  windowCoverage,
  median,
  asOf,
  mostFollowers,
  engagementLeaderboard,
  postingFrequency,
  topPost,
  topVideo,
  mostViewed,
  mostCommented,
  compositeLeaderboard,
  growth,
  buildLeaderboards,
  DEFAULT_WEIGHTS,
  WINDOW_DAYS,
  MIN_ENGAGEMENT_POSTS,
  MIN_MEASURED,
};
