'use strict';

/*
 * Compact metric history.
 *
 * The full snapshots in data/history carry every post body and run about a
 * megabyte each. Committing one per day is how a repository stops being
 * clonable inside a year, and none of that weight is needed to draw a trend.
 * This module keeps one small numeric point per profile per capture, so the
 * dashboard can answer "is this going up?" without loading a single caption.
 *
 * Every point is derived with the same gated rank.js functions used for the
 * live board. A capture with an incomplete 30-day window records its follower
 * count (which is always a direct observation) and leaves the derived rate
 * fields null. Missing stays missing here too.
 */

const {
  isRankable, isUsable, windowCoverage, windowPosts, comparableWindowPosts,
  engagementRate, median, WINDOW_DAYS, MIN_ENGAGEMENT_POSTS,
} = require('./rank');

const SERIES_VERSION = 1;
const MAX_POINTS_PER_PROFILE = 730;
const MAX_TEAM_POINTS = 730;

function emptySeries() {
  return { version: SERIES_VERSION, updatedAt: null, windowDays: WINDOW_DAYS, profiles: {}, team: [] };
}

function seriesKey(platform, handle) {
  return `${platform}::${String(handle || '').toLowerCase()}`;
}

function round(value, places) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function dayOf(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : null;
}

/*
 * One point per profile. `complete` records whether the 30-day window was
 * provable at capture time; consumers must not treat a null rate as a zero.
 */
function profilePoint(record, now, days = WINDOW_DAYS, rosterVersion = null) {
  const complete = isUsable(record) && windowCoverage(record, now, days).complete;
  const posts = complete ? windowPosts(record, now, days) : [];
  const comparable = complete ? comparableWindowPosts(record, now, days) : [];
  const interactions = comparable
    .map(post => post.likes + post.comments)
    .filter(value => Number.isFinite(value));
  return {
    d: dayOf(record?.capturedAt) || dayOf(new Date(now).toISOString()),
    at: record?.capturedAt || new Date(now).toISOString(),
    /*
     * A point carries the roster it was measured against and whether the
     * validator later accepted it. Without those two fields a chart would
     * happily draw a line through captures the board itself refuses to rank —
     * which is the same "stale numbers presented as current" failure the
     * freshness gate exists to prevent, only drawn as a curve.
     */
    rosterVersion,
    validated: false,
    followers: typeof record?.followers === 'number' ? record.followers : null,
    following: typeof record?.following === 'number' ? record.following : null,
    lifetimePosts: typeof record?.postCount === 'number' ? record.postCount : null,
    complete,
    postsInWindow: complete ? posts.length : null,
    postsPerWeek: complete ? round(posts.length * 7 / days, 3) : null,
    comparablePosts: complete ? comparable.length : null,
    engagementRate: complete ? round(engagementRate(record, now, days), 6) : null,
    medianInteractions: complete ? median(interactions) : null,
  };
}

function teamPoint(records, now, days = WINDOW_DAYS, rosterVersion = null) {
  const usable = (records || []).filter(isUsable);
  const rankable = (records || []).filter(isRankable);
  const complete = usable.filter(record => windowCoverage(record, now, days).complete);
  const rates = complete
    .map(record => engagementRate(record, now, days))
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const cadences = complete.map(record => windowPosts(record, now, days).length * 7 / days);
  const postsInWindow = complete.reduce((sum, record) => sum + windowPosts(record, now, days).length, 0);
  return {
    d: dayOf(new Date(now).toISOString()),
    at: new Date(now).toISOString(),
    rosterVersion,
    validated: false,
    profiles: usable.length,
    rankableProfiles: rankable.length,
    completeProfiles: complete.length,
    activeProfiles: complete.filter(record => windowPosts(record, now, days).length > 0).length,
    eligibleEngagementProfiles: complete.filter(record => (
      comparableWindowPosts(record, now, days).length >= MIN_ENGAGEMENT_POSTS
    )).length,
    followers: rankable.reduce((sum, record) => sum + record.followers, 0),
    postsInWindow,
    medianEngagementRate: round(median(rates), 6),
    medianPostsPerWeek: round(median(cadences), 3),
  };
}

/*
 * Derive every point of one capture. Works from records alone so the historical
 * backfill and the live run share one code path — a stored leaderboard is never
 * trusted as the source of a trend line.
 */
function snapshotPoints(records, capturedAt, days = WINDOW_DAYS, platforms = ['instagram'], rosterVersion = null) {
  const now = Date.parse(capturedAt);
  if (!Number.isFinite(now)) throw new Error(`snapshotPoints needs a valid capturedAt, got ${capturedAt}`);
  const profiles = {};
  const team = {};
  for (const platform of platforms) {
    const pool = (records || []).filter(record => record.platform === platform);
    for (const record of pool) {
      if (!record.handle || !isUsable(record)) continue;
      profiles[seriesKey(platform, record.handle)] = Object.assign(
        { name: record.name, role: record.role || null, platform },
        profilePoint(record, now, days, rosterVersion),
      );
    }
    team[platform] = teamPoint(pool, now, days, rosterVersion);
  }
  return { at: new Date(now).toISOString(), day: dayOf(new Date(now).toISOString()), profiles, team };
}

