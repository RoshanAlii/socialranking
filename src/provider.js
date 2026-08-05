'use strict';

const https = require('https');

const PROFILE_ACTOR = process.env.APIFY_IG_PROFILE_ACTOR || 'apify~instagram-profile-scraper';
const POSTS_ACTOR = process.env.APIFY_IG_POSTS_ACTOR || 'apify~instagram-scraper';
const TIKTOK_ACTOR = process.env.APIFY_TIKTOK_ACTOR || 'clockworks~tiktok-scraper';
// A run-sync call that never returns holds the whole daily job hostage until the
// workflow's 45-minute ceiling kills it, which reads as "the board is broken"
// rather than "one actor stalled". Bound it, retry the failures worth retrying.
const RUN_TIMEOUT_MS = Number(process.env.APIFY_RUN_TIMEOUT_MS || 6 * 60 * 1000);
const RUN_RETRIES = Number(process.env.APIFY_RUN_RETRIES || 3);
const RUN_RETRY_BASE_MS = Number(process.env.APIFY_RUN_RETRY_BASE_MS || 2000);
const INSTAGRAM_POST_RESULTS_LIMIT = Number(process.env.APIFY_IG_POST_RESULTS_LIMIT || 200);
const INSTAGRAM_POST_LOOKBACK_DAYS = Number(process.env.APIFY_IG_POST_LOOKBACK_DAYS || 31);
// The default Apify account limit is 16 GB and this Actor requests 4 GB per
// run. Keep one slot of headroom so profile-run cleanup cannot starve a post
// pull with actor-memory-limit-exceeded errors.
const POST_FETCH_CONCURRENCY = Number(process.env.APIFY_IG_POST_CONCURRENCY || 3);

function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seedVal) {
  let x = seedVal || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}
function dayMs() { return 24 * 60 * 60 * 1000; }
function canonicalHandle(value) {
  return value == null ? null : String(value).replace(/^@/, '').trim().toLowerCase();
}
function profileUrl(handle) { return `https://www.instagram.com/${handle}/`; }

function instagramProfileInput(handles) {
  return { usernames: [...new Set((handles || []).filter(Boolean))] };
}
function instagramPostsInput(handle) {
  return {
    directUrls: [profileUrl(handle)],
    resultsType: 'posts',
    resultsLimit: INSTAGRAM_POST_RESULTS_LIMIT,
    onlyPostsNewerThan: `${INSTAGRAM_POST_LOOKBACK_DAYS} days`,
    addParentData: true,
  };
}

function groupProfileItems(handles, items) {
  const wanted = new Map((handles || []).filter(Boolean).map(h => [canonicalHandle(h), h]));
  const out = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = canonicalHandle(item.username || item.userName || item.handle);
    const handle = wanted.get(key);
    if (handle && !out.has(handle)) out.set(handle, item);
  }
  return out;
}

