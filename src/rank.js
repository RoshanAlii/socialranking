'use strict';

/*
 * rank.js — pure ranking engine.
 *
 * Consumes an array of NORMALIZED snapshot records (see normalize.js) and
 * produces leaderboards. No I/O, no side effects, fully testable.
 *
 * Honesty rules baked in:
 *  - A record is only RANKABLE if it resolved to a real public profile,
 *    is not private, and has a follower count. Private / unresolved people
 *    are surfaced as states, never estimated into a ranking.
 *  - engagementRate is a WITHIN-PLATFORM proxy. A TikTok view is not an
 *    Instagram reach, so cross-platform numbers are never blended silently.
 *  - Growth requires two snapshots. With one snapshot it returns [] — the
 *    UI shows "collecting" rather than inventing a trend.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// EVERY rate metric is measured over the SAME trailing window for everyone.
// Without this, the fixed per-person post fetch silently hands one person a
// 4-day window and another a 485-day window, and the two are not comparable.
const WINDOW_DAYS = 30;

// A profile is USABLE once it resolved publicly. Follower-based metrics need
// a follower count on top of that; view/comment/cadence metrics do not. Losing
// a follower count should not erase a person's video performance entirely.
function isUsable(r) {
  return !!r && r.resolved === true && r.isPrivate === false;
}
function isRankable(r) {
  return isUsable(r) && typeof r.followers === 'number' && r.followers >= 0;
}

function forPlatform(records, platform) {
  return records.filter(r => r.platform === platform);
}

function num(x) { return typeof x === 'number' && isFinite(x) ? x : 0; }

// Engagement for a single post: likes + comments + shares (views excluded —
// it is reach, not interaction). Missing fields count as 0, never guessed.
function postEngagement(p) {
  return num(p.likes) + num(p.comments) + num(p.shares);
}

function ts(p) {
  if (!p || !p.postedAt) return NaN;
  const t = new Date(p.postedAt).getTime();
  return isFinite(t) ? t : NaN;
}

// The clock the window is measured back from: the snapshot time, not "now".
// Re-scoring an old snapshot must produce the same numbers it did on the day.
function asOf(records) {
  const times = (records || []).map(r => r && r.capturedAt ? new Date(r.capturedAt).getTime() : NaN)
    .filter(t => isFinite(t));
  return times.length ? Math.max(...times) : Date.now();
}

// Posts authored inside the common window. Pinned posts are excluded: they sit
// at the top of a profile regardless of age, so they are not evidence of recent
// activity and their lifetime engagement is not comparable to a fresh post's.
function windowPosts(r, now, days = WINDOW_DAYS) {
  const cutoff = now - days * DAY_MS;
  return (Array.isArray(r.recentPosts) ? r.recentPosts : [])
    .filter(p => !p.isPinned)
    .filter(p => { const t = ts(p); return isFinite(t) && t >= cutoff && t <= now; });
}

function median(xs) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// MEDIAN, not mean. One reel that escapes the follower base and lands 51k likes
// on a 12k-follower account would drag a mean into nonsense (we measured 86.87%
// before this change). The median describes the typical post, which is what a
// person can actually act on.
function typicalEngagement(r, now, days) {
  const posts = windowPosts(r, now, days);
  if (posts.length === 0) return null;
  return median(posts.map(postEngagement));
}

function avgEngagementPerPost(r, now, days) {
  const posts = windowPosts(r, now === undefined ? asOf([r]) : now, days);
  if (posts.length === 0) return null;
  return posts.reduce((s, p) => s + postEngagement(p), 0) / posts.length;
}

// engagementRate = TYPICAL interactions per post / followers, within-platform.
// Honest about its own limits: followers is a stand-in for reach, and reels are
// served well beyond the follower base. Where a post reports views we can see
// that happening, so we count it and expose it rather than let it distort.
function engagementRate(r, now, days) {
  const n = now === undefined ? asOf([r]) : now;
  const typical = typicalEngagement(r, n, days);
  if (typical === null || !r.followers) return null;
  return typical / r.followers;
}

// How often a post out-reached the whole follower base. This is a signal in its
// own right (content travelling), not an error to be hidden.
function beyondFollowingCount(r, now, days) {
  const n = now === undefined ? asOf([r]) : now;
  if (!r.followers) return null;
  return windowPosts(r, n, days).filter(p => postEngagement(p) > r.followers).length;
}

// Posts per week across the COMMON window — the same denominator for everyone.
function postsPerWeek(r, now, days = WINDOW_DAYS) {
  const n = now === undefined ? asOf([r]) : now;
  const posts = windowPosts(r, n, days);
  if (posts.length === 0) return null;
  return posts.length / (days * DAY_MS / WEEK_MS);
}

function byDesc(key) {
  return (a, b) => (b[key] === null) - (a[key] === null) || num(b[key]) - num(a[key]);
}

function rankRows(rows, key) {
  const sorted = rows.slice().sort(byDesc(key));
  let lastVal = Symbol('none'), lastRank = 0;
  return sorted.map((row, i) => {
    const rank = row[key] === lastVal ? lastRank : (lastRank = i + 1, lastVal = row[key], lastRank);
    return Object.assign({ rank }, row);
  });
}

/* ---- individual leaderboards (single platform) ---- */

