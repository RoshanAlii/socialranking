/* Public counters only. Shared by collection, the browser and regression tests. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KirpaPublicMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const DAY = 86400000;
  const number = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const date = s => new Date(Date.parse(s) + 4 * 3600000).toISOString().slice(0, 10);
  const key = p => {
    const match = String(p.url || '').match(/instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/);
    return match ? `code:${match[1]}` : typeof p.id === 'string' && p.id ? `id:${p.id}` : null;
  };
  const safeUrl = s => /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?(?:\?.*)?$/.test(s || '') ? s.split('?')[0] : null;
  function unique(posts) {
    const seen = new Set();
    return posts.filter(p => { const k = key(p); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  }
  function fromSnapshot(snapshot) {
    return [...(snapshot.records || []), ...(snapshot.brand || [])]
      .filter(r => r.platform === 'instagram' && r.resolved === true && r.isPrivate === false)
      .map(r => ({handle:r.handle, name:r.name, company:(snapshot.brand || []).includes(r), followers:r.followers,
        capturedAt:r.capturedAt || snapshot.meta.capturedAt,
        coverage:r.companyPage ? {...r.companyPage, posts:undefined} : r.fetchMeta?.pageCapture || {
          complete:false, from:null, to:r.capturedAt, reason:'No feed coverage evidence'},
        posts:unique(((snapshot.brand || []).includes(r) ? r.companyPage?.posts || r.recentPosts || [] : r.recentPosts || []).map(p => ({
          id:p.id, url:safeUrl(p.url), type:p.type, postedAt:p.postedAt, ownerUsername:p.ownerUsername,
          pageRelation:p.pageRelation || 'owned', likes:p.likes, comments:p.comments,
          shares:p.shares, videoPlayCount:p.viewMetricVersion === 2 ? p.videoPlayCount : null,
          metricsObservedAt:p.metricsObservedAt || r.capturedAt || snapshot.meta.capturedAt,
          source:r.fetchMeta?.postSource || 'apify~instagram-post-scraper'
        }))).filter(p => Number.isFinite(Date.parse(p.postedAt)) && Date.parse(p.postedAt) <= Date.parse(snapshot.meta.capturedAt))
      }));
  }
  function mergeAccount(old, fresh) {
    const prior = new Map((old?.posts || []).map(p => [key(p), p]));
    const current = fresh.posts.map(p => {
      const prev = prior.get(key(p));
      return {...p, shares:p.shares ?? prev?.shares ?? null,
        ...(number(p.shares) ? {sharesObservedAt:p.sharesObservedAt || p.metricsObservedAt, sharesSource:p.sharesSource || p.source} :
          prev?.sharesObservedAt ? {sharesObservedAt:prev.sharesObservedAt, sharesSource:prev.sharesSource} : {})};
    });
    const cutoff = Date.parse(fresh.capturedAt) - 90 * DAY;
    return {...fresh, historyCoverage:old?.historyCoverage || null,
      posts:unique([...current, ...(old?.posts || [])]).filter(p => Date.parse(p.postedAt) >= cutoff),
      previous:old && old.capturedAt !== fresh.capturedAt ? {capturedAt:old.capturedAt, followers:old.followers,
        posts:old.posts.filter(p => p.metricsObservedAt === old.capturedAt)} : old?.previous || null};
  }
  function mergeSnapshot(archive, snapshot) {
    const old = new Map((archive?.accounts || []).map(a => [a.handle, a]));
    return {...archive, version:1, generatedAt:snapshot.meta.capturedAt,
      accounts:fromSnapshot(snapshot).map(a => mergeAccount(old.get(a.handle), a))};
  }
  function bounds(at, period) {
    const today = date(at), end = Date.parse(today+'T00:00:00+04:00');
    let start = end;
    if (period === 'month') start = Date.parse(today.slice(0,7)+'-01T00:00:00+04:00');
    else if (period === 'week') start -= ((new Date(end + 4*3600000).getUTCDay()+6)%7)*DAY;
    else start -= 89*DAY;
    return {from:date(new Date(start).toISOString()), to:today};
  }
  function total(posts, field) {
    const reporting = posts.filter(p => number(p[field]));
    return {value:reporting.length ? reporting.reduce((n,p) => n+p[field],0) : posts.length ? null : 0,
      reporting:reporting.length, expected:posts.length};
  }
  function summarize(data, handle, from, to) {
    const accounts = data.accounts.filter(a => handle === 'team' ? !a.company : a.handle === handle);
    let posts = accounts.flatMap(a => a.posts.map(p => ({...p, handle:a.handle, name:a.name})));
    if (handle === 'team') posts = posts.filter(p => p.ownerUsername === p.handle);
    posts = unique(posts).filter(p => date(p.postedAt) >= from && date(p.postedAt) <= to)
      .sort((a,b) => Date.parse(b.postedAt)-Date.parse(a.postedAt));
    const videos = posts.filter(p => ['reel','video'].includes(p.type));
    const attention = posts.map(p => ({attention:number(p.likes) && number(p.comments) ? p.likes+p.comments : null}));
    return {accounts, posts, reels:posts.filter(p => p.type === 'reel').length,
      images:posts.filter(p => p.type === 'image').length, carousels:posts.filter(p => p.type === 'carousel').length,
      videos:posts.filter(p => p.type === 'video').length, likes:total(posts,'likes'), comments:total(posts,'comments'),
      shares:total(posts.filter(p=>p.type==='reel'),'shares'), plays:total(videos,'videoPlayCount'), attention:total(attention,'attention'),
      stalePosts:posts.filter(p => Date.parse(p.metricsObservedAt) < Date.parse(data.generatedAt)-108*3600000).length};
  }
  function compare(account) {
    const prev = account.previous;
    if (!prev || Date.parse(prev.capturedAt) >= Date.parse(account.capturedAt)) return null;
    const prior = new Map(prev.posts.map(p => [key(p),p]));
    const matched = account.posts.filter(p => p.metricsObservedAt === account.capturedAt && prior.has(key(p)));
    const fields = {};
    for (const field of ['likes','comments','videoPlayCount']) {
      const pairs = matched.filter(p => number(p[field]) && number(prior.get(key(p))[field]));
      fields[field] = {value:pairs.length ? pairs.reduce((n,p) => n+p[field]-prior.get(key(p))[field],0) : null,
        reporting:pairs.length, decreases:pairs.filter(p => p[field] < prior.get(key(p))[field]).length};
    }
    return {from:prev.capturedAt, to:account.capturedAt, matched:matched.length, fields,
      followerChange:number(account.followers) && number(prev.followers) ? account.followers-prev.followers : null};
  }
  return {key, safeUrl, unique, date, fromSnapshot, mergeAccount, mergeSnapshot, bounds, total, summarize, compare};
});