function sortPoints(points) {
  return points.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/*
 * Later captures on the same calendar day replace earlier ones. A manual re-run
 * should correct the day, never add a second point that makes a flat week look
 * like a busy one.
 */
function mergePoint(existing, point, cap) {
  const kept = (existing || []).filter(item => item.d !== point.d);
  kept.push(point);
  const sorted = sortPoints(kept);
  return sorted.length > cap ? sorted.slice(sorted.length - cap) : sorted;
}

/*
 * `extraProfiles` tracks accounts that deserve a trend line but must not enter
 * the team aggregate — the company account being the case that matters. Adding
 * it to `records` would quietly inflate team audience by its whole following.
 */
function appendSnapshot(series, records, capturedAt, days = WINDOW_DAYS, platforms = ['instagram'], extraProfiles = [], rosterVersion = null) {
  const next = series && series.profiles ? JSON.parse(JSON.stringify(series)) : emptySeries();
  next.version = SERIES_VERSION;
  next.windowDays = days;
  const derived = snapshotPoints(records, capturedAt, days, platforms, rosterVersion);
  if (extraProfiles.length) {
    Object.assign(derived.profiles, snapshotPoints(extraProfiles, capturedAt, days, platforms, rosterVersion).profiles);
  }

  for (const [key, point] of Object.entries(derived.profiles)) {
    const { name, role, platform, ...values } = point;
    const entry = next.profiles[key] || { name, role, platform, points: [] };
    entry.name = name;
    entry.role = role;
    entry.platform = platform;
    entry.points = mergePoint(entry.points, values, MAX_POINTS_PER_PROFILE);
    next.profiles[key] = entry;
  }

  for (const [platform, point] of Object.entries(derived.team)) {
    const bucket = Array.isArray(next.team) ? { instagram: next.team } : (next.team || {});
    next.team = bucket;
    next.team[platform] = mergePoint(next.team[platform], point, MAX_TEAM_POINTS);
  }

  next.updatedAt = derived.at;
  return next;
}

/*
 * Marks the points belonging to one accepted capture. Only the validator calls
 * this, and only after every published answer in that capture has been
 * recomputed, so `validated: true` in the trend file means the same thing as
 * the stamp on the snapshot.
 */
function stampValidated(series, capturedAt) {
  const next = series && series.profiles ? JSON.parse(JSON.stringify(series)) : emptySeries();
  let stamped = 0;
  const mark = point => {
    if (point.at !== capturedAt) return point;
    stamped++;
    return Object.assign({}, point, { validated: true });
  };
  for (const entry of Object.values(next.profiles)) entry.points = entry.points.map(mark);
  if (Array.isArray(next.team)) next.team = next.team.map(mark);
  else for (const platform of Object.keys(next.team || {})) next.team[platform] = next.team[platform].map(mark);
  return { series: next, stamped };
}

function profileHistory(series, platform, handle) {
  return series?.profiles?.[seriesKey(platform, handle)]?.points || [];
}

function teamHistory(series, platform = 'instagram') {
  const team = series?.team;
  if (Array.isArray(team)) return team;
  return team?.[platform] || [];
}

/*
 * Change between the newest point and the newest point at least `days` old.
 * Returns null rather than reaching for the closest available point: a
 * "7-day change" measured over two days is a different number wearing the
 * same label.
 */
function changeOver(points, key, days, tolerance = 2) {
  const usable = sortPoints((points || []).filter(point => typeof point[key] === 'number' && Number.isFinite(point[key])));
  if (usable.length < 2) return null;
  const latest = usable[usable.length - 1];
  const target = Date.parse(latest.at) - days * 86400000;
  const window = tolerance * 86400000;
  let baseline = null;
  for (const point of usable.slice(0, -1)) {
    const at = Date.parse(point.at);
    if (Math.abs(at - target) > window) continue;
    if (!baseline || Math.abs(at - target) < Math.abs(Date.parse(baseline.at) - target)) baseline = point;
  }
  if (!baseline) return null;
  const from = baseline[key];
  const to = latest[key];
  const actualDays = (Date.parse(latest.at) - Date.parse(baseline.at)) / 86400000;
  return {
    from,
    to,
    delta: to - from,
    pct: from ? (to - from) / Math.abs(from) : null,
    fromAt: baseline.at,
    toAt: latest.at,
    days: round(actualDays, 2),
  };
}

module.exports = {
  emptySeries, seriesKey, snapshotPoints, appendSnapshot, profilePoint, teamPoint,
  profileHistory, teamHistory, changeOver, sortPoints, stampValidated,
  SERIES_VERSION, MAX_POINTS_PER_PROFILE,
};
