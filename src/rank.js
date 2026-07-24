'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const MIN_ENGAGEMENT_POSTS = 3;
const MIN_MEASURED = 3;
const DEFAULT_WEIGHTS = { followers: 0.15, engagementRate: 0.45, postsPerWeek: 0.40 };

function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function isUsable(record) { return !!record && record.resolved === true && record.isPrivate === false; }
function isRankable(record) { return isUsable(record) && typeof record.followers === 'number' && record.followers >= 0; }
function forPlatform(records, platform) { return (records || []).filter(record => record.platform === platform); }
function ts(post) {
  if (!post || !post.postedAt) return NaN;
  const value = new Date(post.postedAt).getTime();
  return Number.isFinite(value) ? value : NaN;
}
function asOf(records) {
  const times = (records || []).map(record => record?.capturedAt ? new Date(record.capturedAt).getTime() : NaN).filter(Number.isFinite);
  return times.length ? Math.max(...times) : Date.now();
}
function postEngagement(post) { return num(post?.likes) + num(post?.comments) + num(post?.shares); }
function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function postKey(post) {
  if (post?.id) return `id:${post.id}`;
  if (post?.url) return `url:${post.url}`;
  return `fallback:${post?.postedAt || ''}|${post?.caption || ''}|${post?.type || ''}`;
}
function uniquePosts(record) {
  const seen = new Set();
  const out = [];
  for (const post of Array.isArray(record?.recentPosts) ? record.recentPosts : []) {
    const key = postKey(post);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(post);
  }
  return out;
}

/*
 * Formula:
 *   posts per week = unique authored posts in the exact rolling window × 7 / window days
 *
 * Pinned status is deliberately NOT an exclusion. A pinned post published inside
 * the window is still a post. Old pinned posts fall outside the window by date.
 */
function windowPosts(record, now, days = WINDOW_DAYS) {
  const cutoff = now - days * DAY_MS;
  return uniquePosts(record).filter(post => {
    const time = ts(post);
    return Number.isFinite(time) && time >= cutoff && time <= now;
  });
}

/*
 * New snapshots use a dedicated date-bounded Instagram posts query. Coverage is
 * complete when that query succeeded, looked back at least as far as the metric
 * window, and either did not hit its result limit or demonstrably reached the
 * window cutoff. Old 12-post profile snapshots fail this gate.
 */
function windowCoverage(record, now, days = WINDOW_DAYS) {
  const cutoff = now - days * DAY_MS;
  if (!isUsable(record)) return { complete: false, reason: 'profile unavailable' };

  const meta = record.fetchMeta || {};
  const dated = uniquePosts(record).filter(post => Number.isFinite(ts(post))).sort((a, b) => ts(a) - ts(b));
  const oldestFetchedAt = dated[0]?.postedAt || null;
  const reachesCutoff = dated.length > 0 && ts(dated[0]) <= cutoff;
  const querySucceeded = meta.postsQuerySucceeded === true;
  const lookbackDays = typeof meta.postsLookbackDays === 'number' ? meta.postsLookbackDays : null;
  const resultLimit = typeof meta.postsResultLimit === 'number' ? meta.postsResultLimit : null;
  const authoredCount = typeof meta.authoredPostCount === 'number' ? meta.authoredPostCount : dated.length;
  const truncated = meta.postsTruncated === true || (resultLimit !== null && authoredCount >= resultLimit);

  if (!querySucceeded) {
    return { complete: false, reason: 'dedicated posts query did not complete', oldestFetchedAt, truncated };
  }
  if (lookbackDays === null || lookbackDays < days) {
    return { complete: false, reason: 'posts query lookback is shorter than the metric window', oldestFetchedAt, truncated };
  }
  if (truncated && !reachesCutoff) {
    return { complete: false, reason: 'posts query hit its limit before reaching the 30-day cutoff', oldestFetchedAt, truncated };
  }
  return {
    complete: true,
    reason: truncated ? 'truncated feed still reaches the cutoff' : 'date-bounded posts query completed without truncation',
    oldestFetchedAt,
    truncated,
  };
}

function typicalEngagement(record, now, days = WINDOW_DAYS) {
  const posts = windowPosts(record, now, days);
  return posts.length ? median(posts.map(postEngagement)) : null;
}
function avgEngagementPerPost(record, now = asOf([record]), days = WINDOW_DAYS) {
  const posts = windowPosts(record, now, days);
  return posts.length ? posts.reduce((sum, post) => sum + postEngagement(post), 0) / posts.length : null;
}
function engagementRate(record, now = asOf([record]), days = WINDOW_DAYS) {
  const posts = windowPosts(record, now, days);
  if (!record?.followers || posts.length < MIN_ENGAGEMENT_POSTS) return null;
  const typical = median(posts.map(postEngagement));
  return typical === null ? null : typical / record.followers;
}
function beyondFollowingCount(record, now = asOf([record]), days = WINDOW_DAYS) {
  if (!record?.followers) return null;
  return windowPosts(record, now, days).filter(post => postEngagement(post) > record.followers).length;
}
function postsPerWeek(record, now = asOf([record]), days = WINDOW_DAYS) {
  if (!windowCoverage(record, now, days).complete) return null;
  return windowPosts(record, now, days).length * 7 / days;
}

