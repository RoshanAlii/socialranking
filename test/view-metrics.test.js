'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), path = require('path');
const N = require('../src/normalize'), P = require('../src/provider');
const at = '2026-09-09T07:25:41.987Z';
const raw = extra => ({id:'p',type:'Video',productType:'clips',timestamp:'2026-09-01T04:00:00Z',ownerUsername:'a',...extra});
test('uses explicit plays, retaining the different legacy counter', () => {
  const p=N.normalizePost(raw({videoPlayCount:29047,videoViewCount:14885}), 'instagram');
  assert.equal(p.views,29047); assert.equal(p.legacyVideoViewCount,14885);
  assert.equal(p.viewSource,'videoPlayCount'); assert.equal(p.viewMetric,'video_plays');
});
test('zero plays are real zero; invalid plays do not fall back to legacy views',()=>{
  assert.equal(N.normalizePost(raw({videoPlayCount:0,videoViewCount:100}), 'instagram').views,0);
  for(const value of [null,-1,'invalid',Infinity]) {
    assert.equal(N.normalizePost(raw({videoPlayCount:value,videoViewCount:100}), 'instagram').views,null);
  }
});
test('numeric strings and alternate explicit play field are supported',()=>{
  assert.equal(N.normalizePost(raw({videoPlayCount:'29,047'}),'instagram').views,29047);
  assert.equal(N.normalizePost(raw({playCount:120}),'instagram').views,120);
});
test('old normalized cache cannot masquerade as playback; v2 cache is idempotent',()=>{
  const old=N.normalizePost({id:'p',postedAt:at,type:'reel',views:100},'instagram');
  assert.equal(old.views,null); assert.equal(old.legacyVideoViewCount,100);
  const p=N.normalizePost(raw({videoPlayCount:200,videoViewCount:100}),'instagram');
  assert.deepEqual(N.normalizePost(p,'instagram'),p);
});
test('non-Instagram normalization is unchanged',()=>{
  assert.equal(N.normalizePost({playCount:150,videoViewCount:70},'tiktok').views,150);
});
test('migration expands the query once, then resumes incremental collection',()=>{
  const record={handle:'a',platform:'instagram',resolved:true,isPrivate:false,capturedAt:at,fetchMeta:{postsQuerySucceeded:true},recentPosts:[]};
  const p=new P.ApifyProvider('test-only',{capturedAt:at,previousSnapshot:{meta:{playbackBackfillNeeded:true},records:[record]}});
  assert.equal(p.incrementalLookbackDays(['a']),31);
  p.previousSnapshot.meta.playbackBackfillNeeded=false;
  assert.equal(p.incrementalLookbackDays(['a']),8);
});
test('cached counters retain their real observation time',()=>{
  const record={handle:'a',platform:'instagram',resolved:true,isPrivate:false,capturedAt:at,fetchMeta:{postsQuerySucceeded:true},recentPosts:[{id:'p',postedAt:at,views:200,viewMetricVersion:2}]};
  const p=new P.ApifyProvider('test-only',{capturedAt:'2026-09-10T07:25:41Z',previousSnapshot:{records:[record]}});
  assert.equal(p.mergePosts('a',[])[0].metricsObservedAt,at);
});
test('calendar totals use plays on Dubai publication cohorts, never legacy counts',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const code=html.slice(html.indexOf('    function calendarRange()'),html.indexOf('    function combineCalendar('));
  const context={DATA:{meta:{capturedAt:at}},isNumber:Number.isFinite}; vm.createContext(context);vm.runInContext(code,context);
  const record={resolved:true,isPrivate:false,fetchMeta:{postsQuerySucceeded:true,postsLookbackDays:31},recentPosts:[
    N.normalizePost(raw({id:'1',timestamp:'2026-08-31T20:00:00Z',videoPlayCount:200,videoViewCount:50,likesCount:10,commentsCount:2}),'instagram'),
    N.normalizePost(raw({id:'2',timestamp:'2026-08-31T19:59:59Z',videoPlayCount:500,videoViewCount:100}),'instagram'),
    N.normalizePost(raw({id:'3',videoViewCount:99}),'instagram'),
  ]};
  const c=context.calendarForRecord(record);
  assert.equal(c.month.posts,2);assert.equal(c.month.views,200);assert.equal(c.month.viewsReporting,1);assert.equal(c.month.viewsComplete,false);
  assert.equal(c.month.interactions,12);assert.equal(c.month.interactionsComplete,false);
  assert.match(html,/Video plays · this month’s posts/);assert.match(html,/not monthly account Insights/);
  assert.doesNotMatch(html,/Video views this month|Attention this month/);
});
test('dashboard inline scripts compile',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if(match[1].trim()) new vm.Script(match[1]);
});
test('one account reaching the cap cannot silently truncate another account',async()=>{
  const p=new P.ApifyProvider('test-only',{capturedAt:at,runSync:async(actor,input,token,opts)=>{
    opts.onAttempt({actor,ok:true,costUsd:0.01});
    if(actor===P.PROFILE_ACTOR)return [{username:'a'},{username:'b'}];
    assert.equal(input.dataDetailLevel,'detailedData');assert.equal(input.username.length,1);
    const rows=[raw({ownerUsername:input.username[0],videoPlayCount:123})];
    if(input.username[0]==='a')Object.defineProperty(rows,'_apifyRun',{value:{statusMessage:'Maximum charge limit reached'}});
    return rows;
  }});
  const rows=await p.fetchProfiles('instagram',['a','b']);
  assert.equal(rows.get('a')._postsQuerySucceeded,false);assert.equal(rows.get('a')._postsTruncated,true);
  assert.equal(rows.get('b')._postsQuerySucceeded,true);
});
test('concurrent requests reserve spending and never run beyond the refresh cap',async()=>{
  let called=0;
  const p=new P.ApifyProvider('test-only',{refreshBudgetUsd:0.75,runSync:async()=>{called++;return []}});
  const results=await Promise.allSettled([p.call('test',{}),p.call('test',{})]);
  assert.equal(called,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(p.conservativeSpentUsd,0.75);
});
test('verified empty employee feed is distinct from an unexplained empty result',async()=>{
  const p=new P.ApifyProvider('test-only',{capturedAt:at,runSync:async(actor)=>actor===P.PROFILE_ACTOR ? [{username:'a',postsCount:0}] : []});
  const r=(await p.fetchProfiles('instagram',['a'])).get('a');
  assert.equal(r._postsQuerySucceeded,true);assert.equal(r.recentPosts.length,0);
});
