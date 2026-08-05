'use strict';

/*
 * Content intelligence.
 *
 * The measurement engine in rank.js answers "how much". This answers "what
 * worked" — which formats, which posting hours, which hashtags, which caption
 * lengths — so the board can hand somebody a next step they could not have
 * worked out by staring at their own profile.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. Only profiles with a provable 30-day window contribute. A partial feed
 *    would quietly bias every "best time to post" claim towards whoever the
 *    scraper happened to read most deeply.
 * 2. Comparisons use interaction RATE (interactions ÷ followers), never raw
 *    interactions. A 700k founder account and a 400-follower new joiner both
 *    post reels; ranking hashtags by raw likes would just re-rank the founder.
 *
 * Anything with too few observations is withheld rather than published with a
 * shrug. The thresholds are exported so the dashboard can state them.
 */

const {
  isUsable, windowCoverage, windowPosts, postEngagement, engagementRate, median, asOf, WINDOW_DAYS,
} = require('./rank');

const DAY_MS = 24 * 60 * 60 * 1000;
// Asia/Dubai is UTC+4 year-round with no daylight saving, so a fixed offset is
// exact here. Any timing claim is meaningless without saying whose clock it is.
const TZ_OFFSET_HOURS = Number(process.env.KIRPA_TZ_OFFSET_HOURS || 4);
const TZ_LABEL = process.env.KIRPA_TZ_LABEL || 'Asia/Dubai (UTC+4)';
/*
 * A median over three posts is one post wearing a disguise. With three, a
 * single reel that out-reached its whole follower base made one hashtag show a
 * 787× lift — a real event, but not a pattern anyone can act on. Five posts
 * across three profiles keeps a breakout post off the median while still
 * admitting genuinely common tags.
 */
const MIN_POSTS_PER_HASHTAG = 5;
const MIN_PROFILES_PER_HASHTAG = 3;
const MIN_POSTS_PER_BUCKET = 3;
// Bars for turning a team-wide pattern into personal advice. Publishing is
// cheap and being wrong is not, so a team pattern has to be both well sampled
// and clearly better than the team's own typical rate before it is recommended.
const MIN_POSTS_FOR_TEAM_ADVICE = 8;
const MIN_PROFILES_FOR_TEAM_ADVICE = 3;
const MIN_TIMING_LIFT = 1.25;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_BLOCKS = [
  { key: 'early', label: '00:00–06:00', from: 0, to: 6 },
  { key: 'morning', label: '06:00–11:00', from: 6, to: 11 },
  { key: 'midday', label: '11:00–15:00', from: 11, to: 15 },
  { key: 'afternoon', label: '15:00–19:00', from: 15, to: 19 },
  { key: 'evening', label: '19:00–22:00', from: 19, to: 22 },
  { key: 'late', label: '22:00–24:00', from: 22, to: 24 },
];
const CAPTION_BUCKETS = [
  { key: 'none', label: 'No caption', from: 0, to: 1 },
  { key: 'short', label: '1–80 characters', from: 1, to: 81 },
  { key: 'medium', label: '81–300 characters', from: 81, to: 301 },
  { key: 'long', label: '301–800 characters', from: 301, to: 801 },
  { key: 'story', label: '800+ characters', from: 801, to: Infinity },
];

