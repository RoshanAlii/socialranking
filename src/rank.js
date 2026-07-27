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
/*
 * Instagram does not expose public share counts consistently. To keep every
 * profile comparable, "supported interactions" means public likes + comments.
 * A post missing either value is unknown and is not silently scored as zero.
 */
function postEngagement(post) {
  if (typeof post?.likes !== 'number' || !Number.isFinite(post.likes)) return null;
  if (typeof post?.comments !== 'number' || !Number.isFinite(post.comments)) return null;
  return post.likes + post.comments;
}
function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function average(values) {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}
function supported(posts, key) {
  return (posts || []).map(post => post?.[key]).filter(value => typeof value === 'number' && Number.isFinite(value));
}
function bestPost(posts, key, predicate = () => true) {
  let best = null;
  for (const post of posts || []) {
    if (!predicate(post)) continue;
    const value = typeof key === 'function' ? key(post) : post?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!best || value > best.value) best = { post, value };
  }
  return best;
}
function medianGapHours(posts) {
  const times = (posts || []).map(ts).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 2) return null;
  return median(times.slice(1).map((time, index) => (time - times[index]) / 3600000));
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
function comparableWindowPosts(record, now, days = WINDOW_DAYS) {
  return windowPosts(record, now, days).filter(post => postEngagement(post) !== null);
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
  const ownershipComplete = meta.postsOwnershipComplete !== false;
  const lookbackDays = typeof meta.postsLookbackDays === 'number' ? meta.postsLookbackDays : null;
  const resultLimit = typeof meta.postsResultLimit === 'number' ? meta.postsResultLimit : null;
  const authoredCount = typeof meta.authoredPostCount === 'number' ? meta.authoredPostCount : dated.length;
  const truncated = meta.postsTruncated === true || (resultLimit !== null && authoredCount >= resultLimit);

  if (!querySucceeded) {
    return { complete: false, reason: 'dedicated posts query did not complete', oldestFetchedAt, truncated };
  }
  if (!ownershipComplete) {
    return { complete: false, reason: 'one or more post rows could not be tied to the profile owner', oldestFetchedAt, truncated };
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
  const posts = comparableWindowPosts(record, now, days);
  return posts.length ? median(posts.map(postEngagement)) : null;
}
function avgEngagementPerPost(record, now = asOf([record]), days = WINDOW_DAYS) {
  const posts = comparableWindowPosts(record, now, days);
  return posts.length ? posts.reduce((sum, post) => sum + postEngagement(post), 0) / posts.length : null;
}
function engagementRate(record, now = asOf([record]), days = WINDOW_DAYS) {
  const posts = comparableWindowPosts(record, now, days);
  if (!record?.followers || posts.length < MIN_ENGAGEMENT_POSTS) return null;
  const typical = median(posts.map(postEngagement));
  return typical === null ? null : typical / record.followers;
}
function beyondFollowingCount(record, now = asOf([record]), days = WINDOW_DAYS) {
  if (!record?.followers) return null;
  return comparableWindowPosts(record, now, days).filter(post => postEngagement(post) > record.followers).length;
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
    const window = windowPosts(record, now, days);
    const posts = comparableWindowPosts(record, now, days);
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
      postsInWindow: window.length,
      comparablePosts: posts.length,
      minimumPosts: MIN_ENGAGEMENT_POSTS,
      windowComplete: coverage.complete,
      coverageReason: coverage.reason,
      beyondFollowing: enough ? beyondFollowingCount(record, now, days) : null,
      basis: `median public likes + comments per post ÷ followers; minimum ${MIN_ENGAGEMENT_POSTS} comparable posts`,
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
      if (engagement === null) continue;
      if (!best || engagement > best.engagement) best = { name: record.name, role: record.role, handle: record.handle, post, engagement };
    }
  }
  return best;
}
function topVideo(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  for (const record of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(record, now, days).complete) continue;
    for (const post of windowPosts(record, now, days)) {
      if (post.type !== 'video' && post.type !== 'reel') continue;
      const engagement = postEngagement(post);
      if (engagement === null) continue;
      if (!best || engagement > best.engagement) {
        best = { name: record.name, role: record.role, handle: record.handle, post, engagement };
      }
    }
  }
  return best;
}
function mostLiked(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  for (const record of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(record, now, days).complete) continue;
    for (const post of windowPosts(record, now, days)) {
      if (typeof post.likes !== 'number') continue;
      if (!best || post.likes > best.post.likes) best = { name: record.name, role: record.role, handle: record.handle, post };
    }
  }
  return best;
}
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
function mostShared(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  let best = null;
  let postsSeen = 0;
  let postsReportingShares = 0;
  for (const record of forPlatform(records, platform).filter(isUsable)) {
    if (!windowCoverage(record, now, days).complete) continue;
    for (const post of windowPosts(record, now, days)) {
      postsSeen++;
      if (typeof post.shares !== 'number') continue;
      postsReportingShares++;
      if (!best || post.shares > best.post.shares) best = { name: record.name, role: record.role, handle: record.handle, post };
    }
  }
  if (best) best.coverage = { postsSeen, postsReportingShares };
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
function profileAnalytics(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  return forPlatform(records, platform).map(record => {
    const coverage = windowCoverage(record, now, days);
    const posts = isUsable(record) ? windowPosts(record, now, days) : [];
    const comparable = posts.filter(post => postEngagement(post) !== null);
    const likes = supported(posts, 'likes');
    const comments = supported(posts, 'comments');
    const shares = supported(posts, 'shares');
    const videos = posts.filter(post => post.type === 'video' || post.type === 'reel');
    const views = supported(videos, 'views');
    const interactions = comparable.map(postEngagement);
    const complete = coverage.complete;
    const byType = ['image', 'carousel', 'video', 'reel'].map(type => {
      const typePosts = posts.filter(post => post.type === type);
      const typeInteractions = typePosts.map(postEngagement).filter(value => value !== null);
      return {
        type,
        posts: complete ? typePosts.length : null,
        comparablePosts: complete ? typeInteractions.length : null,
        medianInteractions: complete ? median(typeInteractions) : null,
        averageInteractions: complete ? average(typeInteractions) : null,
      };
    });
    const bestInteractions = bestPost(posts, postEngagement);
    const bestLikes = bestPost(posts, 'likes');
    const bestComments = bestPost(posts, 'comments');
    const bestViews = bestPost(videos, 'views');
    const latest = posts.slice().sort((a, b) => ts(b) - ts(a))[0] || null;
    return {
      name: record.name,
      role: record.role,
      handle: record.handle,
      resolved: record.resolved === true,
      isPrivate: record.isPrivate === true,
      followers: typeof record.followers === 'number' ? record.followers : null,
      following: typeof record.following === 'number' ? record.following : null,
      lifetimePosts: typeof record.postCount === 'number' ? record.postCount : null,
      windowComplete: complete,
      coverageReason: coverage.reason,
      postsInWindow: complete ? posts.length : null,
      comparablePosts: complete ? comparable.length : null,
      postsPerWeek: complete ? posts.length * 7 / days : null,
      activeDays: complete ? new Set(posts.map(post => post.postedAt?.slice(0, 10)).filter(Boolean)).size : null,
      medianGapHours: complete ? medianGapHours(posts) : null,
      latestPostAt: complete ? latest?.postedAt || null : null,
      likesReporting: complete ? likes.length : null,
      commentsReporting: complete ? comments.length : null,
      sharesReporting: complete ? shares.length : null,
      viewsReporting: complete ? views.length : null,
      totalLikes: complete && likes.length ? likes.reduce((sum, value) => sum + value, 0) : null,
      totalComments: complete && comments.length ? comments.reduce((sum, value) => sum + value, 0) : null,
      totalShares: complete && shares.length ? shares.reduce((sum, value) => sum + value, 0) : null,
      totalViews: complete && views.length ? views.reduce((sum, value) => sum + value, 0) : null,
      medianLikes: complete ? median(likes) : null,
      medianComments: complete ? median(comments) : null,
      medianViews: complete ? median(views) : null,
      averageLikes: complete ? average(likes) : null,
      averageComments: complete ? average(comments) : null,
      averageViews: complete ? average(views) : null,
      medianInteractions: complete ? median(interactions) : null,
      averageInteractions: complete ? average(interactions) : null,
      interactionRate: complete && record.followers > 0 && comparable.length >= MIN_ENGAGEMENT_POSTS
        ? median(interactions) / record.followers
        : null,
      commentRate: complete && record.followers > 0 && comments.length >= MIN_ENGAGEMENT_POSTS
        ? median(comments) / record.followers
        : null,
      videoCount: complete ? videos.length : null,
      carouselCount: complete ? posts.filter(post => post.type === 'carousel').length : null,
      imageCount: complete ? posts.filter(post => post.type === 'image').length : null,
      formatPerformance: complete ? byType : null,
      bestPost: complete && bestInteractions ? Object.assign({ interactions: bestInteractions.value }, bestInteractions.post) : null,
      mostLikedPost: complete && bestLikes ? bestLikes.post : null,
      mostCommentedPost: complete && bestComments ? bestComments.post : null,
      mostViewedPost: complete && bestViews ? bestViews.post : null,
      metricCoverage: complete ? {
        posts: posts.length,
        likes: likes.length,
        comments: comments.length,
        shares: shares.length,
        videos: videos.length,
        videoViews: views.length,
      } : null,
    };
  });
}
function formatAnalytics(records, platform, now = asOf(records), days = WINDOW_DAYS) {
  const completeRecords = forPlatform(records, platform).filter(record => (
    isUsable(record) && windowCoverage(record, now, days).complete
  ));
  const posts = completeRecords.flatMap(record => windowPosts(record, now, days).map(post => ({
    post,
    handle: record.handle,
  })));
  return ['image', 'carousel', 'video', 'reel'].map(type => {
    const rows = posts.filter(row => row.post.type === type);
    const interactions = rows.map(row => postEngagement(row.post)).filter(value => value !== null);
    const comments = rows.map(row => row.post.comments).filter(value => typeof value === 'number');
    const views = rows.map(row => row.post.views).filter(value => typeof value === 'number');
    return {
      type,
      posts: rows.length,
      profiles: new Set(rows.map(row => row.handle)).size,
      comparablePosts: interactions.length,
      medianInteractions: median(interactions),
      averageInteractions: average(interactions),
      medianComments: median(comments),
      averageComments: average(comments),
      viewsReporting: views.length,
      medianViews: median(views),
      averageViews: average(views),
    };
  }).filter(row => row.posts > 0);
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
function growth(previousRecords, currentRecords, opts = {}) {
  if (!Array.isArray(previousRecords) || !previousRecords.length) return [];
  const baselineDays = typeof opts.baselineDays === 'number' && opts.baselineDays > 0
    ? opts.baselineDays
    : 7;
  const weeklyFactor = 7 / baselineDays;
  const previous = new Map(previousRecords.filter(isRankable).map(record => [keyOf(record), record]));
  const rows = [];
  for (const current of (currentRecords || []).filter(isRankable)) {
    const old = previous.get(keyOf(current));
    if (!old || !old.followers) continue;
    const periodFollowerDelta = current.followers - old.followers;
    const periodFollowerPct = periodFollowerDelta / old.followers;
    const followerPct = current.followers >= 0
      ? Math.pow(current.followers / old.followers, weeklyFactor) - 1
      : null;
    rows.push({
      name: current.name,
      role: current.role,
      platform: current.platform,
      handle: current.handle,
      followerDelta: periodFollowerDelta * weeklyFactor,
      followerPct,
      periodFollowerDelta,
      periodFollowerPct,
      baselineDays,
    });
  }
  return rankRows(rows, 'followerPct');
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
    const completeHandles = new Set(audits.filter(audit => audit.complete).map(audit => audit.handle));
    const completeRecords = pool.filter(record => completeHandles.has(record.handle));
    const completePosts = completeRecords.flatMap(record => windowPosts(record, now, days));
    const videos = completePosts.filter(post => post.type === 'video' || post.type === 'reel');
    const videosWithViews = videos.filter(post => typeof post.views === 'number');
    out[platform] = {
      mostFollowers: mostFollowers(records, platform),
      engagement: engagementLeaderboard(records, platform, now, days),
      postingFrequency: postingFrequency(records, platform, now, days),
      topPost: topPost(records, platform, now, days),
      topVideo: topVideo(records, platform, now, days),
      mostLiked: mostLiked(records, platform, now, days),
      mostViewed: mostViewed(records, platform, now, days),
      mostCommented: mostCommented(records, platform, now, days),
      mostShared: mostShared(records, platform, now, days),
      analytics: profileAnalytics(records, platform, now, days),
      formatAnalytics: formatAnalytics(records, platform, now, days),
      coverage: {
        windowDays: days,
        asOf: new Date(now).toISOString(),
        formula: 'postsPerWeek = unique authored posts in window × 7 ÷ 30',
        profiles: pool.length,
        completeWindowProfiles: audits.filter(audit => audit.complete).length,
        incompleteWindowProfiles: audits.filter(audit => !audit.complete).map(audit => audit.name),
        profilesWithPostsInWindow: audits.filter(audit => audit.complete && audit.postsInWindow > 0).length,
        eligibleEngagementProfiles: pool.filter(record => (
          windowCoverage(record, now, days).complete &&
          comparableWindowPosts(record, now, days).length >= MIN_ENGAGEMENT_POSTS
        )).length,
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
    note: 'Instagram momentum score: 15% followers, 45% typical engagement rate, 40% posting cadence. Profiles need complete 30-day coverage and at least three comparable posts.',
    composite: compositeLeaderboard(records, opts.weights || DEFAULT_WEIGHTS, now, days),
    weights: opts.weights || DEFAULT_WEIGHTS,
    windowDays: days,
  };
  return out;
}

module.exports = {
  isRankable, isUsable, postEngagement, engagementRate, avgEngagementPerPost,
  postsPerWeek, typicalEngagement, beyondFollowingCount, windowPosts, comparableWindowPosts,
  windowCoverage, uniquePosts, median, asOf, mostFollowers,
  engagementLeaderboard, postingFrequency, topPost, topVideo, mostViewed,
  mostLiked, mostCommented, mostShared, profileAnalytics, formatAnalytics,
  compositeLeaderboard, growth, buildLeaderboards,
  DEFAULT_WEIGHTS, WINDOW_DAYS, MIN_ENGAGEMENT_POSTS, MIN_MEASURED,
};