function byDesc(key) {
  return (a, b) => (b[key] === null) - (a[key] === null) || num(b[key]) - num(a[key]);
}
function rankRows(rows, key) {
  const sorted = rows.slice().sort(byDesc(key));
  let lastValue = Symbol('none');
  let lastRank = 0;
  return sorted.map((row, index) => {
    const rank = row[key] === lastValue ? lastRank : (lastRank = index + 1, lastValue = row[key], lastRank);
    return Object.assign({ rank }, row);
  });
}
function mostFollowers(records, platform) {
  return rankRows(forPlatform(records, platform).filter(isRankable)
    .map(record => ({ name: record.name, role: record.role, handle: record.handle, followers: record.followers })), 'followers');
}
function engagementLeaderboard(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  const rows = forPlatform(records, platform).filter(isRankable).map(record => {
    const posts = windowPosts(record, now, days);
    const coverage = windowCoverage(record, now, days);
    const enough = coverage.complete && posts.length >= MIN_ENGAGEMENT_POSTS;
    return {
      name: record.name,
      role: record.role,
      handle: record.handle,
      followers: record.followers,
      engagementRate: enough ? engagementRate(record, now, days) : null,
      typicalEngagement: enough ? median(posts.map(postEngagement)) : null,
      avgEngagement: enough ? posts.reduce((sum, post) => sum + postEngagement(post), 0) / posts.length : null,
      postsInWindow: posts.length,
      minimumPosts: MIN_ENGAGEMENT_POSTS,
      windowComplete: coverage.complete,
      coverageReason: coverage.reason,
      beyondFollowing: enough ? beyondFollowingCount(record, now, days) : null,
      basis: `median public interactions per post ÷ followers; minimum ${MIN_ENGAGEMENT_POSTS} posts`,
    };
  }).filter(row => row.engagementRate !== null);
  return rankRows(rows, 'engagementRate');
}
function postingFrequency(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  const rows = forPlatform(records, platform).filter(isUsable).map(record => {
    const posts = windowPosts(record, now, days);
    const coverage = windowCoverage(record, now, days);
    return {
      name: record.name,
      role: record.role,
      handle: record.handle,
      postsPerWeek: coverage.complete ? posts.length * 7 / days : null,
      postsInWindow: posts.length,
      windowDays: days,
      windowComplete: coverage.complete,
      coverageReason: coverage.reason,
      formula: `${posts.length} × 7 ÷ ${days}`,
    };
  }).filter(row => row.postsPerWeek !== null);
  return rankRows(rows, 'postsPerWeek');
}
function topPost(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  for (const record of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(record, now, days).complete) continue;
    for (const post of windowPosts(record, now, days)) {
      const engagement = postEngagement(post);
      if (!best || engagement > best.engagement) best = { name: record.name, role: record.role, handle: record.handle, post, engagement };
    }
  }
  return best;
}
function topVideo(records, platform, now, days) { return topPost(records, platform, now, days); }
function mostCommented(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  for (const record of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(record, now, days).complete) continue;
    for (const post of windowPosts(record, now, days)) {
      if (typeof post.comments !== 'number') continue;
      if (!best || post.comments > best.post.comments) best = { name: record.name, role: record.role, handle: record.handle, post };
    }
  }
  return best;
}
function mostViewed(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  let eligible = 0;
  let considered = 0;
  for (const record of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(record, now, days).complete) continue;
    for (const post of windowPosts(record, now, days)) {
      if (post.type !== 'video' && post.type !== 'reel') continue;
      considered++;
      if (typeof post.views !== 'number') continue;
      eligible++;
      if (!best || post.views > best.post.views) best = { name: record.name, role: record.role, handle: record.handle, post };
    }
  }
  if (best) {
    best.coverage = { videosSeen: considered, videosReportingViews: eligible };
    best.caveat = `Best of ${eligible} of ${considered} recent videos that publicly reported views.`;
  }
  return best;
}
function minMax(values) {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!numbers.length) return () => 0;
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  return value => (typeof value !== 'number' || !Number.isFinite(value) || high === low) ? 0 : (value - low) / (high - low);
}
function compositeLeaderboard(records, weights = DEFAULT_WEIGHTS, now = asOf(records), days = WINDOW_DAYS) {
  const people = forPlatform(records, 'instagram').filter(isRankable).map(record => ({
    name: record.name,
    role: record.role,
    platforms: ['instagram'],
    followers: record.followers,
    engagementRate: windowCoverage(record, now, days).complete ? engagementRate(record, now, days) : null,
    postsPerWeek: postsPerWeek(record, now, days),
  }));
  const normalizers = {
    followers: minMax(people.map(person => person.followers)),
    engagementRate: minMax(people.map(person => person.engagementRate)),
    postsPerWeek: minMax(people.map(person => person.postsPerWeek)),
  };
  const rows = people.map(person => {
    const measured = Object.keys(weights).filter(key => typeof person[key] === 'number' && Number.isFinite(person[key]));
    const missing = Object.keys(weights).filter(key => !measured.includes(key));
    const provisional = measured.length < MIN_MEASURED;
    const score = provisional ? null : measured.reduce((sum, key) => sum + weights[key] * normalizers[key](person[key]), 0);
    return { name: person.name, role: person.role, platforms: person.platforms, score, measuredMetrics: measured, missingMetrics: missing, provisional };
  });
  const ranked = rankRows(rows.filter(row => !row.provisional && row.score !== null), 'score');
  const held = rows.filter(row => row.provisional || row.score === null).map(row => Object.assign({ rank: null }, row, {
    note: `Not ranked yet — ${row.missingMetrics.join(', ') || 'required data'} unavailable or sample too small.`,
  }));
  return ranked.concat(held);
}
function keyOf(record) { return `${record.name}::${record.platform}::${record.handle}`; }
function growth(previousRecords, currentRecords) {
  if (!Array.isArray(previousRecords) || !previousRecords.length) return [];
  const previous = new Map(previousRecords.filter(isRankable).map(record => [keyOf(record), record]));
  const rows = [];
  for (const current of (currentRecords || []).filter(isRankable)) {
    const old = previous.get(keyOf(current));
    if (!old) continue;
    rows.push({
      name: current.name,
      role: current.role,
      platform: current.platform,
      handle: current.handle,
      followerDelta: current.followers - old.followers,
      followerPct: old.followers ? (current.followers - old.followers) / old.followers : null,
    });
  }
  return rankRows(rows, 'followerDelta');
}
function buildLeaderboards(records, platforms = ['instagram'], opts = {}) {
  const days = opts.windowDays || WINDOW_DAYS;
  const now = opts.now === undefined ? asOf(records) : opts.now;
  const out = {};
  for (const platform of platforms) {
    const pool = forPlatform(records, platform).filter(isUsable);
    const audits = pool.map(record => {
      const coverage = windowCoverage(record, now, days);
      const posts = windowPosts(record, now, days);
      return {
        name: record.name,
        handle: record.handle,
        complete: coverage.complete,
        reason: coverage.reason,
        postsInWindow: posts.length,
        postsPerWeek: coverage.complete ? posts.length * 7 / days : null,
        formula: `${posts.length} × 7 ÷ ${days}`,
        oldestFetchedAt: coverage.oldestFetchedAt || null,
        postsQuerySucceeded: record.fetchMeta?.postsQuerySucceeded === true,
        postsTruncated: coverage.truncated === true,
      };
    });
    const completeNames = new Set(audits.filter(audit => audit.complete).map(audit => audit.name));
    const completeRecords = pool.filter(record => completeNames.has(record.name));
    const completePosts = completeRecords.flatMap(record => windowPosts(record, now, days));
    const videos = completePosts.filter(post => post.type === 'video' || post.type === 'reel');
    const videosWithViews = videos.filter(post => typeof post.views === 'number');
    out[platform] = {
      mostFollowers: mostFollowers(records, platform),
      engagement: engagementLeaderboard(records, platform, now, days),
      postingFrequency: postingFrequency(records, platform, now, days),
      topPost: topPost(records, platform, now, days),
      topVideo: topPost(records, platform, now, days),
      mostViewed: mostViewed(records, platform, now, days),
      mostCommented: mostCommented(records, platform, now, days),
      coverage: {
        windowDays: days,
        asOf: new Date(now).toISOString(),
        formula: 'postsPerWeek = unique authored posts in window × 7 ÷ 30',
        profiles: pool.length,
        completeWindowProfiles: audits.filter(audit => audit.complete).length,
        incompleteWindowProfiles: audits.filter(audit => !audit.complete).map(audit => audit.name),
        profilesWithPostsInWindow: audits.filter(audit => audit.complete && audit.postsInWindow > 0).length,
        eligibleEngagementProfiles: audits.filter(audit => audit.complete && audit.postsInWindow >= MIN_ENGAGEMENT_POSTS).length,
        postsInWindow: audits.filter(audit => audit.complete).reduce((sum, audit) => sum + audit.postsInWindow, 0),
        minimumEngagementPosts: MIN_ENGAGEMENT_POSTS,
        cadenceAudit: audits,
        videoViewReporting: {
          videos: videos.length,
          reportingViews: videosWithViews.length,
          pct: videos.length ? Math.round(100 * videosWithViews.length / videos.length) : null,
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
  isRankable, isUsable, postEngagement, engagementRate, avgEngagementPerPost,
  postsPerWeek, typicalEngagement, beyondFollowingCount, windowPosts,
  windowCoverage, uniquePosts, median, asOf, mostFollowers,
  engagementLeaderboard, postingFrequency, topPost, topVideo, mostViewed,
  mostCommented, compositeLeaderboard, growth, buildLeaderboards,
  DEFAULT_WEIGHTS, WINDOW_DAYS, MIN_ENGAGEMENT_POSTS, MIN_MEASURED,
};