function round(value, places) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}
function localParts(iso) {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return null;
  const shifted = new Date(at + TZ_OFFSET_HOURS * 3600000);
  return { day: shifted.getUTCDay(), hour: shifted.getUTCHours() };
}
function hourBlock(hour) {
  return HOUR_BLOCKS.find(block => hour >= block.from && hour < block.to) || null;
}
function captionBucket(caption) {
  const length = String(caption || '').trim().length;
  return CAPTION_BUCKETS.find(bucket => length >= bucket.from && length < bucket.to) || null;
}
function hashtagsIn(caption) {
  const matches = String(caption || '').match(/#[\p{L}\p{N}_]+/gu) || [];
  return [...new Set(matches.map(tag => tag.slice(1).toLowerCase()))];
}
function interactionRate(post, followers) {
  const interactions = postEngagement(post);
  if (interactions === null || typeof followers !== 'number' || !Number.isFinite(followers) || followers <= 0) return null;
  return interactions / followers;
}

/*
 * Every post from every profile with a provable window, carried alongside the
 * follower count needed to turn it into a rate.
 */
function measurablePosts(records, platform, now, days = WINDOW_DAYS) {
  const rows = [];
  for (const record of (records || []).filter(item => item.platform === platform)) {
    if (!isUsable(record)) continue;
    if (!windowCoverage(record, now, days).complete) continue;
    for (const post of windowPosts(record, now, days)) {
      rows.push({
        post,
        name: record.name,
        handle: record.handle,
        followers: typeof record.followers === 'number' ? record.followers : null,
        interactions: postEngagement(post),
        rate: interactionRate(post, record.followers),
      });
    }
  }
  /*
   * Rate alone still carries the account inside it: a hashtag used mostly by
   * two small, high-engagement profiles will look like a brilliant hashtag when
   * it is really just those two profiles. `authorLift` divides each post by its
   * own author's typical rate, so a tag, time slot or caption length is judged
   * on whether it beat that person's own baseline — the only comparison that
   * survives being copied by somebody else.
   */
  const baselines = new Map();
  for (const handle of new Set(rows.map(row => row.handle))) {
    const rates = rows.filter(row => row.handle === handle).map(row => row.rate).filter(value => typeof value === 'number');
    baselines.set(handle, median(rates));
  }
  for (const row of rows) {
    const baseline = baselines.get(row.handle);
    row.authorLift = typeof row.rate === 'number' && typeof baseline === 'number' && baseline > 0
      ? row.rate / baseline
      : null;
  }
  return rows;
}

function summarize(rows) {
  const rates = rows.map(row => row.rate).filter(value => typeof value === 'number' && Number.isFinite(value));
  const interactions = rows.map(row => row.interactions).filter(value => typeof value === 'number' && Number.isFinite(value));
  const lifts = rows.map(row => row.authorLift).filter(value => typeof value === 'number' && Number.isFinite(value));
  return {
    posts: rows.length,
    profiles: new Set(rows.map(row => row.handle)).size,
    ratedPosts: rates.length,
    medianRate: round(median(rates), 6),
    medianInteractions: median(interactions),
    // How the typical post here compares with its own author's typical post.
    authorLift: round(median(lifts), 3),
  };
}

function hashtagPerformance(records, platform, now = asOf(records), days = WINDOW_DAYS, opts = {}) {
  const minPosts = opts.minPosts || MIN_POSTS_PER_HASHTAG;
  const minProfiles = opts.minProfiles || MIN_PROFILES_PER_HASHTAG;
  const rows = measurablePosts(records, platform, now, days);
  const buckets = new Map();
  for (const row of rows) {
    for (const tag of hashtagsIn(row.post.caption)) {
      if (!buckets.has(tag)) buckets.set(tag, []);
      buckets.get(tag).push(row);
    }
  }
  const baseline = summarize(rows).medianRate;
  return [...buckets.entries()]
    .map(([tag, tagRows]) => {
      const stats = summarize(tagRows);
      return Object.assign({ tag }, stats, {
        liftVsTeam: baseline && stats.medianRate !== null ? round(stats.medianRate / baseline, 3) : null,
        users: [...new Set(tagRows.map(row => row.handle))],
      });
    })
    .filter(row => row.posts >= minPosts && row.profiles >= minProfiles && row.authorLift !== null)
    .sort((a, b) => b.authorLift - a.authorLift);
}

function timingPerformance(records, platform, now = asOf(records), days = WINDOW_DAYS, opts = {}) {
  const minPosts = opts.minPosts || MIN_POSTS_PER_BUCKET;
  const rows = measurablePosts(records, platform, now, days);
  const grid = new Map();
  for (const row of rows) {
    const parts = localParts(row.post.postedAt);
    if (!parts) continue;
    const block = hourBlock(parts.hour);
    if (!block) continue;
    const key = `${parts.day}|${block.key}`;
    if (!grid.has(key)) grid.set(key, { day: parts.day, block, rows: [] });
    grid.get(key).rows.push(row);
  }
  const cells = [...grid.values()].map(cell => Object.assign({
    day: cell.day,
    dayName: DAY_NAMES[cell.day],
    block: cell.block.key,
    blockLabel: cell.block.label,
  }, summarize(cell.rows)));
  const byDay = DAY_NAMES.map((dayName, day) => {
    const dayRows = rows.filter(row => localParts(row.post.postedAt)?.day === day);
    return Object.assign({ day, dayName }, summarize(dayRows));
  }).filter(row => row.posts > 0);
  const byBlock = HOUR_BLOCKS.map(block => {
    const blockRows = rows.filter(row => {
      const parts = localParts(row.post.postedAt);
      return parts && hourBlock(parts.hour)?.key === block.key;
    });
    return Object.assign({ block: block.key, blockLabel: block.label }, summarize(blockRows));
  }).filter(row => row.posts > 0);
  const eligible = cells.filter(cell => cell.posts >= minPosts && cell.medianRate !== null);
  return {
    timezone: TZ_LABEL,
    minPosts,
    totalPosts: rows.length,
    cells: cells.sort((a, b) => a.day - b.day),
    byDay,
    byBlock,
    best: eligible.slice().sort((a, b) => b.medianRate - a.medianRate)[0] || null,
    worst: eligible.slice().sort((a, b) => a.medianRate - b.medianRate)[0] || null,
  };
}

function captionPerformance(records, platform, now = asOf(records), days = WINDOW_DAYS, opts = {}) {
  const minPosts = opts.minPosts || MIN_POSTS_PER_BUCKET;
  const rows = measurablePosts(records, platform, now, days);
  return CAPTION_BUCKETS.map(bucket => {
    const bucketRows = rows.filter(row => captionBucket(row.post.caption)?.key === bucket.key);
    return Object.assign({ bucket: bucket.key, bucketLabel: bucket.label, minPosts }, summarize(bucketRows));
  }).filter(row => row.posts >= minPosts);
}

/*
 * Weekly buckets counted back from the capture instant, so "this week" means
 * the last seven days rather than whatever the calendar says. A 30-day window
 * holds four complete weeks; nothing longer is claimed from it.
 */
function postingWeeks(record, now = asOf([record]), days = WINDOW_DAYS) {
  if (!isUsable(record) || !windowCoverage(record, now, days).complete) return null;
  const weeks = Math.floor(days / 7);
  const posts = windowPosts(record, now, days);
  const buckets = Array.from({ length: weeks }, (_, index) => {
    const to = now - index * 7 * DAY_MS;
    const from = to - 7 * DAY_MS;
    const inWeek = posts.filter(post => {
      const at = Date.parse(post.postedAt || '');
      return Number.isFinite(at) && at > from && at <= to;
    });
    return { weeksAgo: index, from: new Date(from).toISOString(), to: new Date(to).toISOString(), posts: inWeek.length };
  });
  let streak = 0;
  for (const bucket of buckets) {
    if (bucket.posts > 0) streak++;
    else break;
  }
  return {
    weeks: buckets,
    weeksMeasured: weeks,
    activeWeeks: buckets.filter(bucket => bucket.posts > 0).length,
    currentStreakWeeks: streak,
    streakCappedBy: streak === weeks ? `${weeks}-week measurement window` : null,
  };
}

function daysSinceLastPost(record, now = asOf([record]), days = WINDOW_DAYS) {
  if (!isUsable(record)) return null;
  const times = windowPosts(record, now, days)
    .map(post => Date.parse(post.postedAt || ''))
    .filter(Number.isFinite);
  if (!times.length) return null;
  return round((now - Math.max(...times)) / DAY_MS, 1);
}

function targetsFor(employee, defaults) {
  const base = defaults || {};
  const own = employee?.targets || {};
  const merged = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(own)])) {
    const value = own[key] !== undefined ? own[key] : base[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) merged[key] = value;
  }
  return merged;
}

