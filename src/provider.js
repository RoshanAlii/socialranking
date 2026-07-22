'use strict';

/*
 * provider.js — the ingestion adapter (LeadRat-style swap point).
 *
 * A provider exposes ONE method:
 *    async fetchProfile(platform, handle) -> raw payload | { notFound: true }
 *
 * Two implementations ship:
 *   MockProvider  — deterministic, offline. Drives the test suite and the
 *                   labelled SAMPLE dataset. Real code, real shapes, fake
 *                   numbers — the output is always badged source:"sample".
 *   ApifyProvider — live public-surface data via Apify actors. No login,
 *                   no OAuth: it reads the same public pages a logged-out
 *                   visitor sees. Requires APIFY_TOKEN. Never faked: if the
 *                   token is absent it throws rather than pretend.
 *
 * Swap providers in ingest.js by changing one line. To move to EnsembleData
 * or HikerAPI later, implement the same fetchProfile contract.
 */

const https = require('https');

/* ---------------- Mock (offline / tests / sample) ---------------- */

// tiny deterministic hash so the same handle always yields the same numbers
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
function rng(seedVal) {
  let x = seedVal || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

class MockProvider {
  constructor(opts = {}) { this.privateHandles = new Set(opts.privateHandles || []); this.missing = new Set(opts.missing || []); }
  async fetchProfile(platform, handle) {
    if (!handle || this.missing.has(handle)) return { notFound: true };
    const r = rng(seed(platform + ':' + handle));
    if (this.privateHandles.has(handle)) {
      return { isPrivate: true, followers: 800 + Math.floor(r() * 4000), following: 300, postCount: 40 };
    }
    const followers = 1500 + Math.floor(r() * 90000);
    const postCount = 60 + Math.floor(r() * 400);
    const nPosts = 8 + Math.floor(r() * 4);
    const now = Date.now();
    const recentPosts = Array.from({ length: nPosts }, (_, i) => {
      const isVideo = platform === 'tiktok' ? true : r() > 0.35;
      const base = Math.floor(followers * (0.04 + r() * 0.25));
      return {
        id: `${handle}_${i}`,
        type: platform === 'tiktok' ? 'video' : (isVideo ? 'reel' : 'image'),
        url: `https://example/${platform}/${handle}/${i}`,
        thumbnailUrl: `https://picsum.photos/seed/${handle}${i}/400/500`,
        caption: `Dubai property tour \u2014 ${['JVC','Dubai Hills','Marina','Business Bay','Palm'][i % 5]} #kirpaarmy`,
        likeCount: base,
        commentCount: Math.floor(base * (0.02 + r() * 0.08)),
        shareCount: isVideo ? Math.floor(base * (0.01 + r() * 0.05)) : 0,
        playCount: isVideo ? Math.floor(followers * (0.5 + r() * 6)) : undefined,
        timestamp: now - i * (2 + Math.floor(r() * 4)) * 24 * 3600 * 1000,
      };
    });
    return { isPrivate: false, followers, following: 400 + Math.floor(r() * 900), postCount, recentPosts };
  }
}

/* ---------------- Apify (live public-surface data) ---------------- */

// Default public actors. Override via env if you prefer different ones.
const APIFY_ACTORS = {
  instagram: process.env.APIFY_IG_ACTOR || 'apify~instagram-profile-scraper',
  tiktok: process.env.APIFY_TT_ACTOR || 'clockworks~tiktok-profile-scraper',
  // Facebook is PAGES ONLY. Personal profiles expose no usable public data.
  // A facebook handle in the registry must be a Page id/slug, never a person.
  facebook: process.env.APIFY_FB_ACTOR || 'apify~facebook-pages-scraper',
};

function apifyRunSync(actor, input, token) {
  const body = JSON.stringify(input);
  const path = `/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const opts = { method: 'POST', hostname: 'api.apify.com', path,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Apify ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

class ApifyProvider {
  constructor(token = process.env.APIFY_TOKEN) {
    if (!token) throw new Error('ApifyProvider needs APIFY_TOKEN. Set it in the environment / GitHub secret. Refusing to fabricate live data.');
    this.token = token;
  }
  async fetchProfile(platform, handle) {
    const actor = APIFY_ACTORS[platform];
    if (!actor) return { notFound: true };
    const input = platform === 'instagram'
      ? { usernames: [handle], resultsLimit: 12 }
      : platform === 'facebook'
        ? { startUrls: [{ url: `https://www.facebook.com/${handle}` }], resultsLimit: 12 }
        : { profiles: [handle], resultsPerPage: 12, shouldDownloadVideos: false };
    const items = await apifyRunSync(actor, input, this.token);
    if (!Array.isArray(items) || items.length === 0) return { notFound: true };
    // Actors return either a profile object with nested posts, or a flat list of
    // posts plus profile fields on each. normalize.js is tolerant of both.
    const first = items[0];
    if (first && (first.followersCount != null || first.followers != null || first.fansCount != null)) {
      return Object.assign({}, first, { recentPosts: first.latestPosts || first.posts || items.slice(1) || [] });
    }
    // flat list: infer profile fields from the first item, posts = the list
    return {
      followers: first.followersCount ?? first.authorMeta?.fans ?? null,
      isPrivate: first.private === true,
      recentPosts: items,
    };
  }
}

/* ---------------- Captured (real data, replayed) ---------------- */

// Reads REAL provider payloads previously captured from Apify and stored in
// data/raw/<platform>_<handle>.json. This is not mock data: the numbers are
// verbatim from a live run. It exists so the pipeline can be re-run, tested,
// and audited without re-billing an API call, and so a snapshot is reproducible.
class CapturedProvider {
  constructor(dir) { this.dir = dir; }
  async fetchProfile(platform, handle) {
    const fs = require('fs'), path = require('path');
    const file = path.join(this.dir, `${platform}_${handle}.json`);
    if (!fs.existsSync(file)) return { notFound: true };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

module.exports = { MockProvider, ApifyProvider, CapturedProvider, APIFY_ACTORS };
