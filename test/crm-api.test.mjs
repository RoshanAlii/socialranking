import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker,{handle,passwordHash,hash,seal,unseal,sanitize,bitrix} from '../dist/server/index.js';
function database(){
  const sql=new DatabaseSync(':memory:');
  for(const f of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')))
    sql.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
  const prepare=query=>({bind(...args){return{
    async first(){return sql.prepare(query).get(...args)||null;},
    async run(){return sql.prepare(query).run(...args);}
  };}});
  return{prepare,async batch(jobs){return Promise.all(jobs.map(j=>j.run()));},sql};
}
const ctx={waitUntil:p=>p.catch(()=>{})};
const base='https://service.example';
const origin='https://roshanalii.github.io';
async function environment(){return{DB:database(),CRM_PASSWORD_SALT:'test-only-salt',CRM_PASSWORD_HASH:await passwordHash('test-password','test-only-salt'),CRM_SECRET_KEY:'ab'.repeat(32),SETUP_OWNER_EMAIL:'owner@example.com',ALLOWED_ORIGIN:origin};}
const req=(path,options={})=>new Request(base+path,options);
test('unauthenticated report returns 401 with no CRM data',async()=>{const r=await worker.fetch(req('/report?month=2026-09'),await environment(),ctx);assert.equal(r.status,401);assert.match(await r.text(),/Sign in/);});
test('client-side legacy hash cannot unlock the server',async()=>{const r=await worker.fetch(req('/report?month=2026-09',{headers:{Authorization:'Bearer '+'a'.repeat(64)}}),await environment(),ctx);assert.equal(r.status,401);});
test('valid password produces expiring opaque token; wrong password fails',async()=>{const env=await environment();let r=await handle(req('/session',{method:'POST',body:JSON.stringify({password:'incorrect'})}),env,ctx);assert.equal(r.status,401);r=await handle(req('/session',{method:'POST',body:JSON.stringify({password:'test-password'})}),env,ctx);const s=await r.json();assert.match(s.token,/^[a-f0-9]{64}$/);assert.ok(s.expires>Date.now());assert.ok(env.DB.sql.prepare('SELECT * FROM sessions WHERE hash=?').get(await hash(s.token)));assert.equal(env.DB.sql.prepare('SELECT * FROM sessions WHERE hash=?').get(s.token),undefined);});
test('brute-force login is limited across requests',async()=>{const env=await environment();for(let i=0;i<6;i++)assert.equal((await handle(req('/session',{method:'POST',body:'{"password":"bad"}'}),env,ctx)).status,401);assert.equal((await handle(req('/session',{method:'POST',body:'{"password":"test-password"}'}),env,ctx)).status,429);});
test('unexpected origins cannot call the service',async()=>{const r=await handle(req('/session',{method:'POST',headers:{Origin:'https://attacker.example'},body:'{}'}),await environment(),ctx);assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);});
test('setup requires owner identity and same-origin submission',async()=>{const env=await environment();assert.equal((await handle(req('/setup'),env,ctx)).status,302);assert.equal((await handle(req('/setup',{headers:{'oai-authenticated-user-email':'other@example.com'}}),env,ctx)).status,403);assert.equal((await handle(req('/setup',{method:'POST',headers:{'oai-authenticated-user-email':'owner@example.com',Origin:'https://attacker.example'}}),env,ctx)).status,403);});
test('connection key is encrypted with separate environment key',async()=>{const key='a1'.repeat(32),value='private-value';const sealed=await seal(value,key);assert.ok(!sealed.includes(value));assert.equal(await unseal(sealed,key),value);await assert.rejects(unseal(sealed,'b2'.repeat(32)));});
test('owner setup accepts an expiring CSRF token and stores only encrypted credentials',async()=>{
  const env=await environment(),headers={'oai-authenticated-user-email':'owner@example.com',Origin:'null'},originalFetch=globalThis.fetch;
  const page=await (await handle(req('/setup',{headers}),env,ctx)).text();
  const csrf=page.match(/name="csrf" value="([^"]+)"/)[1];
  const value='https://kirpa.bitrix24.com/rest/1/testonly/';
  globalThis.fetch=async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(JSON.stringify({result:[]}));};
  try{const result=await handle(req('/setup',{method:'POST',headers,body:new URLSearchParams({csrf,webhook:value})}),env,ctx);
    assert.equal(result.status,200);assert.match(await result.text(),/verified and saved/);
    const saved=env.DB.sql.prepare('SELECT cipher FROM connection_secrets').get();assert.ok(!saved.cipher.includes(value));assert.equal(await unseal(saved.cipher,env.CRM_SECRET_KEY),value);
  }finally{globalThis.fetch=originalFetch;}
});
test('output minimization excludes customer and source note fields',()=>{const p=sanitize({duplicateImports:0,leads:[{ID:'1',PHONE:'private',COMMENTS:'private',NAME:'private',SOURCE_DESCRIPTION:'private',attribution:{status:'unknown'}}],deals:[{ID:'2',OPPORTUNITY:'private'}]});assert.ok(!JSON.stringify(p).includes('private'));});
test('Bitrix method allowlist and destination fail closed',async()=>{await assert.rejects(bitrix({BITRIX_WEBHOOK_BASE:'https://attacker.example/rest/1/x/'},'crm.lead.list'));await assert.rejects(bitrix({BITRIX_WEBHOOK_BASE:'https://kirpa.bitrix24.com/rest/1/x/'},'crm.lead.update'));});
test('failed refresh keeps previous complete report',async()=>{const env=await environment(),token='c'.repeat(64),month=new Date().toISOString().slice(0,7);await env.DB.prepare('INSERT INTO sessions(hash,expires) VALUES (?,?)').bind(await hash(token),Date.now()+60000).run();await env.DB.prepare('INSERT INTO reports(month,payload,captured) VALUES (?,?,?)').bind(month,'{"marker":"previous"}',1).run();const r=await handle(req('/report?month='+month,{method:'POST',headers:{Authorization:'Bearer '+token}}),env,ctx);const b=await r.json();assert.equal(b.report.marker,'previous');assert.equal(b.refresh,'failed');assert.equal(b.stale,true);});
test('revoked session cannot read again',async()=>{const env=await environment(),token='d'.repeat(64);await env.DB.prepare('INSERT INTO sessions(hash,expires) VALUES (?,?)').bind(await hash(token),Date.now()+60000).run();const headers={Authorization:'Bearer '+token};assert.equal((await handle(req('/session',{method:'DELETE',headers}),env,ctx)).status,200);assert.equal((await handle(req('/report?month=2026-09',{headers}),env,ctx)).status,401);});
test('inline reporting is before Momentum Leader and uses secure transport',()=>{const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.ok(html.indexOf('id="crm-results"')<html.indexOf('id="champ"'));assert.match(html,/crm\/secure.js/);const front=fs.readFileSync(new URL('../crm/dashboard.js',import.meta.url),'utf8');assert.doesNotMatch(front,/BX24|BITRIX_WEBHOOK|\.COMMENT/);});