/*
 * Progress is only ever reported against a measured value. A person whose
 * window could not be proved has no progress — not 0%.
 */
function goalProgress(record, employee, defaults, now = asOf([record]), days = WINDOW_DAYS) {
  const targets = targetsFor(employee, defaults);
  const complete = isUsable(record) && windowCoverage(record, now, days).complete;
  const measured = {
    postsPerWeek: complete ? windowPosts(record, now, days).length * 7 / days : null,
    engagementRate: complete ? engagementRate(record, now, days) : null,
  };
  const goals = Object.keys(targets).map(key => {
    const value = measured[key] === undefined ? null : measured[key];
    return {
      metric: key,
      target: targets[key],
      value: typeof value === 'number' ? round(value, 6) : null,
      progress: typeof value === 'number' ? round(value / targets[key], 3) : null,
      met: typeof value === 'number' ? value >= targets[key] : null,
    };
  });
  return {
    goals,
    metCount: goals.filter(goal => goal.met === true).length,
    measurableCount: goals.filter(goal => goal.met !== null).length,
  };
}

function personFormatMix(record, now, days) {
  const posts = windowPosts(record, now, days);
  const followers = record.followers;
  return ['reel', 'video', 'carousel', 'image'].map(type => {
    const typePosts = posts.filter(post => post.type === type);
    const rates = typePosts.map(post => interactionRate(post, followers)).filter(value => typeof value === 'number');
    return {
      type,
      posts: typePosts.length,
      share: posts.length ? round(typePosts.length / posts.length, 3) : null,
      medianRate: round(median(rates), 6),
      ratedPosts: rates.length,
    };
  }).filter(row => row.posts > 0);
}

