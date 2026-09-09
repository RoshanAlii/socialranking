'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {ApifyProvider, PROFILE_ACTOR} = require('../src/provider');
const {normalizeRecord} = require('../src/normalize');
const C = require('../company-page'), R = require('../src/rank');
const at = '2026-09-09T07:00:00.000Z', from = Date.parse('2026-08-31T20:00:00.000Z');
const post = (id, extra={}) => Object.assign({id,ownerUsername:'kirpa.properties',timestamp:'2026-09-03T04:00:00.000Z',type:'Video',productType:'clips',url:`https://www.instagram.com/p/${id}/`},extra);
async function capture(rows, preview=[], previous=null) {
  const provider = new ApifyProvider('test-only', {capturedAt:at,previousSnapshot:previous,runSync:async actor => {
    if (actor===PROFILE_ACTOR) return [{username:'kirpa.properties',followersCount:500,postsCount:1000,latestPosts:preview}];
    if (rows instanceof Error) throw rows;
    return rows;
  }});
  const raw = await provider.fetchBrandProfile('instagram','kirpa.properties');
  return Object.assign(normalizeRecord({name:'Kirpa',handle:'kirpa.properties',platform:'instagram'},raw,at),{isBrand:true});
}
test('full feed recovers posts missing from preview; IDs count once', async()=>{
  const r=await capture([post('a'),post('b'),post('b')],[post('a')]);
  assert.equal(r.companyPage.posts.length,2);assert.ok(C.complete(r,from,Date.parse(at)));
});
test('old pinned posts neither count now nor prove window completeness', async()=>{
  const old=post('pinned',{timestamp:'2026-01-01T00:00:00Z',isPinned:true});
  const r=await capture([old,post('new')],[old,post('new')]);
  assert.equal(r.companyPage.posts.length,1);assert.ok(C.complete(r,from,Date.parse(at)));
});
test('preview omissions prevent a false complete status',async()=>{
  const r=await capture([post('a')],[post('a'),post('missing')]);
  assert.equal(r.companyPage.complete,false);assert.equal(r.fetchMeta.postsQuerySucceeded,false);
});
test('shared posts retain real owner and page evidence without entering owned metrics',async()=>{
  const r=await capture([post('own'),post('shared',{ownerUsername:'jai.kirpa',inputUrl:'https://www.instagram.com/kirpa.properties/'}),post('collab',{ownerUsername:'manpreet.kirpa',coauthorProducers:[{username:'kirpa.properties'}]})]);
  assert.deepEqual(r.recentPosts.map(p=>p.id),['own']);assert.equal(r.companyPage.posts.length,3);
  assert.deepEqual(r.companyPage.posts.map(p=>p.pageRelation),['owned','shared','collaboration']);assert.deepEqual(C.errors(r),[]);
});
test('mentions and tags alone never prove page membership',async()=>{
  const r=await capture([post('own'),post('tagged',{ownerUsername:'other',caption:'@kirpa.properties',taggedUsers:[{username:'kirpa.properties'}]})]);
  assert.equal(r.companyPage.complete,false);assert.equal(r.companyPage.posts.length,1);
});
test('result cap includes every returned row, not only owned posts',async()=>{
  const r=await capture(Array.from({length:200},(_,i)=>post(String(i))));assert.equal(r.companyPage.complete,false);assert.equal(r.companyPage.truncated,true);
});
test('empty result is not an exact zero for an active company',async()=>{
  const r=await capture([]);assert.equal(r.companyPage.complete,false);
});
test('failed pull preserves previous evidence and its observation time',async()=>{
  const previous=await capture([post('a')]);previous.companyPage.observedAt='2026-09-08T07:00:00.000Z';
  const r=await capture(new Error('test failure'),[],{brand:[previous]});
  assert.equal(r.companyPage.posts.length,1);assert.equal(r.companyPage.observedAt,previous.companyPage.observedAt);assert.equal(r.companyPage.complete,false);
});
test('legacy profile-only company claims are not accepted',()=>{
  const r={isBrand:true,handle:'kirpa.properties',resolved:true,isPrivate:false,fetchMeta:{postsQuerySucceeded:true,postsLookbackDays:31},recentPosts:[post('a')]};
  assert.equal(C.complete(r,from,Date.parse(at)),false);assert.equal(R.windowCoverage(r,Date.parse(at),30).complete,false);
});
test('tampered owner, duplicate and falsely complete flags are rejected',async()=>{
  const r=await capture([post('a')]);r.companyPage.posts.push({...r.companyPage.posts[0],ownerUsername:'wrong'});r.companyPage.truncated=true;
  assert.ok(C.errors(r).length>=3);assert.equal(C.complete(r,from,Date.parse(at)),false);
});
