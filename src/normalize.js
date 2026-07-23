'use strict';

function n(x) {
  const v = typeof x === 'string' ? Number(x.replace(/[, ]/g, '')) : x;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function s(x) { return (x === 0 || x) ? String(x) : null; }

function normalizePost(raw, platform) {
  const type = (() => {
    const t = String(raw.type || raw.mediaType || raw.productType || '').toLowerCase();
    if (/reel|clips/.test(t)) return 'reel';
    if (/video|feed_video/.test(t)) return 'video';
    if (/carousel|sidecar|album/.test(t)) return 'carousel';
    if (/image|photo|graph/.test(t)) return 'image';
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
      if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t).toISOString();
      const d = new Date(t);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    })(),
  };
}

function normalizeRecord(entry, raw, capturedAt) {
  const base = {
    name: entry.name,
    role: entry.role,
    platform: entry.platform,
    handle: entry.handle,
    capturedAt,
    resolved: false,
    isPrivate: false,
    followers: null,
    following: null,
    postCount: null,
    recentPosts: [],
    fetchMeta: {
      requestedLimit: null,
      rawPostCount: 0,
      authoredPostCount: 0,
    },
    warnings: [],
  };

  if (!raw || raw.notFound || raw.resolved === false) return base;

  base.resolved = true;
  base.isPrivate = raw.isPrivate === true || raw.private === true || raw.privateAccount === true;
  base.followers = n(raw.followers ?? raw.followersCount ?? raw.followerCount ?? raw.followers_count ?? raw.fansCount ?? raw.fans);
  base.following = n(raw.following ?? raw.followingCount ?? raw.followsCount);
  base.postCount = n(raw.postCount ?? raw.postsCount ?? raw.mediaCount ?? raw.videoCount ?? raw.videosCount ?? raw.video);
  base.fetchMeta.requestedLimit = n(raw._fetchLimit);

  if (base.isPrivate) return base;

  const posts = raw.recentPosts || raw.latestPosts || raw.posts || raw.items || raw.videos || [];
  const rawPosts = Array.isArray(posts) ? posts : [];
  base.fetchMeta.rawPostCount = n(raw._rawPostCount) ?? rawPosts.length;

  base.recentPosts = rawPosts
    .filter(p => {
      const owner = p.ownerUsername || p.author || p.authorMeta_name || p.authorMeta?.name || null;
      return !owner || !entry.handle || String(owner).replace(/^@/, '').toLowerCase() === String(entry.handle).toLowerCase();
    })
    .map(p => normalizePost(p, entry.platform));

  base.fetchMeta.authoredPostCount = base.recentPosts.length;
  const dropped = rawPosts.length - base.recentPosts.length;
  if (dropped > 0) base.warnings.push(`${dropped} post(s) excluded: authored by another account`);

  const hasAudience = base.postCount > 0 || base.recentPosts.some(p => (p.likes || 0) > 0);
  if (base.followers === 0 && hasAudience) {
    base.followers = null;
    base.warnings.push('follower count unavailable from provider (returned 0 for an active account)');
  }

  return base;
}

module.exports = { normalizeRecord, normalizePost };