/*
 * Rule-based coaching, each line carrying the number that produced it. Rules
 * only fire when their evidence clears a minimum sample, and the strongest
 * three are returned — a list of nine suggestions is a list nobody reads.
 */
function nextActions(record, context = {}) {
  const days = context.days || WINDOW_DAYS;
  const now = context.now || asOf([record]);
  const actions = [];
  if (!isUsable(record)) return actions;
  const complete = windowCoverage(record, now, days).complete;
  if (!complete) return actions;

  const posts = windowPosts(record, now, days);
  const cadence = posts.length * 7 / days;
  const weeks = postingWeeks(record, now, days);
  const silentDays = daysSinceLastPost(record, now, days);
  const mix = personFormatMix(record, now, days);
  const rated = mix.filter(row => row.medianRate !== null && row.ratedPosts >= 2);
  const targets = context.targets || {};
  const benchmarks = context.benchmarks || {};
  const rate = context.engagementRate;

  if (posts.length === 0) {
    actions.push({
      priority: 1,
      action: 'Publish once this week to re-enter the rankings.',
      because: `No posts in the last ${days} days, so cadence and engagement cannot be scored.`,
    });
    return actions;
  }

  if (typeof silentDays === 'number' && silentDays >= 10) {
    actions.push({
      priority: 1,
      action: 'Post in the next 48 hours.',
      because: `${silentDays} days since the last post — the longest gap on this profile in the window.`,
    });
  }

  if (typeof targets.postsPerWeek === 'number' && cadence < targets.postsPerWeek) {
    const gap = Math.ceil((targets.postsPerWeek - cadence) * 4);
    actions.push({
      priority: 2,
      action: `Add ${gap} post${gap === 1 ? '' : 's'} over the next four weeks to reach ${targets.postsPerWeek}/week.`,
      because: `Currently ${round(cadence, 2)}/week (${posts.length} posts in ${days} days).`,
    });
  } else if (typeof benchmarks.cadence === 'number' && cadence < benchmarks.cadence) {
    actions.push({
      priority: 3,
      action: 'Lift publishing rhythm to the team median.',
      because: `${round(cadence, 2)} posts/week versus a team median of ${round(benchmarks.cadence, 2)}.`,
    });
  }

  if (rated.length >= 2) {
    const best = rated.slice().sort((a, b) => b.medianRate - a.medianRate)[0];
    const most = mix.slice().sort((a, b) => b.posts - a.posts)[0];
    if (best.type !== most.type && best.medianRate > 0 && most.medianRate) {
      const lift = round(best.medianRate / most.medianRate, 2);
      if (lift >= 1.25) {
        actions.push({
          priority: 2,
          action: `Shift more of the mix to ${best.type}s.`,
          because: `${best.type}s earn ${lift}× the typical rate of ${most.type}s here, but are ${Math.round((best.share || 0) * 100)}% of posts versus ${Math.round((most.share || 0) * 100)}%.`,
        });
      }
    }
  }

  if (typeof rate === 'number' && typeof benchmarks.engagement === 'number' && rate < benchmarks.engagement) {
    actions.push({
      priority: 3,
      action: 'Open with a sharper hook and ask one direct question.',
      because: `Typical engagement ${round(rate * 100, 2)}% against a team median of ${round(benchmarks.engagement * 100, 2)}%.`,
    });
  }

  /*
   * The two rules below are derived from team-wide patterns rather than from
   * this person's own behaviour, so they rank below everything above and carry
   * a stricter bar. Without it, the single best slot in the grid gets
   * recommended to almost the whole team at once — and advice that everybody
   * receives is not advice, it is a banner.
   */
  const timing = context.timing;
  const teamRate = context.teamMedianRate;
  if (timing?.best?.medianRate && typeof teamRate === 'number' && teamRate > 0) {
    const lift = timing.best.medianRate / teamRate;
    const posted = posts.filter(post => {
      const parts = localParts(post.postedAt);
      return parts && parts.day === timing.best.day && hourBlock(parts.hour)?.key === timing.best.block;
    }).length;
    if (lift >= MIN_TIMING_LIFT && posted === 0 && timing.best.posts >= MIN_POSTS_FOR_TEAM_ADVICE) {
      actions.push({
        priority: 5,
        action: `Try publishing ${timing.best.dayName} ${timing.best.blockLabel} ${TZ_LABEL}.`,
        because: `That slot earns ${round(lift, 2)}× the team's typical interaction rate across ${timing.best.posts} measured posts, and none of your ${posts.length} posts land there.`,
      });
    }
  }

  /*
   * There is deliberately no "use this hashtag" rule. The tags that clear a
   * sample bar on this volume of data are the generic ones everybody already
   * uses — the first honest run recommended "#insta" to 22 of 31 people, which
   * is a statistic pretending to be a suggestion. The hashtag panel still
   * publishes what the data says, labelled with its sample; turning that into
   * personal advice needs more history than one capture provides.
   */

  if (!actions.length) {
    const streak = weeks?.currentStreakWeeks || 0;
    actions.push({
      priority: 5,
      action: streak >= 2 ? `Protect the ${streak}-week posting streak.` : 'Hold the current rhythm and repeat the top format.',
      because: streak >= 2
        ? `${streak} consecutive weeks with at least one post, at ${round(cadence, 2)}/week.`
        : `${round(cadence, 2)} posts/week with engagement at or above the team median.`,
    });
  }

  return actions.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

function buildContentIntelligence(records, platform, opts = {}) {
  const days = opts.days || WINDOW_DAYS;
  const now = opts.now === undefined ? asOf(records) : opts.now;
  const rows = measurablePosts(records, platform, now, days);
  return {
    windowDays: days,
    timezone: TZ_LABEL,
    measuredPosts: rows.length,
    measuredProfiles: new Set(rows.map(row => row.handle)).size,
    thresholds: {
      minPostsPerHashtag: MIN_POSTS_PER_HASHTAG,
      minProfilesPerHashtag: MIN_PROFILES_PER_HASHTAG,
      minPostsPerBucket: MIN_POSTS_PER_BUCKET,
    },
    teamMedianRate: summarize(rows).medianRate,
    hashtags: hashtagPerformance(records, platform, now, days, opts),
    timing: timingPerformance(records, platform, now, days, opts),
    captions: captionPerformance(records, platform, now, days, opts),
  };
}

module.exports = {
  buildContentIntelligence, hashtagPerformance, timingPerformance, captionPerformance,
  postingWeeks, daysSinceLastPost, goalProgress, targetsFor, nextActions,
  personFormatMix, measurablePosts, hashtagsIn, localParts, hourBlock, captionBucket,
  interactionRate, summarize,
  TZ_LABEL, TZ_OFFSET_HOURS, DAY_NAMES, HOUR_BLOCKS, CAPTION_BUCKETS,
  MIN_POSTS_PER_HASHTAG, MIN_PROFILES_PER_HASHTAG, MIN_POSTS_PER_BUCKET,
  MIN_POSTS_FOR_TEAM_ADVICE, MIN_PROFILES_FOR_TEAM_ADVICE, MIN_TIMING_LIFT,
};
