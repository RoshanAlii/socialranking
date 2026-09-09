'use strict';
const fs = require('node:fs');
const {targets, applyCapture, publicSummary, dubaiDate} = require('./stories');
const config = require('../config/stories.json');
const {waitForApifyRun} = require('./provider');

async function main() {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('Apify access is not configured');
  const pilot = process.argv.includes('--pilot');
  const now = new Date().toISOString();
  const all = targets(JSON.parse(fs.readFileSync('data/latest.json', 'utf8')));
  const accounts = pilot ? all.filter(a => config.pilotHandles.includes(a.handle)) : all;
  if (!accounts.length) throw new Error('No confirmed public marketing accounts');
  if (!pilot && !config.enabled) throw new Error('Story rollout is disabled pending pilot validation');
  async function api(method, path, body) {
    const response = await fetch(`https://api.apify.com${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body != null ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(70000) });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw new Error(`Apify request failed (${response.status})`);
    if (method === 'PUT') return null;
    return response.json();
  }
  const store = (await api('POST', `/v2/key-value-stores?name=${config.storeName}${pilot ? '-pilot' : ''}`)).data;
  const key = `/v2/key-value-stores/${store.id}/records/STATE`;
  let state = await api('GET', key) || {seen:{}, daily:{}, accounts:{}, checks:[], spend:{}, runs:[]};
  state.spend ||= {}; state.runs ||= [];
  const month = dubaiDate(now).slice(0,7), cap = pilot ? 0.10 : config.maxRunChargeUsd;
  const maxResults = pilot ? 30 : config.maxResults;
  const save = async () => { await api('PUT', key, state); fs.writeFileSync('data/stories.json', JSON.stringify(publicSummary(state, config, all, new Date().toISOString()), null, 2)+'\n'); };
  // Reserve before the paid request: ambiguous failures/interruptions cannot
  // silently reset the allowance. No automatic retries of paid starts.
  if (state.inFlight || state.pending || (!pilot && state.lastAttemptAt && Date.now()-Date.parse(state.lastAttemptAt)<11.5*3600000)) {
    state.lastStatus = state.inFlight || state.pending ? 'Previous collection needs review; paid retry withheld' : 'Next 12-hour check is not due';
    await save(); return;
  }
  if ((state.spend[month] || 0) + cap > config.monthlyBudgetUsd) {
    state.lastStatus = 'Monthly Story allowance reached; previous observations retained'; await save(); return;
  }
  state.spend[month] = (state.spend[month] || 0) + cap;
  state.pending = true; state.lastAttemptAt = now; await api('PUT', key, state);
  let run;
  try {
    run = (await api('POST', `/v2/acts/${config.actor}/runs?maxTotalChargeUsd=${cap}&timeout=180&memory=256`, {usernames: accounts.map(a=>a.handle), maxResults})).data;
    state.inFlight = run.id; state.pending = false; await api('PUT', key, state);
    run = await waitForApifyRun(run, token, 240000, {request: (method,path,_token,body)=>api(method,path,body)});
    const rows = await api('GET', `/v2/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${maxResults+1}`);
    const output = await api('GET', `/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/OUTPUT`);
    if (!Array.isArray(rows)) throw new Error('Story results were not a list');
    state = applyCapture(state, {rows, output, run, accounts, observedAt:new Date().toISOString(), maxResults});
    state.lastStatus = state.checks.at(-1).checked === accounts.length ? 'Collection checked' : 'Partial collection; coverage gaps recorded';
    state.inFlight = null;
    if (Number.isFinite(run.usageTotalUsd)) state.spend[month] += run.usageTotalUsd - cap;
    state.runs.push({id:run.id, at:now, status:run.status, costUsd:run.usageTotalUsd ?? null, reservedUsd:cap, returned:rows.length});
    state.runs = state.runs.slice(-100);
    await save();
    console.log(JSON.stringify({pilot, runId:run.id, costUsd:run.usageTotalUsd, ...state.checks.at(-1),
      output: {outcome:output?.outcome, granted_targets:output?.granted_targets, granted_results:output?.granted_results, delivered:output?.delivered, failed_targets:output?.failed_targets},
      fields: rows[0] ? Object.keys(rows[0]) : []}));
    if (state.checks.at(-1).checked !== accounts.length) process.exitCode = 1;
  } catch (error) {
    state.lastStatus = 'Collection failed; previous observations retained. Review required before another paid run.';
    await save(); throw error;
  }
}
if (require.main === module) main().catch(e=>{console.error(e.message); process.exitCode=1;});