function mostFollowers(records, platform) {
  const rows = forPlatform(records, platform).filter(isRankable)
    .map(r => ({ name: r.name, role: r.role, handle: r.handle, followers: r.followers }));
  return rankRows(rows, 'followers');
}

function engagementLeaderboard(records, platform, now, days = WINDOW_DAYS) {
  const n = now === undefined ? asOf(records) : now;
  const rows = forPlatform(records, platform).filter(isRankable)
    .map(r => ({
      name: r.name, role: r.role, handle: r.handle,
      followers: r.followers,
      engagementRate: engagementRate(r, n, days),
      typicalEngagement: typicalEngagement(r, n, days),
      avgEngagement: avgEngagementPerPost(r, n, days),
      postsInWindow: windowPosts(r, n, days).length,
      beyondFollowing: beyondFollowingCount(r, n, days),
      basis: 'median interactions per post \u00f7 followers',
    }))
    .filter(r => r.engagementRate !== null);
  return rankRows(rows, 'engagementRate');
}

function postingFrequency(records, platform, now, days = WINDOW_DAYS) {
  const n = now === undefined ? asOf(records) : now;
  const rows = forPlatform(records, platform).filter(isUsable)
    .map(r => ({
      name: r.name, role: r.role, handle: r.handle,
      postsPerWeek: postsPerWeek(r, n, days),
      postsInWindow: windowPosts(r, n, days).length,
      windowDays: days,
    }))
    .filter(r => r.postsPerWeek !== null);
  return rankRows(rows, 'postsPerWeek');
}

// Best-performing post by INTERACTIONS. Ranking on views was structurally
// unfair: Instagram only reports view counts on older posts (we measured 19%
// coverage, median 63 days old vs 3 days for posts without), so a view-ranked
// board crowned year-old content and made anyone posting only recently
// ineligible to win at all. Likes and comments are present on every post.
function topPost(records, platform, now, days = WINDOW_DAYS) {
  const n = now === undefined ? asOf(records) : now;
  let best = null;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    for (const p of windowPosts(r, n, days)) {
      const e = postEngagement(p);
      if (!best || e > best.engagement) {
        best = { name: r.name, role: r.role, handle: r.handle, post: p, engagement: e };
      }
    }
  }
  return best;
}

// Views are still worth showing - but only with their scope stated out loud,
// never mixed into a ranking that posts without views could have won.
function mostViewed(records, platform) {
  let best = null, eligible = 0, considered = 0;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    for (const p of (r.recentPosts || [])) {
      if (p.type !== 'video' && p.type !== 'reel') continue;
      considered++;
      if (typeof p.views !== 'number') continue;
      eligible++;
      if (!best || p.views > best.post.views) best = { name: r.name, role: r.role, handle: r.handle, post: p };
    }
  }
  if (best) {
    best.coverage = { videosSeen: considered, videosReportingViews: eligible };
    best.caveat = 'Instagram reports view counts on only some posts, mostly older ones. '
      + 'This is the best of the ' + eligible + ' of ' + considered + ' videos that reported views \u2014 '
      + 'not necessarily the best video.';
  }
  return best;
}

