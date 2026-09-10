'use strict';
// Manual bounded backfill. Never edits the ranked snapshot or starts on a cron.
process.env.APIFY_IG_POST_LOOKBACK_DAYS = '90';
process.env.APIFY_IG_POST_RESULTS_LIMIT = '600';
process.env.APIFY_MAX_RUN_CHARGE_USD = '0.75';
const fs = require('node:fs');
const {ApifyProvider, apifyRunSync, groupProfileItems, instagramProfileInput, PROFILE_ACTOR} = require('./provider');
const N = require('./normalize');
const M = require('../public-metrics');
async function main() {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Apify access is not configured');
  const mode = process.env.HISTORY_MODE || 'pilot';
  if (!['pilot','remaining','shares'].includes(mode)) throw new Error('Unsupported collection mode');
  const snapshot = JSON.parse(fs.readFileSync('data/latest.json','utf8'));
  const candidates = M.fromSnapshot(snapshot);
  const pilotHandles = ['kirpa.properties','jai.kirpa','manpreet.kirpa','samaksh.kirpa','roshan.kirpa'];
  const pilot = candidates.filter(a => pilotHandles.includes(a.handle));
  // Fill to five from the confirmed roster if a named pilot is not active.
  for (const a of candidates) if (pilot.length < 5 && !pilot.some(p => p.handle === a.handle)) pilot.push(a);
  async function api(method,path,body) {
    const res = await fetch('https://api.apify.com'+path,{method,
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(70000)});
    if (res.status===404 && method==='GET') return null;
    if (!res.ok) throw new Error(`Apify storage request failed (${res.status})`);
    return method==='PUT' ? null : res.json();
  }
  const store = (await api('POST','/v2/key-value-stores?name=kirpa-public-history-v1')).data;
  const path = `/v2/key-value-stores/${store.id}/records/STATE`;
  const state = await api('GET',path) || {spent:0,done:{},runs:[],accounts:{}};
  const file = 'data/public-evidence.json';
  let output = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : M.mergeSnapshot(null,snapshot);
  // Rehydrate completed work after an interrupted workflow; do not pay twice.
  output.accounts = output.accounts.map(a => state.accounts[a.handle] || a);
  const save = async () => {
    await api('PUT',path,state);
    output.backfill = {budgetUsd:8, spentOrReservedUsd:state.spent, mode, runs:state.runs,
      completed:Object.keys(state.done).length, requested:candidates.length};
    output.generatedAt = output.accounts.map(a=>a.capturedAt).sort().at(-1);
    fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');
  };
  if (state.pending) throw new Error('A previous paid request needs review before another run');
  async function runSync(actor,input,_token,opts) {
    // Reserve before POST, including interrupted/unknown-cost requests.
    if (state.spent + 0.75 > 8) throw new Error('One-time $8 history allowance reached');
    state.spent += 0.75; state.pending = {actor, at:new Date().toISOString()}; await save();
    let event;
    try {
      const rows = await apifyRunSync(actor,input,token,{...opts,retries:1,onAttempt:e=>{event=e;opts.onAttempt?.(e);}});
      if (Number.isFinite(event?.costUsd)) state.spent += event.costUsd-0.75;
      state.runs.push({actor,runId:event?.runId,costUsd:event?.costUsd ?? null,items:rows.length});
      state.pending=null; await save(); return rows;
    } catch (e) {
      // Keep an ambiguous reservation pending. No automatic paid retries.
      if (event?.runId && Number.isFinite(event.costUsd)) {
        state.spent += event.costUsd-0.75;
        state.runs.push({actor,runId:event.runId,costUsd:event.costUsd,status:event.status});
        state.pending=null;
      }
      await save(); throw e;
    }
  }
  const provider = new ApifyProvider(token,{runSync,refreshBudgetUsd:8,postConcurrency:1});
  let accounts = mode==='remaining' ? candidates : pilot;
  accounts = accounts.filter(a=>mode==='shares' ? !state.sharesDone?.[a.handle] : !state.done[a.handle]);
  if (mode === 'shares') {
    state.sharesDone ||= {};
    for (const a of accounts) {
      const current = output.accounts.find(r=>r.handle===a.handle);
      const wanted = current.posts.filter(p=>p.type==='reel' && p.url).sort((a,b)=>Date.parse(b.postedAt)-Date.parse(a.postedAt)).slice(0,5);
      if (!wanted.length) continue;
      const rows = await provider.call('apify~instagram-reel-scraper',{username:wanted.map(p=>p.url),
        includeSharesCount:true,includeTranscript:false,includeDownloadedVideo:false,skipPinnedPosts:false});
      const at = new Date().toISOString(), expected = new Set(wanted.map(M.key));
      const valid = rows.map(r=>N.normalizePost(r,'instagram')).filter(p=>expected.has(M.key(p)));
      for (const p of current.posts) {
        const r = valid.find(r=>M.key(r)===M.key(p));
        if (r && typeof r.shares==='number') Object.assign(p,{shares:r.shares,sharesObservedAt:at,sharesSource:'apify~instagram-reel-scraper'});
      }
      current.sharesPilot = {at,runId:rows._apifyRun?.id,requested:wanted.length,matched:valid.length,
        reporting:valid.filter(p=>typeof p.shares==='number').length,fields:rows[0]?Object.keys(rows[0]):[]};
      state.accounts[a.handle]=current; state.sharesDone[a.handle]=true; await save();
    }
  } else if (accounts.length) {
    const profiles = groupProfileItems(accounts.map(a=>a.handle),await provider.call(PROFILE_ACTOR,instagramProfileInput(accounts.map(a=>a.handle))));
    for (const a of accounts) {
      const details=profiles.get(a.handle);
      if (!details || details.private===true || details.isPrivate===true) continue;
      provider.capturedAt=new Date().toISOString();
      const raw = await provider.fetchBrandProfile('instagram',a.handle,{details,employee:!a.company});
      if (state.pending) throw new Error('Ambiguous request retained for review');
      const record = N.normalizeRecord({...a,platform:'instagram'},raw,provider.capturedAt);
      const fresh = M.fromSnapshot({meta:{capturedAt:provider.capturedAt},records:a.company?[]:[record],brand:a.company?[record]:[]})[0];
      if (!fresh) continue;
      const old=output.accounts.find(r=>r.handle===a.handle);
      const merged=M.mergeAccount(old,fresh);
      merged.historyCoverage={...fresh.coverage};
      // Failed/incomplete attempts cannot replace the last checked account.
      if (fresh.coverage.complete) {
        state.accounts[a.handle]=merged; state.done[a.handle]=provider.capturedAt;
        output.accounts=output.accounts.map(r=>r.handle===a.handle?merged:r);
      } else {
        old.lastHistoryAttempt={at:provider.capturedAt,reason:fresh.coverage.reason || 'Feed coverage not confirmed'};
      }
      await save();
      console.log(JSON.stringify({handle:a.handle,posts:fresh.posts.length,complete:fresh.coverage.complete,spent:state.spent}));
    }
  }
  await save();
  console.log(JSON.stringify(output.backfill));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
