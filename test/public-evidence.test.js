'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const M=require('../public-metrics');
const at='2026-09-10T08:00:00.000Z', before='2026-09-06T08:00:00.000Z';
const post=(extra={})=>({id:'1',url:'https://www.instagram.com/reel/ABC/',type:'reel',ownerUsername:'a.kirpa',
  postedAt:'2026-09-09T12:00:00Z',metricsObservedAt:at,likes:10,comments:2,videoPlayCount:100,shares:null,...extra});
const account=(extra={})=>({handle:'a.kirpa',name:'Agent',company:false,capturedAt:at,followers:100,posts:[post()],...extra});
test('Dubai month and week boundaries are calendar aligned',()=>{
  assert.deepEqual(M.bounds('2026-08-31T21:00:00Z','month'),{from:'2026-09-01',to:'2026-09-01'});
  assert.deepEqual(M.bounds('2026-08-31T21:00:00Z','week'),{from:'2026-08-31',to:'2026-09-01'});
});
test('last month covers the entire previous Dubai calendar month',()=>{
  for(const [capture,from,to] of [
    [at,'2026-08-01','2026-08-31'],
    ['2026-01-15T00:00:00Z','2025-12-01','2025-12-31'],
    ['2024-03-01T00:00:00Z','2024-02-01','2024-02-29'],
    ['2026-03-01T00:00:00Z','2026-02-01','2026-02-28'],
    ['2026-08-31T19:59:59Z','2026-07-01','2026-07-31'],
    ['2026-08-31T20:00:00Z','2026-08-01','2026-08-31'],
  ]) assert.deepEqual(M.bounds(capture,'last-month'),{from,to});
});
test('last-month totals include both Dubai boundary dates and exclude adjacent months',()=>{
  const posts=['2026-07-31T19:59:59Z','2026-07-31T20:00:00Z',
    '2026-08-31T19:59:59Z','2026-08-31T20:00:00Z']
    .map((postedAt,i)=>post({id:String(i),url:`https://www.instagram.com/reel/BOUNDARY${i}/`,postedAt}));
  const b=M.bounds(at,'last-month');
  const s=M.summarize({generatedAt:at,accounts:[account({posts})]},'team',b.from,b.to);
  assert.deepEqual(s.posts.map(p=>p.id).sort(),['1','2']);
  assert.equal(s.reels,2);
  assert.equal(s.attention.value,24);
  assert.equal(s.plays.value,200);
  assert.ok(fs.readFileSync('public-evidence.js','utf8').includes('<option value="last-month">Last calendar month</option>'));
});
test('same shortcode across URL formats deduplicates; unsafe links rejected',()=>{
  assert.equal(M.unique([post(),post({id:'2',url:'https://www.instagram.com/p/ABC/'})]).length,1);
  assert.equal(M.safeUrl('javascript:alert(1)'),null);
  assert.equal(M.safeUrl('https://evil.test/reel/A/'),null);
  assert.equal(M.key({id:3979490680606881446}),null);
});
test('calendar grids align Monday-first and navigate year and leap-month boundaries',()=>{
  const aug=M.calendarMonth('2026-08');
  assert.equal(aug.padding,5);assert.equal(aug.days.length,31);
  assert.equal(M.calendarMonth('2026-01',-1).month,'2025-12');
  assert.equal(M.calendarMonth('2025-12',1).month,'2026-01');
  assert.equal(M.calendarMonth('2024-02').days.at(-1),'2024-02-29');
  assert.equal(M.calendarMonth('2026-02').days.at(-1),'2026-02-28');
});
test('calendar selects inclusive ranges without reversed or future dates',()=>{
  const range={from:'2026-08-01',to:'2026-08-31'},max='2026-09-10';
  assert.deepEqual(M.selectCalendarDate(range,'to','2026-09-02',max),{from:'2026-08-01',to:'2026-09-02'});
  assert.deepEqual(M.selectCalendarDate(range,'from','2026-09-02',max),{from:'2026-09-02',to:'2026-09-02'});
  assert.equal(M.selectCalendarDate(range,'to','2026-07-31',max),null);
  assert.equal(M.selectCalendarDate(range,'to','2026-09-11',max),null);
  assert.equal(M.selectCalendarDate(range,'from','2026-02-30',max),null);
});
test('calendar UI updates saved-data results, presets and manual dates without additional fetches',async()=>{
  const vm=require('node:vm'),events={},fields={},requests=[];
  for(const name of ['from','to','period','account','basis','calendar','output'])
    fields[name]={value:({from:'2026-09-01',to:'2026-09-10',period:'month',account:'team',basis:'archive'})[name],innerHTML:'',textContent:'',
      matches:s=>s==='input'&&['from','to'].includes(name),querySelector:()=>({focus(){},disabled:false})};
  const host={innerHTML:'',querySelector:s=>fields[s.match(/data-evidence-(\w+)/)[1]],addEventListener:(type,fn)=>events[type]=fn};
  const d={version:1,generatedAt:at,accounts:[account({posts:[post(),post({id:'2',url:'https://www.instagram.com/reel/AUG/',postedAt:'2026-08-15T12:00:00Z'})]})]};
  vm.runInNewContext(fs.readFileSync('public-evidence.js','utf8'),{
    document:{getElementById:()=>host},KirpaPublicMetrics:M,
    fetch:async url=>{requests.push(url);return{ok:true,json:async()=>d};}
  });
  await new Promise(resolve=>setImmediate(resolve));
  const click=dataset=>events.click({target:{closest:()=>({dataset,disabled:false,matches:()=>false})}});
  assert.ok(fields.calendar.innerHTML.includes('August 2026'));
  assert.ok(fields.calendar.innerHTML.includes('September 2026'));
  click({calendarDay:'2026-08-01'});
  assert.equal(fields.from.value,'2026-08-01');assert.equal(fields.period.value,'custom');
  assert.ok(fields.calendar.innerHTML.includes('Choose the <strong>To</strong>'));
  click({calendarDay:'2026-08-31'});
  assert.equal(fields.to.value,'2026-08-31');
  assert.ok(fields.output.innerHTML.includes('Every captured post · 1 results'));
  assert.ok(fields.output.innerHTML.includes('/reel/AUG/'));
  assert.ok(!fields.output.innerHTML.includes('/reel/ABC/'));
  click({calendarStep:'-1'});assert.ok(fields.calendar.innerHTML.includes('July 2026'));
  fields.period.value='last-month';events.change({target:fields.period});
  assert.equal(fields.from.value,'2026-08-01');assert.equal(fields.to.value,'2026-08-31');
  fields.from.value='2026-09-01';fields.to.value='2026-09-10';events.change({target:fields.to});
  assert.ok(fields.calendar.innerHTML.includes('September 2026'));
  assert.ok(fields.output.innerHTML.includes('/reel/ABC/'));
  fields.to.value='2026-09-11';events.change({target:fields.to});
  assert.ok(fields.output.textContent.includes('latest saved capture'));
  assert.deepEqual(requests,['data/public-evidence.json']);
});
test('team excludes company and shared posts; company retains evidenced collaboration',()=>{
  const data={generatedAt:at,accounts:[account(),account({handle:'kirpa.properties',company:true,posts:[post()]})]};
  assert.equal(M.summarize(data,'team','2026-09-01','2026-09-30').posts.length,1);
  assert.equal(M.summarize(data,'kirpa.properties','2026-09-01','2026-09-30').posts.length,1);
});
test('null and zero remain distinct; legacy views never substitute for plays',()=>{
  const s=M.summarize({generatedAt:at,accounts:[account({posts:[post({videoPlayCount:null,views:900,likes:null}),post({id:'2',url:'https://www.instagram.com/p/DEF/',likes:0,comments:0,videoPlayCount:0})]})]},'team','2026-09-01','2026-09-30');
  assert.deepEqual(s.plays,{value:0,reporting:1,expected:2});
  assert.deepEqual(s.attention,{value:0,reporting:1,expected:2});
  assert.deepEqual(s.shares,{value:null,reporting:0,expected:2});
});
test('history retains older counters with original timestamps and shares evidence',()=>{
  const old=account({capturedAt:before,posts:[post({metricsObservedAt:before,shares:5,sharesObservedAt:before}),post({id:'2',url:'https://www.instagram.com/p/OLD/',postedAt:'2026-08-01T00:00:00Z',metricsObservedAt:before})]});
  const merged=M.mergeAccount(old,account());
  assert.equal(merged.posts.length,2);assert.equal(merged.posts[1].metricsObservedAt,before);
  assert.equal(merged.posts[0].shares,5);assert.equal(merged.posts[0].sharesObservedAt,before);
  assert.equal(merged.previous.capturedAt,before);
});
test('comparison uses only matched counters; preserves negative corrections; no new-post lifetime sums',()=>{
  const a=account({posts:[post({likes:8}),post({id:'2',url:'https://www.instagram.com/p/NEW/',videoPlayCount:9999})],
    previous:{capturedAt:before,followers:99,posts:[post({likes:10,videoPlayCount:90,metricsObservedAt:before})]}});
  const c=M.compare(a);assert.equal(c.matched,1);assert.equal(c.fields.likes.value,-2);
  assert.equal(c.fields.likes.decreases,1);assert.equal(c.fields.videoPlayCount.value,10);assert.equal(c.followerChange,1);
});
test('rebuilding the same snapshot does not destroy the previous baseline',()=>{
  const old=account({previous:{capturedAt:before,followers:99,posts:[]}});
  assert.equal(M.mergeAccount(old,account()).previous.capturedAt,before);
});
test('historical omissions are explicit and can be excluded from latest-only totals',()=>{
  const d={generatedAt:at,accounts:[account({posts:[post(),post({id:'2',url:'https://www.instagram.com/p/OLD/',metricsObservedAt:before})]})]};
  assert.equal(M.summarize(d,'team','2026-09-01','2026-09-30').retainedPosts,1);
  const latest=M.summarize(d,'team','2026-09-01','2026-09-30','latest');
  assert.equal(latest.posts.length,1);assert.equal(latest.retainedPosts,0);
});
test('older snapshot replay cannot roll back newer evidence or lose shares audit',()=>{
  const current=account({sharesPilot:{reporting:5,requested:5}});
  assert.equal(M.mergeAccount(current,account({capturedAt:before})),current);
  assert.equal(M.mergeAccount(current,account()).sharesPilot.reporting,5);
});
test('live evidence is minimal, valid, deduplicated and reconciles',()=>{
  if(!fs.existsSync('data/public-evidence.json'))return;
  const d=JSON.parse(fs.readFileSync('data/public-evidence.json','utf8'));
  assert.equal(d.version,1);assert.ok(d.accounts.length>0);
  for(const a of d.accounts){
    assert.equal(M.unique(a.posts).length,a.posts.length);
    for(const p of a.posts){assert.ok(M.key(p));assert.ok(Number.isFinite(Date.parse(p.metricsObservedAt)));
      assert.equal(p.caption,undefined);assert.equal(p.thumb,undefined);
      for(const k of ['likes','comments','shares','videoPlayCount'])assert.ok(p[k]===null||typeof p[k]==='number'&&p[k]>=0);}
  }
  const b=M.bounds(d.generatedAt,'month'),s=M.summarize(d,'team',b.from,b.to);
  assert.equal(s.posts.length,s.reels+s.images+s.carousels+s.videos);
  assert.equal(s.plays.value,s.posts.filter(p=>['reel','video'].includes(p.type)&&typeof p.videoPlayCount==='number').reduce((n,p)=>n+p.videoPlayCount,0));
});
test('paid history is manual, budget-reserved and cannot alter scoring snapshot',()=>{
  const workflow=fs.readFileSync('.github/workflows/public-evidence.yml','utf8');
  assert.ok(!workflow.includes('schedule:'));
  assert.ok(workflow.includes("'four-day-social-snapshot'"));
  assert.ok(workflow.includes('ref: ${{ github.ref }}'));
  assert.ok(workflow.includes('public-evidence-check-'));
  const source=fs.readFileSync('src/collect-public-history.js','utf8');
  assert.ok(source.includes('state.spent + 0.75 > 8'));
  assert.ok(source.includes('state.pending'));
  assert.ok(source.indexOf("if (mode === 'reconcile')") < source.indexOf('async function runSync'));
  assert.ok(!source.includes("writeFileSync('data/latest.json'"));
});
