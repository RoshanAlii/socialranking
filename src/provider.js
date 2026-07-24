'use strict';

const https = require('https');

const PROFILE_ACTOR = process.env.APIFY_IG_PROFILE_ACTOR || 'apify~instagram-profile-scraper';
const POSTS_ACTOR = process.env.APIFY_IG_POSTS_ACTOR || 'apify~instagram-scraper';
const INSTAGRAM_POST_RESULTS_LIMIT = Number(process.env.APIFY_IG_POST_RESULTS_LIMIT || 200);
const INSTAGRAM_POST_LOOKBACK_DAYS = Number(process.env.APIFY_IG_POST_LOOKBACK_DAYS || 31);
const POST_FETCH_CONCURRENCY = Number(process.env.APIFY_IG_POST_CONCURRENCY || 5);

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
function groupPostItems(handle, items) {
  const expected = canonicalHandle(handle);
  return (Array.isArray(items) ? items : []).filter(item => {
    const owner = postOwner(item);
    return !owner || owner === expected;
  });
}

function apifyRunSync(actor, input, token) {
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
        if (res.statusCode >= 400) return reject(new Error(`Apify ${res.statusCode}: ${data.slice(0, 500)}`));
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
  }

  async fetchProfiles(platform, handles) {
    const wanted = [...new Set((handles || []).filter(Boolean))];
    if (platform !== 'instagram' || !wanted.length) return new Map();

    const profileItems = await this.runSync(PROFILE_ACTOR, instagramProfileInput(wanted), this.token);
    const profiles = groupProfileItems(wanted, profileItems);
    const out = new Map();

    await mapLimit(wanted, this.postConcurrency, async handle => {
      const details = profiles.get(handle);
      if (!details) {
        out.set(handle, { notFound: true });
        return;
      }

      try {
        const rows = await this.runSync(POSTS_ACTOR, instagramPostsInput(handle), this.token);
        const posts = groupPostItems(handle, rows);
        out.set(handle, Object.assign({}, details, {
          recentPosts: posts,
          _profileSource: PROFILE_ACTOR,
          _postSource: POSTS_ACTOR,
          _postsQuerySucceeded: true,
          _postsLookbackDays: INSTAGRAM_POST_LOOKBACK_DAYS,
          _postsResultLimit: INSTAGRAM_POST_RESULTS_LIMIT,
          _postsTruncated: posts.length >= INSTAGRAM_POST_RESULTS_LIMIT,
          _rawPostCount: posts.length,
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
          _rawPostCount: 0,
        }));
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
    if (platform !== 'instagram') return { notFound: true };
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
    const file = path.join(this.dir, `${platform}_${handle}.json`);
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
