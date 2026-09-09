'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {targets, normalize, applyCapture, publicSummary, dubaiDate} = require('../src/stories');
const metrics = require('../story-metrics');
const at = '2026-09-09T09:00:00Z';
const accounts = [{handle:'kirpa.properties', name:'Kirpa Properties', company:true}];
const row = {username:'kirpa.properties', is_private:false, story_pk:'1234567890123456789', taken_at:'2026-09-08T21:00:00Z', expiring_at:'2026-09-09T21:00:00Z', media_type:'video'};
const capture = (prior={}, override={}) => applyCapture(prior,{rows:[row], output:{outcome:'ok',delivered:1,granted_targets:1,granted_results:30,failed_targets:[]}, run:{id:'run1',status:'SUCCEEDED'}, accounts, observedAt:at,maxResults:30,...override});
test('Dubai midnight and account exclusions',()=>{
  assert.equal(dubaiDate(row.taken_at),'2026-09-09');
  assert.equal(targets({records:[{platform:'instagram',resolved:true,isPrivate:true,handle:'x'}, {platform:'instagram',resolved:true,isPrivate:false,handle:'@KIRPA.PROPERTIES'}],brand:[]})[0].handle,'kirpa.properties');
});
test('IDs are lossless; reject private, foreign, malformed and future rows',()=>{
  const wanted=new Set(['kirpa.properties']);
  assert.equal(normalize(row,wanted,at).key,'kirpa.properties:1234567890123456789');
  for(const changed of [{is_private:true},{username:'foreign'},{story_pk:1234567890123456789},{taken_at:'2026-09-10T00:00:00Z'},{media_type:'unknown'},{expiring_at:null}]) assert.equal(normalize({...row,...changed},wanted,at),null);
});
test('repeated rows and successive captures never duplicate Story counts',()=>{
  const first=capture({}, {rows:[row,row],output:{outcome:'ok',delivered:2,granted_targets:1,granted_results:30,failed_targets:[]}});
  const next=capture(first);
  assert.equal(Object.values(next.daily)[0].video,1);
  assert.equal(next.accounts['kirpa.properties'].activeAtCheck,1);
  assert.equal(next.checks[1].checked,1);
});
test('confirmed empty differs from denied, failed or unconfirmed empty',()=>{
  const empty=capture({}, {rows:[],output:{outcome:'ok',delivered:0,granted_targets:1,granted_results:30,failed_targets:[]}});
  assert.equal(empty.accounts['kirpa.properties'].activeAtCheck,0);
  for(const output of [null,{outcome:'denied'}, {outcome:'ok',delivered:0,granted_targets:1,granted_results:30,failed_targets:['kirpa.properties']}]) {
    const result=capture({}, {rows:[],output});
    assert.equal(result.accounts['kirpa.properties'].activeAtCheck,null);
    assert.equal(result.checks[0].checked,0);
  }
});
test('failures retain last good observations and successful timestamp',()=>{
  const first=capture();
  const result=capture(first,{rows:[],output:null,observedAt:'2026-09-09T21:00:00Z',run:{id:'bad',status:'FAILED'}});
  assert.deepEqual(result.daily,first.daily);
  assert.equal(result.accounts['kirpa.properties'].lastSuccessAt,at);
  assert.equal(result.accounts['kirpa.properties'].status,'incomplete');
});
test('limits and rejected data prevent claims of full coverage',()=>{
  assert.equal(capture({}, {maxResults:1}).checks[0].checked,0);
  assert.equal(capture({}, {run:{id:'capped',status:'SUCCEEDED',statusMessage:'Maximum total charge reached'}}).checks[0].checked,0);
  assert.equal(capture({}, {rows:[{...row,is_private:true}]}).checks[0].checked,0);
});
test('public summary exposes aggregates, never raw stories or private metrics',()=>{
  const state=capture();
  const summary=publicSummary(state,{actor:'test',enabled:true,intervalHours:12,monthlyBudgetUsd:8},accounts,at);
  const json=JSON.stringify(summary);
  assert.ok(!json.includes(row.story_pk));
  assert.ok(!json.includes('media_url'));
  assert.equal(summary.daily[0].video,1);
  assert.equal(summary.accounts.length,1);
});
test('Story period filters use Dubai calendar month and Monday week across month boundaries',()=>{
  assert.equal(metrics.periodStart('2026-08-31T21:00:00Z','month'),'2026-09-01');
  assert.equal(metrics.periodStart('2026-08-31T21:00:00Z','week'),'2026-08-31');
  assert.equal(metrics.periodStart('2026-09-09T09:00:00Z','30'),'2026-08-11');
});
test('company and team Story counts are separate; freshness ages with browser time',()=>{
  const state=capture();
  const data=publicSummary(state,{enabled:true,intervalHours:12,monthlyBudgetUsd:8},accounts,at);
  assert.equal(metrics.summarize(data,'team','month',Date.parse(at)).total,0);
  assert.equal(metrics.summarize(data,'kirpa.properties','month',Date.parse(at)).total,1);
  assert.equal(metrics.summarize(data,'kirpa.properties','month',Date.parse(at)).fresh,1);
  assert.equal(metrics.summarize(data,'kirpa.properties','month',Date.parse(at)+14*3600000).fresh,0);
});