function postOwner(item) {
  return canonicalHandle(
    item && (item.ownerUsername || item.username || item.authorMeta_name ||
      item.authorMeta?.name || item.owner?.username || item.owner?.userName)
  );
}
function tiktokInput(handle) {
  const since = new Date(Date.now() - INSTAGRAM_POST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return {
    profiles: [canonicalHandle(handle)],
    resultsPerPage: INSTAGRAM_POST_RESULTS_LIMIT,
    profileScrapeSections: ['videos'],
    profileSorting: 'latest',
    oldestPostDateUnified: since.toISOString().slice(0, 10),
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
  };
}
function tiktokOwner(item) {
  return canonicalHandle(item && (item.authorMeta?.name || item.authorMeta_name || item.authorName));
}
function groupTikTokItems(handle, items) {
  const expected = canonicalHandle(handle);
  return (Array.isArray(items) ? items : []).filter(item => tiktokOwner(item) === expected);
}
function groupPostItems(handle, items) {
  const expected = canonicalHandle(handle);
  return (Array.isArray(items) ? items : []).filter(item => {
    const owner = postOwner(item);
    return owner === expected;
  });
}

function apifyRunOnce(actor, input, token, timeoutMs = RUN_TIMEOUT_MS) {
  const body = JSON.stringify(input);
  const requestPath = `/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const opts = {
    method: 'POST', hostname: 'api.apify.com', path: requestPath,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const error = new Error(`Apify ${res.statusCode}: ${data.slice(0, 500)}`);
          error.statusCode = res.statusCode;
          return reject(error);
        }
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error(`Apify run timed out after ${timeoutMs}ms`), { retryable: true }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function isRetryable(error) {
  if (error?.retryable === true) return true;
  const status = error?.statusCode;
  // 429 is rate limiting and 5xx is Apify's side; both usually clear on their
  // own. A 4xx that is not 429 means the request itself is wrong, and retrying
  // a wrong request just spends money three times.
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|timed out/i.test(String(error?.message || ''));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function apifyRunSync(actor, input, token, opts = {}) {
  const attempts = Math.max(1, opts.retries ?? RUN_RETRIES);
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;
  const onAttempt = typeof opts.onAttempt === 'function' ? opts.onAttempt : () => {};
  const runOnce = opts.runOnce || apifyRunOnce;
  const backoffBase = opts.backoffMs ?? RUN_RETRY_BASE_MS;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await runOnce(actor, input, token, timeoutMs);
      onAttempt({ actor, attempt, ok: true, ms: Date.now() - startedAt, items: Array.isArray(result) ? result.length : null });
      return result;
    } catch (error) {
      lastError = error;
      onAttempt({ actor, attempt, ok: false, ms: Date.now() - startedAt, error: String(error.message || error) });
      if (attempt >= attempts || !isRetryable(error)) break;
      const backoff = backoffBase * Math.pow(2, attempt - 1);
      await sleep(backoff + Math.floor(Math.random() * (backoffBase ? 500 : 0)));
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, worker) {
  const values = Array.from(items || []);
  const results = new Array(values.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, values.length || 1)) }, runner));
  return results;
}

class ApifyProvider {
  constructor(token = process.env.APIFY_TOKEN, opts = {}) {
    if (!token) throw new Error('ApifyProvider needs APIFY_TOKEN. Refusing to fabricate live data.');
    this.token = token;
    this.runSync = opts.runSync || apifyRunSync;
    this.postConcurrency = opts.postConcurrency || POST_FETCH_CONCURRENCY;
    /*
     * Actor runs are the unit Apify bills. Recording them means an unexplained
     * bill can be traced to a run count in the snapshot that produced it,
     * instead of being discovered on an invoice a month later.
     */
    this.telemetry = { runs: 0, failedRuns: 0, retries: 0, totalMs: 0, byActor: {} };
  }

  record(event) {
    const actor = this.telemetry.byActor[event.actor] || { runs: 0, failures: 0, ms: 0, items: 0 };
    actor.runs++;
    actor.ms += event.ms || 0;
    if (event.ok) actor.items += event.items || 0;
    else actor.failures++;
    this.telemetry.byActor[event.actor] = actor;
    this.telemetry.runs++;
    this.telemetry.totalMs += event.ms || 0;
    if (!event.ok) this.telemetry.failedRuns++;
    if (event.attempt > 1) this.telemetry.retries++;
  }

  call(actor, input) {
    return this.runSync(actor, input, this.token, { onAttempt: event => this.record(event) });
  }

  async fetchProfiles(platform, handles) {
    const wanted = [...new Set((handles || []).filter(Boolean))];
    if (platform === 'tiktok') return this.fetchTikTokProfiles(wanted);
    if (platform !== 'instagram' || !wanted.length) return new Map();

    const profileItems = await this.call(PROFILE_ACTOR, instagramProfileInput(wanted));
    const profiles = groupProfileItems(wanted, profileItems);
    const out = new Map();

    await mapLimit(wanted, this.postConcurrency, async handle => {
      const details = profiles.get(handle);
      if (!details) {
        out.set(handle, { notFound: true });
        return;
      }

      try {
        const rows = await this.call(POSTS_ACTOR, instagramPostsInput(handle));
        const posts = groupPostItems(handle, rows);
        const rawRows = Array.isArray(rows) ? rows : [];
        const missingOwnerCount = rawRows.filter(item => !postOwner(item)).length;
        const postsOwnershipComplete = missingOwnerCount === 0;
        out.set(handle, Object.assign({}, details, {
          recentPosts: posts,
          _profileSource: PROFILE_ACTOR,
          _postSource: POSTS_ACTOR,
          _postsQuerySucceeded: postsOwnershipComplete,
          _postsQueryError: postsOwnershipComplete
            ? null
            : `${missingOwnerCount} post row(s) had no verifiable owner`,
          _postsLookbackDays: INSTAGRAM_POST_LOOKBACK_DAYS,
          _postsResultLimit: INSTAGRAM_POST_RESULTS_LIMIT,
          _postsTruncated: rawRows.length >= INSTAGRAM_POST_RESULTS_LIMIT,
          _postsOwnershipComplete: postsOwnershipComplete,
          _missingOwnerCount: missingOwnerCount,
          _rawPostCount: rawRows.length,
        }));
      } catch (error) {
        out.set(handle, Object.assign({}, details, {
          recentPosts: [],
          _profileSource: PROFILE_ACTOR,
          _postSource: POSTS_ACTOR,
          _postsQuerySucceeded: false,
          _postsQueryError: String(error.message || error),
          _postsLookbackDays: INSTAGRAM_POST_LOOKBACK_DAYS,
          _postsResultLimit: INSTAGRAM_POST_RESULTS_LIMIT,
          _postsTruncated: false,
          _postsOwnershipComplete: false,
          _missingOwnerCount: 0,
          _rawPostCount: 0,
        }));
      }
    });

    return out;
  }

  /*
   * TikTok returns the profile inside every video row rather than as a separate
   * object, so one date-bounded query per handle yields both the audience
   * numbers and the window of posts. The shape handed back is deliberately the
   * same as Instagram's: normalize.js and rank.js stay platform-agnostic.
   */
  async fetchTikTokProfiles(handles) {
    const out = new Map();
    await mapLimit(handles, this.postConcurrency, async handle => {
      try {
        const rows = await this.call(TIKTOK_ACTOR, tiktokInput(handle));
        const posts = groupTikTokItems(handle, rows);
        const rawRows = Array.isArray(rows) ? rows : [];
        if (!posts.length && !rawRows.length) {
          out.set(handle, { notFound: true });
          return;
        }
        const author = posts.map(item => item.authorMeta).find(Boolean) || {};
        const missingOwnerCount = rawRows.filter(item => !tiktokOwner(item)).length;
        out.set(handle, {
          username: author.name || handle,
          followersCount: author.fans ?? null,
          followsCount: author.following ?? null,
          postsCount: author.video ?? null,
          isPrivate: author.privateAccount === true,
          recentPosts: posts,
          _profileSource: TIKTOK_ACTOR,
          _postSource: TIKTOK_ACTOR,
          _postsQuerySucceeded: missingOwnerCount === 0,
          _postsQueryError: missingOwnerCount === 0 ? null : `${missingOwnerCount} row(s) had no verifiable owner`,
          _postsLookbackDays: INSTAGRAM_POST_LOOKBACK_DAYS,
          _postsResultLimit: INSTAGRAM_POST_RESULTS_LIMIT,
          _postsTruncated: rawRows.length >= INSTAGRAM_POST_RESULTS_LIMIT,
          _postsOwnershipComplete: missingOwnerCount === 0,
          _missingOwnerCount: missingOwnerCount,
          _rawPostCount: rawRows.length,
        });
      } catch (error) {
        out.set(handle, {
          username: handle,
          recentPosts: [],
          _profileSource: TIKTOK_ACTOR,
          _postSource: TIKTOK_ACTOR,
          _postsQuerySucceeded: false,
          _postsQueryError: String(error.message || error),
          _postsLookbackDays: INSTAGRAM_POST_LOOKBACK_DAYS,
          _postsResultLimit: INSTAGRAM_POST_RESULTS_LIMIT,
          _postsTruncated: false,
          _postsOwnershipComplete: false,
          _missingOwnerCount: 0,
          _rawPostCount: 0,
        });
      }
    });
    return out;
  }

  async fetchProfile(platform, handle) {
    return (await this.fetchProfiles(platform, [handle])).get(handle) || { notFound: true };
  }
}

class MockProvider {
  constructor(opts = {}) {
    this.privateHandles = new Set(opts.privateHandles || []);
    this.missing = new Set(opts.missing || []);
  }
  async fetchProfile(platform, handle) {
    if (!handle || this.missing.has(handle)) return { notFound: true };
    if (platform !== 'instagram' && platform !== 'tiktok') return { notFound: true };
    const r = rng(seed(`${platform}:${handle}`));
    if (this.privateHandles.has(handle)) {
      return { private: true, followersCount: 1000, followsCount: 300, postsCount: 40 };
    }
    const followers = 1500 + Math.floor(r() * 90000);
    const now = Date.now();
    const recentPosts = Array.from({ length: 35 }, (_, i) => ({
      id: `${handle}_${i}`,
      type: r() > 0.35 ? 'Video' : 'Image',
      url: `https://instagram.com/p/${handle}_${i}/`,
      caption: 'Dubai property content #kirpaarmy',
      likesCount: Math.floor(followers * (0.02 + r() * 0.10)),
      commentsCount: Math.floor(followers * 0.002),
      timestamp: new Date(now - i * dayMs()).toISOString(),
      ownerUsername: handle,
    }));
    return {
      username: handle,
      followersCount: followers,
      followsCount: 400 + Math.floor(r() * 900),
      postsCount: 200,
      recentPosts,
      _profileSource: PROFILE_ACTOR,
      _postSource: POSTS_ACTOR,
      _postsQuerySucceeded: true,
      _postsLookbackDays: 31,
      _postsResultLimit: 200,
      _postsTruncated: false,
      _postsOwnershipComplete: true,
      _missingOwnerCount: 0,
      _rawPostCount: recentPosts.length,
    };
  }
  async fetchProfiles(platform, handles) {
    const out = new Map();
    for (const handle of handles || []) out.set(handle, await this.fetchProfile(platform, handle));
    return out;
  }
}

class CapturedProvider {
  constructor(dir) { this.dir = dir; }
  async fetchProfile(platform, handle) {
    const fs = require('fs');
    const path = require('path');
    const safe = `${platform}_${handle}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = path.join(this.dir, `${safe}.json`);
    if (!fs.existsSync(file)) return { notFound: true };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

module.exports = {
  ApifyProvider,
  MockProvider,
  CapturedProvider,
  PROFILE_ACTOR,
  POSTS_ACTOR,
  TIKTOK_ACTOR,
  RUN_TIMEOUT_MS,
  RUN_RETRIES,
  isRetryable,
  tiktokInput,
  groupTikTokItems,
  tiktokOwner,
  INSTAGRAM_POST_RESULTS_LIMIT,
  INSTAGRAM_POST_LOOKBACK_DAYS,
  POST_FETCH_CONCURRENCY,
  instagramProfileInput,
  instagramPostsInput,
  groupProfileItems,
  groupPostItems,
  canonicalHandle,
  apifyRunSync,
  mapLimit,
};
