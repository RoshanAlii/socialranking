'use strict';

const https = require('https');

const INSTAGRAM_RESULTS_LIMIT = Number(process.env.APIFY_IG_RESULTS_LIMIT || 100);
const APIFY_ACTORS = {
  instagram: process.env.APIFY_IG_ACTOR || 'apify~instagram-profile-scraper',
  tiktok: process.env.APIFY_TT_ACTOR || 'clockworks~tiktok-profile-scraper',
  facebook: process.env.APIFY_FB_ACTOR || 'apify~facebook-pages-scraper',
};

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
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

class MockProvider {
  constructor(opts = {}) {
    this.privateHandles = new Set(opts.privateHandles || []);
    this.missing = new Set(opts.missing || []);
  }
  async fetchProfile(platform, handle) {
    if (!handle || this.missing.has(handle)) return { notFound: true };
    const r = rng(seed(`${platform}:${handle}`));
    if (this.privateHandles.has(handle)) {
      return { isPrivate: true, followers: 800 + Math.floor(r() * 4000), following: 300, postCount: 40 };
    }
    const followers = 1500 + Math.floor(r() * 90000);
    const now = Date.now();
    const recentPosts = Array.from({ length: 35 }, (_, i) => {
      const base = Math.floor(followers * (0.02 + r() * 0.10));
      return {
        id: `${handle}_${i}`,
        type: r() > 0.35 ? 'reel' : 'image',
        url: `https://example/${platform}/${handle}/${i}`,
        caption: 'Dubai property content #kirpaarmy',
        likeCount: base,
        commentCount: Math.floor(base * 0.04),
        shareCount: Math.floor(base * 0.02),
        playCount: Math.floor(followers * (0.5 + r() * 3)),
        timestamp: now - i * DAY(),
        ownerUsername: handle,
      };
    });
    return {
      isPrivate: false,
      followers,
      following: 400 + Math.floor(r() * 900),
      postCount: recentPosts.length,
      recentPosts,
      _fetchLimit: INSTAGRAM_RESULTS_LIMIT,
      _rawPostCount: recentPosts.length,
    };
  }
}
function DAY() { return 24 * 60 * 60 * 1000; }

function apifyInput(platform, handles) {
  if (platform === 'instagram') {
    return { usernames: handles, resultsLimit: INSTAGRAM_RESULTS_LIMIT };
  }
  if (platform === 'facebook') {
    return {
      startUrls: handles.map(handle => ({ url: `https://www.facebook.com/${handle}` })),
      resultsLimit: 30,
    };
  }
  return {
    profiles: handles,
    profileScrapeSections: ['videos'],
    profileSorting: 'latest',
    resultsPerPage: 30,
    excludePinnedPosts: false,
    shouldDownloadCovers: false,
    shouldDownloadSlideshowImages: false,
    shouldDownloadSubtitles: false,
    shouldDownloadVideos: false,
  };
}

function requestedLimit(platform) {
  if (platform === 'instagram') return INSTAGRAM_RESULTS_LIMIT;
  return 30;
}

function groupApifyItems(platform, handles, items) {
  const wanted = [...new Set((handles || []).filter(Boolean))];
  const found = new Map();
  if (!Array.isArray(items) || !items.length || !wanted.length) return found;

  const canonical = new Map(wanted.map(handle => [String(handle).toLowerCase(), handle]));
  const groups = new Map();
  for (const item of items) {
    const rawHandle = item.username || item.userName || item.handle || item.ownerUsername
      || item.authorMeta?.name || item.authorMeta?.uniqueId;
    const handle = rawHandle && canonical.get(String(rawHandle).replace(/^@/, '').toLowerCase());
    if (!handle) continue;
    if (!groups.has(handle)) groups.set(handle, []);
    groups.get(handle).push(item);
  }

  if (platform === 'facebook' && wanted.length === 1 && groups.size === 0) groups.set(wanted[0], items);

  for (const [handle, rows] of groups) {
    const first = rows[0];
    const author = first.authorMeta || {};
    const nested = first.followersCount != null || first.followers != null
      || first.fansCount != null || first.followers_count != null;

    if (nested) {
      const posts = first.latestPosts || first.posts || (rows.length > 1 ? rows.slice(1) : []);
      found.set(handle, Object.assign({}, first, {
        recentPosts: posts,
        _fetchLimit: requestedLimit(platform),
        _rawPostCount: Array.isArray(posts) ? posts.length : 0,
      }));
      continue;
    }

    found.set(handle, {
      username: handle,
      signature: first.signature ?? author.signature ?? null,
      followers: first.followerCount ?? first.fans ?? author.fans ?? null,
      following: first.followingCount ?? first.following ?? author.following ?? null,
      postCount: first.postCount ?? first.videoCount ?? first.video ?? author.video ?? null,
      isPrivate: first.isPrivate === true || first.private === true
        || first.privateAccount === true || author.privateAccount === true,
      recentPosts: rows,
      _fetchLimit: requestedLimit(platform),
      _rawPostCount: rows.length,
    });
  }
  return found;
}

function apifyRunSync(actor, input, token) {
  const body = JSON.stringify(input);
  const path = `/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const opts = {
    method: 'POST',
    hostname: 'api.apify.com',
    path,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Apify ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

class ApifyProvider {
  constructor(token = process.env.APIFY_TOKEN) {
    if (!token) throw new Error('ApifyProvider needs APIFY_TOKEN. Refusing to fabricate live data.');
    this.token = token;
  }
  async fetchProfile(platform, handle) {
    const actor = APIFY_ACTORS[platform];
    if (!actor) return { notFound: true };
    const items = await apifyRunSync(actor, apifyInput(platform, [handle]), this.token);
    return groupApifyItems(platform, [handle], items).get(handle) || { notFound: true };
  }
  async fetchProfiles(platform, handles) {
    const actor = APIFY_ACTORS[platform];
    const wanted = [...new Set((handles || []).filter(Boolean))];
    if (!actor || !wanted.length) return new Map();
    const items = await apifyRunSync(actor, apifyInput(platform, wanted), this.token);
    return groupApifyItems(platform, wanted, items);
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
  MockProvider,
  ApifyProvider,
  CapturedProvider,
  APIFY_ACTORS,
  INSTAGRAM_RESULTS_LIMIT,
  apifyInput,
  groupApifyItems,
};
