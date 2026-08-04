'use strict';

/*
 * normalize.js — turn a raw provider payload into ONE canonical record shape.
 *
 * Different providers (Apify actors, EnsembleData, HikerAPI, the Mock) return
 * different JSON. Everything downstream (rank.js, the dashboard) speaks only
 * the normalized shape below. Missing fields become null — we never fabricate
 * a number to fill a gap.
 *
 * Normalized record:
 * {
 *   name, role, platform, handle, capturedAt,
 *   resolved: bool,      // did the handle resolve to a real public profile?
 *   isPrivate: bool,     // public profile but private account?
 *   followers|following|postCount: number|null,
 *   recentPosts: [{ id, type, url, thumb, caption, likes, comments, shares, views, postedAt }]
 * }
 */

function n(x) {
  const v = typeof x === 'string' ? Number(x.replace(/[, ]/g, '')) : x;
  return typeof v === 'number' && isFinite(v) ? v : null;
}
function s(x) { return (x === 0 || x) ? String(x) : null; }

function normalizePost(raw, platform) {
  const type = (() => {
    const t = (raw.type || raw.mediaType || raw.productType || '').toString().toLowerCase();
    if (/reel|clips/.test(t)) return 'reel';
    if (/video|feed_video/.test(t)) return 'video';
    if (/carousel|sidecar|album/.test(t)) return 'carousel';
    if (/image|photo|graph/.test(t)) return 'image';
    // TikTok items are always video
    return platform === 'tiktok' ? 'video' : (raw.videoUrl || raw.playCount != null ? 'video' : 'image');
  })();
  return {
    id: s(raw.id || raw.shortcode || raw.shortCode || raw.videoId || raw.pk),
    type,
    isPinned: raw.isPinned === true,
    url: s(raw.url || raw.webVideoUrl || raw.permalink || raw.link),
    thumb: s(raw.thumb || raw.thumbnailUrl || raw.displayUrl || raw.coverUrl),
    caption: s(raw.caption || raw.text || raw.title || ''),
    likes: n(raw.likes ?? raw.likeCount ?? raw.likesCount ?? raw.diggCount),
    comments: n(raw.comments ?? raw.commentCount ?? raw.commentsCount),
    shares: n(raw.shares ?? raw.shareCount ?? raw.sharesCount),
    views: n(raw.views ?? raw.playCount ?? raw.videoViewCount ?? raw.viewCount),
    postedAt: (() => {
      const t = raw.postedAt ?? raw.timestamp ?? raw.createTimeISO ?? raw.createTime ?? raw.takenAt;
      if (t == null) return null;
      // epoch seconds (TikTok) vs ms vs ISO string
      if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t).toISOString();
      const d = new Date(t); return isFinite(d.getTime()) ? d.toISOString() : null;
    })(),
  };
}

/*
 * entry:   registry employee { name, role, platform, handle }
 * raw:     provider payload, or null (handle didn't resolve)
 * capturedAt: ISO timestamp of the snapshot
 */
function normalizeRecord(entry, raw, capturedAt) {
  const base = {
    name: entry.name, role: entry.role, platform: entry.platform, handle: entry.handle,
    capturedAt,
    resolved: false, isPrivate: false,
    followers: null, following: null, postCount: null, recentPosts: [],
    warnings: [],
  };
  if (!raw || raw.notFound || raw.resolved === false) return base;

  base.resolved = true;
  base.isPrivate = raw.isPrivate === true || raw.private === true || raw.privateAccount === true;
  base.followers = n(raw.followers ?? raw.followersCount ?? raw.followerCount ?? raw.followers_count ?? raw.fansCount ?? raw.fans);
  base.following = n(raw.following ?? raw.followingCount ?? raw.followsCount);
  base.postCount = n(raw.postCount ?? raw.postsCount ?? raw.mediaCount ?? raw.videoCount ?? raw.videosCount ?? raw.video);

  if (base.isPrivate) return base; // private: shell only, no media

  const posts = raw.recentPosts || raw.latestPosts || raw.posts || raw.items || raw.videos || [];
  base.recentPosts = (Array.isArray(posts) ? posts : [])
    // Provider feeds sometimes include posts the person was TAGGED in but did
    // not author. Crediting those to them would inflate their numbers.
    .filter(p => {
      const owner = p.ownerUsername || p.author || p.authorMeta_name || null;
      return !owner || !entry.handle || owner.toLowerCase() === String(entry.handle).toLowerCase();
    })
    .map(p => normalizePost(p, entry.platform));

  const dropped = (Array.isArray(posts) ? posts.length : 0) - base.recentPosts.length;
  if (dropped > 0) base.warnings.push(`${dropped} post(s) excluded: authored by another account`);

  // A follower count of 0 on an account that clearly has an audience is a
  // provider glitch, not a fact. Treat it as MISSING so it can never be
  // ranked as "last place" or used as an engagement denominator.
  const hasAudience = base.postCount > 0 || base.recentPosts.some(p => (p.likes || 0) > 0);
  if (base.followers === 0 && hasAudience) {
    base.followers = null;
    base.warnings.push('follower count unavailable from provider (returned 0 for an active account)');
  }
  return base;
}

module.exports = { normalizeRecord, normalizePost };
