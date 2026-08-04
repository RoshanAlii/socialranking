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

function avgEngagementPerPost(r) {
  const posts = Array.isArray(r.recentPosts) ? r.recentPosts : [];
  if (posts.length === 0) return null;
  const total = posts.reduce((s, p) => s + postEngagement(p), 0);
  return total / posts.length;
}

// engagementRate = avg interactions per post / followers. Proxy, per platform.
function engagementRate(r) {
  const avg = avgEngagementPerPost(r);
  if (avg === null || !r.followers) return null;
  return avg / r.followers;
}

// posts per week over the span of the recent posts we can see.
// Pinned posts are EXCLUDED: they surface at the top of a profile regardless
// of age, so counting them stretches the window and understates real cadence.
function postsPerWeek(r) {
  const posts = (Array.isArray(r.recentPosts) ? r.recentPosts : [])
    .filter(p => p.postedAt && !p.isPinned)
    .map(p => new Date(p.postedAt).getTime())
    .filter(t => isFinite(t))
    .sort((a, b) => a - b);
  if (posts.length === 0) return null;
  if (posts.length === 1) return 1; // one post seen, can't measure cadence — report 1
  const spanWeeks = Math.max((posts[posts.length - 1] - posts[0]) / WEEK_MS, 1);
  return posts.length / spanWeeks;
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

function engagementLeaderboard(records, platform) {
  const rows = forPlatform(records, platform).filter(isRankable)
    .map(r => ({
      name: r.name, role: r.role, handle: r.handle,
      followers: r.followers,
      engagementRate: engagementRate(r),
      avgEngagement: avgEngagementPerPost(r),
    }))
    .filter(r => r.engagementRate !== null);
  return rankRows(rows, 'engagementRate');
}

function postingFrequency(records, platform) {
  const rows = forPlatform(records, platform).filter(isUsable)
    .map(r => ({ name: r.name, role: r.role, handle: r.handle, postsPerWeek: postsPerWeek(r) }))
    .filter(r => r.postsPerWeek !== null);
  return rankRows(rows, 'postsPerWeek');
}

// Single best-performing video/reel across the platform, by views.
function topVideo(records, platform) {
  let best = null;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    for (const p of (r.recentPosts || [])) {
      if (p.type !== 'video' && p.type !== 'reel') continue;
      if (typeof p.views !== 'number') continue;
      if (!best || p.views > best.post.views) best = { name: r.name, role: r.role, handle: r.handle, post: p };
    }
  }
  return best;
}

function mostCommented(records, platform) {
  let best = null;
  for (const r of forPlatform(records, platform).filter(isUsable)) {
    for (const p of (r.recentPosts || [])) {
      if (typeof p.comments !== 'number') continue;
      if (!best || p.comments > best.post.comments) best = { name: r.name, role: r.role, handle: r.handle, post: p };
    }
  }
  return best;
}

/* ---- combined, explicitly-weighted composite ---- */

const DEFAULT_WEIGHTS = { followers: 0.35, engagementRate: 0.40, postsPerWeek: 0.25 };

function minMax(vals) {
  const nums = vals.filter(v => typeof v === 'number' && isFinite(v));
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return v => (typeof v !== 'number' || !isFinite(v) || hi === lo) ? 0 : (v - lo) / (hi - lo);
}

// Ranks a person's BEST platform presence, per metric, then weighted-sums the
// normalised scores. Weights are explicit and configurable — never a black box.
function compositeLeaderboard(records, weights = DEFAULT_WEIGHTS) {
  const byPerson = new Map();
  for (const r of records.filter(isRankable)) {
    const cur = byPerson.get(r.name) || { name: r.name, role: r.role, followers: 0, engagementRate: 0, postsPerWeek: 0, platforms: [] };
    cur.followers = Math.max(cur.followers, num(r.followers));
    cur.engagementRate = Math.max(cur.engagementRate, num(engagementRate(r)));
    cur.postsPerWeek = Math.max(cur.postsPerWeek, num(postsPerWeek(r)));
    cur.platforms.push(r.platform);
    byPerson.set(r.name, cur);
  }
  const people = [...byPerson.values()];
  const nf = minMax(people.map(p => p.followers));
  const ne = minMax(people.map(p => p.engagementRate));
  const np = minMax(people.map(p => p.postsPerWeek));
  const rows = people.map(p => ({
    name: p.name, role: p.role, platforms: [...new Set(p.platforms)],
    score: weights.followers * nf(p.followers) + weights.engagementRate * ne(p.engagementRate) + weights.postsPerWeek * np(p.postsPerWeek),
  }));
  return rankRows(rows, 'score');
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

function buildLeaderboards(records, platforms = ['instagram', 'tiktok', 'facebook']) {
  const out = {};
  for (const pf of platforms) {
    out[pf] = {
      mostFollowers: mostFollowers(records, pf),
      engagement: engagementLeaderboard(records, pf),
      postingFrequency: postingFrequency(records, pf),
      topVideo: topVideo(records, pf),
      mostCommented: mostCommented(records, pf),
    };
  }
  out.combined = {
    note: 'Composite blends normalised followers, engagement rate, and posting cadence across a person\u2019s best platform presence. Weights are explicit; cross-platform metrics are normalised, not raw-summed.',
    composite: compositeLeaderboard(records),
  };
  return out;
}

module.exports = {
  isRankable, isUsable, engagementRate, avgEngagementPerPost, postsPerWeek,
  mostFollowers, engagementLeaderboard, postingFrequency, topVideo, mostCommented,
  compositeLeaderboard, growth, buildLeaderboards, DEFAULT_WEIGHTS,
};
