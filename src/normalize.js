'use strict';

function n(x) {
  const value = typeof x === 'string' ? Number(x.replace(/[, ]/g, '')) : x;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function s(x) { return x === 0 || x ? String(x) : null; }
function canonicalHandle(value) {
  return value == null ? null : String(value).replace(/^@/, '').trim().toLowerCase();
}
function ownerHandle(raw) {
  if (!raw) return null;
  const author = raw.author;
  return canonicalHandle(
    raw.ownerUsername || raw.username || raw.authorMeta_name || raw.authorMeta?.name ||
    raw.owner?.username || raw.owner?.userName ||
    (typeof author === 'string' ? author : author?.username || author?.name)
  );
}
function toIso(raw) {
  const value = raw.postedAt ?? raw.timestamp ?? raw.takenAtIso ?? raw.takenAtISO ??
    raw.takenAtTimestamp ?? raw.takenAt ?? raw.createTimeISO ?? raw.createTime;
  if (value == null) return null;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function normalizePost(raw, platform) {
  const rawType = String(raw.type || raw.mediaType || raw.productType || '').toLowerCase();
  let type = 'image';
  if (/reel|clips/.test(rawType)) type = 'reel';
  else if (/video|feed_video/.test(rawType) || raw.isVideo === true) type = 'video';
  else if (/carousel|sidecar|album/.test(rawType)) type = 'carousel';
  else if (platform === 'tiktok') type = 'video';

  return {
    id: s(raw.id || raw.pk || raw.shortcode || raw.shortCode || raw.videoId),
    type,
    isPinned: raw.isPinned === true,
    url: s(raw.url || raw.postUrl || raw.webVideoUrl || raw.permalink || raw.link),
    thumb: s(raw.thumb || raw.thumbnailUrl || raw.thumbnailSrc || raw.displayUrl || raw.coverUrl),
    caption: s(raw.caption || raw.text || raw.title || ''),
    ownerUsername: ownerHandle(raw),
    likes: n(raw.likes ?? raw.likeCount ?? raw.likesCount ?? raw.diggCount),
    comments: n(raw.comments ?? raw.commentCount ?? raw.commentsCount),
    shares: n(raw.shares ?? raw.shareCount ?? raw.sharesCount),
    views: n(raw.views ?? raw.playCount ?? raw.videoViewCount ?? raw.viewCount),
    postedAt: toIso(raw),
  };
}
function postKey(post) {
  if (post.id) return `id:${post.id}`;
  if (post.url) return `url:${post.url}`;
  return `fallback:${post.postedAt || ''}|${post.caption || ''}|${post.type || ''}`;
}
function dedupePosts(posts) {
  const seen = new Set();
  const unique = [];
  for (const post of posts || []) {
    const key = postKey(post);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(post);
  }
  return unique;
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
      profileSource: null,
      postSource: null,
      postsQuerySucceeded: false,
      postsQueryError: null,
      postsLookbackDays: null,
      postsResultLimit: null,
      postsTruncated: null,
      rawPostCount: 0,
      authoredPostCount: 0,
      duplicatePostCount: 0,
    },
    warnings: [],
  };
  if (!raw || raw.notFound || raw.resolved === false) return base;

  base.resolved = true;
  base.isPrivate = raw.isPrivate === true || raw.private === true || raw.privateAccount === true;
  base.followers = n(raw.followers ?? raw.followersCount ?? raw.followerCount ?? raw.followers_count ?? raw.fansCount ?? raw.fans);
  base.following = n(raw.following ?? raw.followingCount ?? raw.followsCount);
  base.postCount = n(raw.postCount ?? raw.postsCount ?? raw.mediaCount ?? raw.videoCount ?? raw.videosCount ?? raw.video);
  Object.assign(base.fetchMeta, {
    profileSource: s(raw._profileSource),
    postSource: s(raw._postSource),
    postsQuerySucceeded: raw._postsQuerySucceeded === true,
    postsQueryError: s(raw._postsQueryError),
    postsLookbackDays: n(raw._postsLookbackDays),
    postsResultLimit: n(raw._postsResultLimit),
    postsTruncated: raw._postsTruncated === true,
  });
  if (base.isPrivate) return base;

  const rawPosts = Array.isArray(raw.recentPosts) ? raw.recentPosts
    : Array.isArray(raw.posts) ? raw.posts
      : Array.isArray(raw.items) ? raw.items
        : [];
  base.fetchMeta.rawPostCount = n(raw._rawPostCount) ?? rawPosts.length;

  const expected = canonicalHandle(entry.handle);
  const authored = rawPosts
    .map(post => normalizePost(post, entry.platform))
    .filter(post => !post.ownerUsername || !expected || post.ownerUsername === expected);
  const unique = dedupePosts(authored);
  base.recentPosts = unique;
  base.fetchMeta.authoredPostCount = unique.length;
  base.fetchMeta.duplicatePostCount = authored.length - unique.length;

  const foreign = rawPosts.length - authored.length;
  if (foreign > 0) base.warnings.push(`${foreign} post(s) excluded because another account authored them`);
  if (base.fetchMeta.duplicatePostCount > 0) base.warnings.push(`${base.fetchMeta.duplicatePostCount} duplicate post row(s) removed`);
  if (!base.fetchMeta.postsQuerySucceeded) base.warnings.push('date-bounded Instagram post query did not complete');

  const hasAudience = base.postCount > 0 || base.recentPosts.some(post => (post.likes || 0) > 0);
  if (base.followers === 0 && hasAudience) {
    base.followers = null;
    base.warnings.push('follower count unavailable from provider (returned 0 for an active account)');
  }
  return base;
}

module.exports = {
  normalizeRecord,
  normalizePost,
  dedupePosts,
  postKey,
  ownerHandle,
  canonicalHandle,
  toIso,
};