// Retained under its old name so existing callers keep working, but it now
// means "best post by interactions", which everyone is eligible to win.
function topVideo(records, platform, now, days) {
  return topPost(records, platform, now, days);
}


function mostCommented(records, platform, now, days = WINDOW_DAYS) {
  const n = now === undefined ? asOf(records) : now;
  let best = null;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    for (const p of windowPosts(r, n, days)) {
      if (typeof p.comments !== 'number') continue;
      if (!best || p.comments > best.post.comments) best = { name: r.name, role: r.role, handle: r.handle, post: p };
    }
  }
  return best;
}

/* ---- combined, explicitly-weighted composite ---- */

// Followers is a STOCK - it mostly reflects how long someone has been here, and
// a new joiner can never overtake a 700k account. A board meant to help people
// improve should mostly reward what they can change this week, so followers is
// cut from 0.35 to 0.15 and the weight moved to engagement and consistency.
const DEFAULT_WEIGHTS = { followers: 0.15, engagementRate: 0.45, postsPerWeek: 0.40 };

// Below this many measured metrics a person is reported but NOT ranked. Scoring
// someone on a single metric and printing a rank next to it implies a comparison
// that was never made.
const MIN_MEASURED = 2;

function minMax(vals) {
  const nums = vals.filter(v => typeof v === 'number' && isFinite(v));
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return v => (typeof v !== 'number' || !isFinite(v) || hi === lo) ? 0 : (v - lo) / (hi - lo);
}

