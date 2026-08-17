'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const MIN_ENGAGEMENT_POSTS = 3;
const MIN_MOMENTUM_POSTS = 5;
const MOMENTUM_RELIABILITY_PRIOR = 10;
const MIN_MEASURED = 3;
/*
 * The product brief asks who improved fastest, so improvement has to be inside
 * the score rather than parked on a side board. Follower growth is included
 * whenever a valid 5–11 day baseline exists; when it does not, its weight is
 * redistributed across the remaining inputs and the score declares which
 * components produced it. Followers stay deliberately small: audience is
 * accumulated history, not this month's effort.
 */
const DEFAULT_WEIGHTS = { followers: 0.10, engagementRate: 0.40, postsPerWeek: 0.30, followerGrowth: 0.20 };
const BASE_WEIGHTS = { followers: 0.15, engagementRate: 0.45, postsPerWeek: 0.40 };

function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
/*
 * `optOut` is the individual's own decision, recorded in the registry. An
 * opted-out person keeps their roster row and disappears from every ranking,
 * record, analytic and export produced here — one choke point so no board can
 * quietly reintroduce them.
 */
function isUsable(record) {
  return !!record && record.resolved === true && record.isPrivate === false && record.optOut !== true;
}
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
  return forPlatform(records, platform).filter(record => record.optOut !== true).map(record => {
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
    const comparableReels = posts.filter(post => post.type === 'reel' && postEngagement(post) !== null)
      .map(post => Object.assign({ interactions: postEngagement(post) }, post))
      .sort((a, b) => b.interactions - a.interactions);
    const latest = posts.slice().sort((a, b) => ts(b) - ts(a))[0] || null;
    const supportedTotal = (values, eligibleItems) => {
      if (!complete) return null;
      if (values.length) return values.reduce((sum, value) => sum + value, 0);
      // With no eligible content, zero is an observed fact. If content exists
      // but the provider omitted the metric, it must remain unknown.
      return eligibleItems === 0 ? 0 : null;
    };
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
      totalLikes: supportedTotal(likes, posts.length),
      totalComments: supportedTotal(comments, posts.length),
      totalShares: supportedTotal(shares, posts.length),
      totalViews: supportedTotal(views, videos.length),
      medianLikes: complete ? median(likes) : null,
      medianComments: complete ? median(comments) : null,
      medianViews: complete ? median(views) : null,
      averageLikes: complete ? average(likes) : null,
      averageComments: complete ? average(comments) : null,
      averageViews: complete ? average(views) : null,
      viewEfficiency: complete && record.followers > 0 && views.length
        ? median(views) / record.followers
        : null,
      totalViewEfficiency: complete && record.followers > 0 && views.length
        ? views.reduce((sum, value) => sum + value, 0) / record.followers
        : null,
      medianInteractions: complete ? median(interactions) : null,
      averageInteractions: complete ? average(interactions) : null,
      interactionRate: complete && record.followers > 0 && comparable.length >= MIN_ENGAGEMENT_POSTS
        ? median(interactions) / record.followers
        : null,
      observedInteractionRate: complete && record.followers > 0 && comparable.length
        ? median(interactions) / record.followers
        : null,
      commentRate: complete && record.followers > 0 && comments.length >= MIN_ENGAGEMENT_POSTS
        ? median(comments) / record.followers
        : null,
      observedCommentRate: complete && record.followers > 0 && comments.length
        ? median(comments) / record.followers
        : null,
      commentToLikeRatio: complete && likes.length && comments.length && median(likes) > 0
        ? median(comments) / median(likes)
        : null,
      videoCount: complete ? videos.length : null,
      carouselCount: complete ? posts.filter(post => post.type === 'carousel').length : null,
      imageCount: complete ? posts.filter(post => post.type === 'image').length : null,
      formatPerformance: complete ? byType : null,
      bestPost: complete && bestInteractions ? Object.assign({ interactions: bestInteractions.value }, bestInteractions.post) : null,
      mostLikedPost: complete && bestLikes ? bestLikes.post : null,
      mostCommentedPost: complete && bestComments ? bestComments.post : null,
      mostViewedPost: complete && bestViews ? bestViews.post : null,
      topReels: complete ? comparableReels.slice(0, 5) : null,
      lowestReels: complete ? comparableReels.slice().reverse().slice(0, 5) : null,
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

function teamBenchmarks(analytics) {
  const complete = (analytics || []).filter(row => row.windowComplete === true);
  const keys = [
    'followers', 'postsInWindow', 'postsPerWeek', 'activeDays', 'interactionRate',
    'medianInteractions', 'medianViews', 'viewEfficiency', 'totalViews', 'commentToLikeRatio',
  ];
  return Object.fromEntries(keys.map(key => [key, median(complete
    .map(row => row[key]).filter(value => typeof value === 'number' && Number.isFinite(value)))]));
}

function percentile(values, value) {
  const numbers = values.filter(item => typeof item === 'number' && Number.isFinite(item));
  if (typeof value !== 'number' || !Number.isFinite(value) || !numbers.length) return null;
  return Math.round(100 * numbers.filter(item => item <= value).length / numbers.length);
}

function withTeamComparisons(analytics) {
  const rows = analytics || [];
  const keys = ['followers', 'postsPerWeek', 'interactionRate', 'medianViews', 'viewEfficiency', 'totalViews'];
  const pools = Object.fromEntries(keys.map(key => [key, rows.map(row => row[key])]));
  return rows.map(row => Object.assign({}, row, {
    percentiles: Object.fromEntries(keys.map(key => [key, percentile(pools[key], row[key])])),
  }));
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

/*
 * Momentum is a relative team signal, not a raw totals race. Mid-rank
 * percentiles are deliberately used instead of min/max scaling: one breakout
 * reel or one very large account can no longer compress everybody else toward
 * zero. Ties receive the same midpoint and a one-person pool stays neutral.
 */
function percentileNormalizer(values) {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!numbers.length) return () => 0;
  if (numbers.length === 1) return value => (typeof value === 'number' && Number.isFinite(value)) ? 0.5 : 0;
  return value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    const first = numbers.findIndex(number => number === value);
    if (first < 0) {
      const below = numbers.filter(number => number < value).length;
      return below / (numbers.length - 1);
    }
    let last = first;
    while (last + 1 < numbers.length && numbers[last + 1] === value) last += 1;
    return ((first + last) / 2) / (numbers.length - 1);
  };
}

function momentumTransform(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (key === 'followers' || key === 'postsPerWeek') return Math.log1p(Math.max(0, value));
  if (key === 'engagementRate') return Math.log1p(Math.max(0, value) * 100);
  if (key === 'followerGrowth') return Math.sign(value) * Math.log1p(Math.abs(value) * 100);
  return value;
}
/*
 * Weights are declared for every possible component, but only the components
 * actually measurable in this snapshot participate. Dropping one and leaving
 * the rest at their original weights would silently rescale everyone's score,
 * so the survivors are renormalised back to a total of 1 and the active set is
 * published alongside the board.
 */
function activeWeights(weights, available) {
  const active = Object.keys(weights).filter(key => available.includes(key));
  const total = active.reduce((sum, key) => sum + weights[key], 0);
  if (!active.length || !total) return {};
  return Object.fromEntries(active.map(key => [key, Math.round((weights[key] / total) * 1e6) / 1e6]));
}

/*
 * The two default sets are reviewed pairs, not one set with a hole in it: the
 * no-growth board keeps the original 15/45/40 balance rather than inheriting a
 * silently rescaled version of the growth-aware weights. A caller supplying its
 * own weights gets them renormalised instead.
 */
function resolveWeights(weights, growthAvailable) {
  const base = (!growthAvailable && weights === DEFAULT_WEIGHTS) ? BASE_WEIGHTS : weights;
  return activeWeights(base, growthAvailable
    ? ['followers', 'engagementRate', 'postsPerWeek', 'followerGrowth']
    : ['followers', 'engagementRate', 'postsPerWeek']);
}

const WEIGHT_LABELS = {
  followers: 'follower base',
  engagementRate: 'typical engagement',
  postsPerWeek: 'posting cadence',
  followerGrowth: 'follower growth',
};

function compositeLeaderboard(records, weights = DEFAULT_WEIGHTS, now = asOf(records), days = WINDOW_DAYS, growthRows = []) {
  const growthByKey = new Map((growthRows || [])
    .filter(row => row.platform === 'instagram' && typeof row.followerPct === 'number' && Number.isFinite(row.followerPct))
    .map(row => [`${row.name}::${row.handle}`, row]));
  const growthAvailable = growthByKey.size > 0;
  const people = forPlatform(records, 'instagram').filter(isRankable).map(record => {
    const coverage = windowCoverage(record, now, days);
    const comparablePosts = comparableWindowPosts(record, now, days).length;
    return {
      name: record.name,
      role: record.role,
      // The handle is what every other board is keyed by; without it a consumer
      // cannot join a composite row back to its engagement or cadence figures.
      handle: record.handle,
      platforms: ['instagram'],
      followers: record.followers,
      engagementRate: coverage.complete ? engagementRate(record, now, days) : null,
      postsPerWeek: postsPerWeek(record, now, days),
      followerGrowth: growthAvailable
        ? (growthByKey.get(`${record.name}::${record.handle}`)?.followerPct ?? null)
        : null,
      comparablePosts,
      windowComplete: coverage.complete,
    };
  });
  const applied = resolveWeights(weights, growthAvailable);
  const keys = Object.keys(applied);
  const engagementPool = people.filter(person => (
    person.windowComplete && person.comparablePosts >= MIN_MOMENTUM_POSTS &&
    typeof person.engagementRate === 'number' && Number.isFinite(person.engagementRate)
  ));
  const teamMedianEngagement = median(engagementPool.map(person => person.engagementRate));
  const prepared = people.map(person => {
    const engagementReliability = person.comparablePosts / (person.comparablePosts + MOMENTUM_RELIABILITY_PRIOR);
    const adjustedEngagement = typeof person.engagementRate === 'number' && typeof teamMedianEngagement === 'number'
      ? engagementReliability * person.engagementRate + (1 - engagementReliability) * teamMedianEngagement
      : person.engagementRate;
    const adjusted = Object.assign({}, person, { engagementRate: adjustedEngagement });
    const measured = keys.filter(key => typeof person[key] === 'number' && Number.isFinite(person[key]));
    const missing = keys.filter(key => !measured.includes(key));
    const eligibilityReasons = [];
    if (!person.windowComplete) eligibilityReasons.push('incomplete 30-day coverage');
    if (person.comparablePosts < MIN_MOMENTUM_POSTS) {
      eligibilityReasons.push(`${person.comparablePosts}/${MIN_MOMENTUM_POSTS} comparable posts`);
    }
    if (missing.length) eligibilityReasons.push(`${missing.join(', ')} unavailable`);
    return {
      person,
      adjusted,
      measured,
      missing,
      eligibilityReasons,
      engagementReliability,
      eligible: eligibilityReasons.length === 0,
      transformed: Object.fromEntries(keys.map(key => [key, momentumTransform(key, adjusted[key])])),
    };
  });
  const eligible = prepared.filter(row => row.eligible);
  const normalizers = Object.fromEntries(keys.map(key => [key, percentileNormalizer(eligible.map(row => row.transformed[key]))]));
  const rows = prepared.map(row => {
    const normalized = Object.fromEntries(keys.map(key => [key, normalizers[key](row.transformed[key])]));
    const score = row.eligible ? keys.reduce((sum, key) => sum + applied[key] * normalized[key], 0) : null;
    return {
      name: row.person.name,
      role: row.person.role,
      handle: row.person.handle,
      platforms: row.person.platforms,
      score,
      components: Object.fromEntries(keys.map(key => [key, typeof row.person[key] === 'number' ? row.person[key] : null])),
      adjustedComponents: Object.fromEntries(keys.map(key => [key, typeof row.adjusted[key] === 'number' ? row.adjusted[key] : null])),
      normalizedComponents: normalized,
      measuredMetrics: row.measured,
      missingMetrics: row.missing,
      provisional: !row.eligible,
      eligibilityReasons: row.eligibilityReasons,
      sample: {
        comparablePosts: row.person.comparablePosts,
        minimumComparablePosts: MIN_MOMENTUM_POSTS,
        engagementReliability: Math.round(row.engagementReliability * 1000) / 1000,
      },
    };
  });
  const ranked = rankRows(rows.filter(row => !row.provisional && row.score !== null), 'score');
  const held = rows.filter(row => row.provisional || row.score === null).map(row => Object.assign({ rank: null }, row, {
    note: row.missingMetrics.includes('followerGrowth') && row.missingMetrics.length === 1
      ? 'Awaiting a comparable momentum sample — no 5–11 day follower baseline exists for this profile.'
      : `Awaiting a comparable momentum sample — ${row.eligibilityReasons.join('; ') || 'required data unavailable'}.`,
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
    const analytics = profileAnalytics(records, platform, now, days);
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
      analytics: withTeamComparisons(analytics),
      teamBenchmarks: teamBenchmarks(analytics),
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
  const weights = opts.weights || DEFAULT_WEIGHTS;
  const growthRows = Array.isArray(opts.growth) ? opts.growth : [];
  const growthUsable = growthRows.some(row => (
    row.platform === 'instagram' && typeof row.followerPct === 'number' && Number.isFinite(row.followerPct)
  ));
  const applied = resolveWeights(weights, growthUsable);
  out.combined = {
    note: `Instagram momentum score: ${Object.entries(applied)
      .map(([key, value]) => `${Math.round(value * 100)}% ${WEIGHT_LABELS[key] || key}`)
      .join(', ')}. Components use outlier-resistant mid-rank percentiles; follower base and cadence are log-scaled, and engagement is reliability-adjusted toward the team median. Profiles need complete ${days}-day coverage, at least ${MIN_MOMENTUM_POSTS} comparable posts${growthUsable ? ', and a 5–11 day follower baseline' : ''}.`,
    composite: compositeLeaderboard(records, weights, now, days, growthRows),
    weights: applied,
    declaredWeights: weights,
    growthIncluded: growthUsable,
    windowDays: days,
    normalization: {
      method: 'mid-rank percentile',
      followerAndCadenceTransform: 'log1p',
      engagementTransform: 'reliability-adjusted log1p',
      engagementPriorPosts: MOMENTUM_RELIABILITY_PRIOR,
      minimumComparablePosts: MIN_MOMENTUM_POSTS,
    },
  };

  /*
   * A second, shorter window for the same inputs. Thirty days is the fair unit
   * for judging anyone, but it is also slow to notice a change in behaviour;
   * the seven-day view is what makes "did last week work?" answerable. Both are
   * recomputed from the same posts, so neither can drift from the other.
   */
  const alternates = (opts.alternateWindows || []).filter(value => (
    typeof value === 'number' && value > 0 && value !== days
  ));
  if (alternates.length) {
    out.alternateWindows = {};
    for (const altDays of alternates) {
      const perPlatform = {};
      for (const platform of platforms) {
        perPlatform[platform] = {
          engagement: engagementLeaderboard(records, platform, now, altDays),
          postingFrequency: postingFrequency(records, platform, now, altDays),
          topPost: topPost(records, platform, now, altDays),
          coverage: {
            windowDays: altDays,
            asOf: new Date(now).toISOString(),
            formula: `postsPerWeek = unique authored posts in window × 7 ÷ ${altDays}`,
            completeWindowProfiles: forPlatform(records, platform).filter(record => (
              isUsable(record) && windowCoverage(record, now, altDays).complete
            )).length,
            profilesWithPostsInWindow: forPlatform(records, platform).filter(record => (
              isUsable(record) && windowCoverage(record, now, altDays).complete &&
              windowPosts(record, now, altDays).length > 0
            )).length,
          },
        };
      }
      out.alternateWindows[String(altDays)] = Object.assign(perPlatform, {
        composite: compositeLeaderboard(records, weights, now, altDays, growthRows),
      });
    }
  }
  return out;
}

module.exports = {
  isRankable, isUsable, postEngagement, engagementRate, avgEngagementPerPost,
  postsPerWeek, typicalEngagement, beyondFollowingCount, windowPosts, comparableWindowPosts,
  windowCoverage, uniquePosts, median, asOf, mostFollowers,
  engagementLeaderboard, postingFrequency, topPost, topVideo, mostViewed,
  mostLiked, mostCommented, mostShared, profileAnalytics, formatAnalytics,
  teamBenchmarks, withTeamComparisons, percentile,
  compositeLeaderboard, growth, buildLeaderboards, activeWeights, resolveWeights,
  DEFAULT_WEIGHTS, BASE_WEIGHTS, WINDOW_DAYS, MIN_ENGAGEMENT_POSTS, MIN_MOMENTUM_POSTS, MIN_MEASURED,
};
