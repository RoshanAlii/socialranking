'use strict';
const assert = require('node:assert/strict');
const M = require('../crm/metrics');
const people=[{name:'Agent A',handle:'a.kirpa'},{name:'Agent B',handle:'b.kirpa'}];
const config={originators:{capture:'a.kirpa'},sources:{sourceB:'b.kirpa'}};
const window=M.monthWindow('2026-09');
const lead=(ID,extra={})=>({ID:String(ID),DATE_CREATE:'2026-09-01T10:00:00+04:00',SOURCE_DESCRIPTION:'Instagram @a.kirpa',...extra});
const deal=(ID,LEAD_ID,extra={})=>({ID:String(ID),LEAD_ID:String(LEAD_ID),STAGE_SEMANTIC_ID:'S',CLOSEDATE:'2026-09-05T10:00:00+04:00',...extra});
const prepare=(leads,deals=[])=>M.prepare({leads,deals,people,sources:{IG:'Instagram'},config});
const summary=p=>M.summarize(p,window,'a.kirpa',Date.parse('2026-09-07T12:00:00Z'),config);
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('Dubai calendar boundary is inclusive start, exclusive next month',()=>{
 assert.equal(M.inWindow('2026-08-31T19:59:59Z',window),false);
 assert.equal(M.inWindow('2026-08-31T20:00:00Z',window),true);
 assert.equal(M.inWindow('2026-09-30T20:00:00Z',window),false);
 assert.equal(M.monthWindow('2026-12').end,'2027-01-01T00:00:00+04:00');
 assert.throws(()=>M.monthWindow('2026-13'));
});
test('exact source declaration confirms creator',()=>assert.equal(M.attribute(lead(1),people).creator,'a.kirpa'));
test('assignment and name alone never confirm creator',()=>assert.equal(M.attribute({ASSIGNED_BY_ID:'1',COMMENTS:'Agent A'},people).status,'unknown'));
test('mention in social prose needs review',()=>assert.equal(M.attribute({COMMENTS:'Customer saw Instagram @a.kirpa'},people).status,'needs_review'));
test('substring matches are rejected',()=>assert.equal(M.attribute({COMMENTS:'Instagram @nota.kirpa'},people).candidates.length,0));
test('structured conflicts need review',()=>assert.equal(M.attribute(lead(1,{SOURCE_ID:'sourceB'}),people,{},config).status,'needs_review'));
test('generic Instagram source stays unattributed',()=>assert.equal(M.attribute({SOURCE_ID:'IG'},people,{IG:'Instagram'}).status,'unattributed'));
test('unknown originator cannot confirm attribution',()=>assert.equal(M.attribute({ORIGINATOR_ID:'invented'},people,{},config).status,'unknown'));
test('same lead ID is counted once',()=>assert.equal(summary(prepare([lead(1),lead(1)])).leads,1));
test('known repeat capture origin merged and deal aliases retained',()=>{
 const p=prepare([lead(1,{ORIGINATOR_ID:'capture',ORIGIN_ID:'x'}),lead(2,{ORIGINATOR_ID:'capture',ORIGIN_ID:'x'})],[deal(1,2)]);
 assert.equal(p.duplicateImports,1);assert.equal(summary(p).converted,1);assert.equal(summary(p).leads,1);
});
test('unverified origins are not merged',()=>assert.equal(summary(prepare([lead(1,{ORIGINATOR_ID:'x',ORIGIN_ID:'same'}),lead(2,{ORIGINATOR_ID:'x',ORIGIN_ID:'same'})])).leads,2));
test('multiple deals do not inflate lead conversion',()=>{
 const q=summary(prepare([lead(1),lead(2)],[deal(1,1),deal(2,1),deal(2,1)]));
 assert.equal(q.converted,1);assert.equal(q.conversion,.5);assert.equal(q.closedDeals,2);
});
test('old lead closure counted separately from cohort conversion',()=>{
 const q=summary(prepare([lead(1),lead(2,{DATE_CREATE:'2026-08-01T12:00:00+04:00'})],[deal(1,2)]));
 assert.equal(q.leads,1);assert.equal(q.converted,0);assert.equal(q.closedDeals,1);
});
test('lost, reopened and future closing dates do not count as won',()=>{
 const q=summary(prepare([lead(1)],[deal(1,1,{STAGE_SEMANTIC_ID:'F'}),deal(2,1,{STAGE_SEMANTIC_ID:'P'}),deal(3,1,{CLOSEDATE:'2026-10-01T00:00:00+04:00'})]));
 assert.equal(q.converted,0);assert.equal(q.closedDeals,0);assert.equal(q.openDeals,1);
});
test('zero leads is not zero percent conversion',()=>assert.equal(summary(prepare([])).conversion,null));
test('unlinked closed deal is not attributed to its assignee',()=>{
 const q=summary(prepare([lead(1)],[deal(1,0,{ASSIGNED_BY_ID:'1'})]));
 assert.equal(q.closedDeals,0);assert.equal(q.unlinkedClosures,1);
});
test('review evidence never contributes to confirmed KPI',()=>{
 const q=summary(prepare([lead(1,{SOURCE_DESCRIPTION:'Instagram enquiry via @a.kirpa'})],[deal(1,1)]));
 assert.equal(q.review,1);assert.equal(q.leads,0);assert.equal(q.closedDeals,0);
});
test('empty qualified stage configuration means unknown, not zero',()=>assert.equal(summary(prepare([lead(1)])).qualified,null));
test('all CRM labels are escaped before HTML insertion',()=>assert.equal(M.escape('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
test('opted-out or unconfirmed roster accounts excluded',()=>assert.equal(M.roster({employees:[{confirmed:false,handles:{instagram:'a.kirpa'}},{confirmed:true,optOut:true,handles:{instagram:'b.kirpa'}}]}).length,0));
test('invalid CRM IDs fail closed',()=>assert.throws(()=>prepare([{ID:'javascript:alert(1)'}])));
const fs=require('node:fs');
test('private client has no mutation calls or persistent CRM storage',()=>{
 const src=fs.readFileSync(require.resolve('../crm/dashboard.js'),'utf8');
 assert.doesNotMatch(src,/(?:localStorage|sessionStorage|indexedDB|sendBeacon|\.update['"]|\.add['"]|\.delete['"])/);
 assert.doesNotMatch(src,/['"](?:PHONE|EMAIL|NAME|LAST_NAME|OPPORTUNITY)['"]/);
});
console.log(`${count} CRM tests passed`);