// Ranks a person's BEST platform presence, per metric, then weighted-sums the
// normalised scores. Weights are explicit and configurable — never a black box.
function bestOf(a, b) {
  // null means NOT MEASURED. It must never collapse to 0, which would be read
  // as "measured, and the worst" - that is how a new joiner with no posts yet
  // ended up ranked below everyone as though we had assessed them.
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

function compositeLeaderboard(records, weights = DEFAULT_WEIGHTS, now, days = WINDOW_DAYS) {
  const n = now === undefined ? asOf(records) : now;
  const byPerson = new Map();
  for (const r of records.filter(isRankable)) {
    const cur = byPerson.get(r.name)
      || { name: r.name, role: r.role, followers: null, engagementRate: null, postsPerWeek: null, platforms: [] };
    cur.followers = bestOf(cur.followers, typeof r.followers === 'number' ? r.followers : null);
    cur.engagementRate = bestOf(cur.engagementRate, engagementRate(r, n, days));
    cur.postsPerWeek = bestOf(cur.postsPerWeek, postsPerWeek(r, n, days));
    cur.platforms.push(r.platform);
    byPerson.set(r.name, cur);
  }
  const people = [...byPerson.values()];
  const norm = {
    followers: minMax(people.map(p => p.followers)),
    engagementRate: minMax(people.map(p => p.engagementRate)),
    postsPerWeek: minMax(people.map(p => p.postsPerWeek)),
  };

  const rows = people.map(p => {
    // Only the metrics we actually measured contribute, and the weights of the
    // ones we did measure are renormalised so the score stays on the same scale.
    const measured = Object.keys(weights).filter(k => typeof p[k] === 'number' && isFinite(p[k]));
    const totalW = measured.reduce((s, k) => s + weights[k], 0);
    const missing = Object.keys(weights).filter(k => !measured.includes(k));
    const score = totalW > 0
      ? measured.reduce((s, k) => s + (weights[k] / totalW) * norm[k](p[k]), 0)
      : null;
    return {
      name: p.name, role: p.role, platforms: [...new Set(p.platforms)],
      score, measuredMetrics: measured, missingMetrics: missing,
      provisional: measured.length < MIN_MEASURED,
    };
  });

  // Provisional people are returned so they stay visible, but unranked.
  const ranked = rankRows(rows.filter(r => !r.provisional && r.score !== null), 'score');
  const held = rows.filter(r => r.provisional || r.score === null)
    .map(r => Object.assign({ rank: null }, r,
      { note: 'Not ranked yet \u2014 only ' + r.measuredMetrics.length
        + ' of ' + Object.keys(weights).length + ' metrics could be measured ('
        + (r.missingMetrics.join(', ') || 'none') + ' unavailable).' }));
  return ranked.concat(held);
}

/* ---- growth: needs two snapshots ---- */

function keyOf(r) { return `${r.name}::${r.platform}::${r.handle}`; }

function growth(prevRecords, currRecords) {
  if (!Array.isArray(prevRecords) || prevRecords.length === 0) return [];
  const prev = new Map(prevRecords.filter(isRankable).map(r => [keyOf(r), r]));
  const rows = [];
  for (const c of currRecords.filter(isRankable)) {
    const p = prev.get(keyOf(c));
    if (!p) continue;
    rows.push({
      name: c.name, role: c.role, platform: c.platform, handle: c.handle,
      followerDelta: c.followers - p.followers,
      followerPct: p.followers ? (c.followers - p.followers) / p.followers : null,
    });
  }
  return rankRows(rows, 'followerDelta');
}

/* ---- assemble every leaderboard for a snapshot ---- */

function buildLeaderboards(records, platforms = ['instagram', 'tiktok', 'facebook'], opts = {}) {
  const days = opts.windowDays || WINDOW_DAYS;
  const now = opts.now === undefined ? asOf(records) : opts.now;
  const out = {};
  for (const pf of platforms) {
    const pool = forPlatform(records, pf).filter(isUsable);
    const vids = pool.reduce((s, r) => s + (r.recentPosts || []).filter(p => p.type === 'video' || p.type === 'reel').length, 0);
    const vidsWithViews = pool.reduce((s, r) => s + (r.recentPosts || []).filter(p => (p.type === 'video' || p.type === 'reel') && typeof p.views === 'number').length, 0);
    out[pf] = {
      mostFollowers: mostFollowers(records, pf),
      engagement: engagementLeaderboard(records, pf, now, days),
      postingFrequency: postingFrequency(records, pf, now, days),
      topPost: topPost(records, pf, now, days),
      topVideo: topPost(records, pf, now, days),   // legacy key, same fair board
      mostViewed: mostViewed(records, pf),
      mostCommented: mostCommented(records, pf, now, days),
      // The dashboard should be able to state the shape of its own blind spots.
      coverage: {
        windowDays: days,
        asOf: new Date(now).toISOString(),
        profiles: pool.length,
        profilesWithPostsInWindow: pool.filter(r => windowPosts(r, now, days).length > 0).length,
        postsInWindow: pool.reduce((s, r) => s + windowPosts(r, now, days).length, 0),
        videoViewReporting: { videos: vids, reportingViews: vidsWithViews,
          pct: vids ? Math.round(100 * vidsWithViews / vids) : null },
      },
    };
  }
  out.combined = {
    note: 'Composite blends normalised followers, engagement rate, and posting cadence across a person\u2019s best platform presence. Weights are explicit; cross-platform metrics are normalised, not raw-summed.',
    composite: compositeLeaderboard(records, opts.weights || DEFAULT_WEIGHTS, now, days),
    weights: opts.weights || DEFAULT_WEIGHTS,
    windowDays: days,
  };
  return out;
}

module.exports = {
  isRankable, isUsable, engagementRate, avgEngagementPerPost, postsPerWeek,
  typicalEngagement, beyondFollowingCount, windowPosts, median, asOf,
  mostFollowers, engagementLeaderboard, postingFrequency, topPost, topVideo,
  mostViewed, mostCommented, compositeLeaderboard, growth, buildLeaderboards,
  DEFAULT_WEIGHTS, WINDOW_DAYS, MIN_MEASURED,
};
