(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KirpaCompanyPage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function errors(record) {
    const page = record?.companyPage;
    if (!page || page.version !== 1) return ['Full company feed has not been collected'];
    const issues = [], ids = new Set();
    if (page.source !== 'apify~instagram-post-scraper') issues.push('Unexpected feed source');
    if (!Number.isFinite(Date.parse(page.from)) || !Number.isFinite(Date.parse(page.to))) issues.push('Invalid coverage dates');
    for (const post of page.posts || []) {
      if (!post.id || ids.has(post.id)) issues.push('Missing or duplicate post ID');
      ids.add(post.id);
      const time = Date.parse(post.postedAt);
      if (!Number.isFinite(time) || time > Date.parse(page.to) || time < Date.parse(page.from)) issues.push('Post outside reported coverage');
      if (!post.ownerUsername || !['owned', 'collaboration', 'shared'].includes(post.pageRelation)) issues.push('Missing authorship evidence');
      if ((post.pageRelation === 'owned') !== (post.ownerUsername === record.handle)) issues.push('Incorrect owner classification');
      if (!['owner', 'coauthor', 'profile-feed'].includes(post.pageEvidence)) issues.push('Missing page evidence');
    }
    if (page.complete && (page.truncated || page.rejectedRows || page.omittedPreviewPosts || page.reason || !page.posts?.length || page.returnedRows >= page.resultLimit)) issues.push('Partial feed labelled complete');
    return issues;
  }
  function complete(record, from, to) {
    const page = record?.companyPage;
    return Boolean(page?.complete && errors(record).length === 0 && Date.parse(page.from) <= from && Date.parse(page.to) >= to && page.observedAt === page.requestedAt);
  }
  function posts(record) {
    return record?.companyPage?.posts || (record?.recentPosts || []).map(p => Object.assign({}, p, {pageRelation:'owned'}));
  }
  return {errors, complete, posts};
});
