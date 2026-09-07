import M from '../crm/metrics.js';
import registry from '../handles.json';
import config from '../crm/config.json';

const people=M.roster(registry), DAY=86400000, HOUR=3600000;
const leadFields=['ID','DATE_CREATE','DATE_MODIFY','SOURCE_ID','SOURCE_DESCRIPTION','COMMENTS','ORIGINATOR_ID','ORIGIN_ID','ASSIGNED_BY_ID','STATUS_ID','UF_CRM_1755148569691','UF_CRM_1755515975693'];
const dealFields=['ID','LEAD_ID','DATE_CREATE','DATE_MODIFY','CLOSEDATE','STAGE_ID','STAGE_SEMANTIC_ID','ASSIGNED_BY_ID'];
const methods=new Set(['crm.lead.list','crm.deal.list','crm.status.list','crm.timeline.comment.list']);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const hash=async value=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
export async function passwordHash(password,salt){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},k,256));}
const equal=(a,b)=>{let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;};
function response(body,status=200,origin=''){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});}
const db=env=>{if(!env.DB)throw new Error('Service storage unavailable');return env.DB;};
const unhex=value=>Uint8Array.from(value.match(/../g)||[],b=>parseInt(b,16));
export async function seal(value,key){const iv=crypto.getRandomValues(new Uint8Array(12));const k=await crypto.subtle.importKey('raw',unhex(key),'AES-GCM',false,['encrypt']);return hex(iv)+':'+hex(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(value)));}
export async function unseal(value,key){const [iv,cipher]=value.split(':');const k=await crypto.subtle.importKey('raw',unhex(key),'AES-GCM',false,['decrypt']);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(iv)},k,unhex(cipher)));}
async function connection(env){if(env.BITRIX_WEBHOOK_BASE)return env.BITRIX_WEBHOOK_BASE;const row=await db(env).prepare('SELECT cipher FROM connection_secrets WHERE key=?').bind('bitrix').first();if(!row||!env.CRM_SECRET_KEY)throw new Error('CRM connection not configured');return unseal(row.cipher,env.CRM_SECRET_KEY);}
async function setup(request,env){
  const url=new URL(request.url),email=request.headers.get('oai-authenticated-user-email');
  if(!email)return new Response(null,{status:302,headers:{Location:'/signin-with-chatgpt?return_to=%2Fsetup','Cache-Control':'no-store'}});
  if(!env.SETUP_OWNER_EMAIL||email.toLowerCase()!==env.SETUP_OWNER_EMAIL.toLowerCase())return response({error:'Owner access required'},403);
  let notice='';
  if(request.method==='POST'){
    if(![url.origin,'null'].includes(request.headers.get('Origin')))return response({error:'Invalid setup origin'},403);
    if(Number(request.headers.get('Content-Length')||0)>4096)return response({error:'Invalid setup request'},400);
    const form=await request.formData(),base=String(form.get('webhook')||'').trim();
    try{const token=JSON.parse(await unseal(String(form.get('csrf')||''),env.CRM_SECRET_KEY));if(token.email!==email||token.expires<Date.now())throw new Error();}catch{return response({error:'Setup form expired. Reload before submitting.'},403);}
    if(!/^https:\/\/kirpa\.bitrix24\.com\/rest\/\d+\/[a-zA-Z0-9]+\/?$/.test(base))return response({error:'Enter a Kirpa Bitrix24 webhook URL'},400);
    await bitrix({...env,BITRIX_WEBHOOK_BASE:base},'crm.status.list',{filter:{ENTITY_ID:'SOURCE'}});
    await db(env).prepare('INSERT INTO connection_secrets(key,cipher,updated) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET cipher=excluded.cipher,updated=excluded.updated').bind('bitrix',await seal(base,env.CRM_SECRET_KEY),Date.now()).run();
    notice='Connection verified and saved securely. The key is never returned to the page.';
  }else if(request.method!=='GET')return response({error:'Method not allowed'},405);
  const connected=await db(env).prepare('SELECT updated FROM connection_secrets WHERE key=?').bind('bitrix').first();
  const csrf=await seal(JSON.stringify({email,expires:Date.now()+15*60000}),env.CRM_SECRET_KEY);
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>Kirpa CRM · Private connection setup</title></head><body style="font:16px system-ui;max-width:660px;margin:70px auto;padding:24px"><h1>Private CRM connection</h1><p>Owner-only setup for the existing Kirpa social dashboard. This is not the reporting page.</p><p role="status">${notice|| (connected?'A connection is configured. Only submit to intentionally replace it.':'No CRM key has been stored yet.')}</p><form method="post" action="/setup"><input type="hidden" name="csrf" value="${csrf}"><label for="webhook">Kirpa Bitrix24 webhook URL</label><input id="webhook" name="webhook" type="password" required autocomplete="off" style="display:block;width:100%;padding:12px;margin:15px 0"><button type="submit">Verify and store connection</button></form><p>The key is encrypted before storage. The encryption key is held separately in the backend’s secret environment. No credential is put in GitHub or browser storage.</p></body></html>`,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}
async function limited(env,key,max,ms){const until=Math.ceil(Date.now()/ms)*ms;const row=await db(env).prepare('INSERT INTO auth_attempts (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count').bind(key,until,Date.now(),Date.now()).first();return row.count>max;}
export async function bitrix(env,method,params={}){
  if(!methods.has(method))throw new Error('Read method not allowed');
  const base=new URL(await connection(env));
  if(base.protocol!=='https:'||base.hostname!=='kirpa.bitrix24.com'||!/^\/rest\/\d+\/[a-zA-Z0-9]+\/?$/.test(base.pathname))throw new Error('CRM connection not configured');
  const url=`${base.href.replace(/\/$/,'')}/${method}.json`;
  const rows=[];let start=0;
  for(let page=0;page<400;page++){
    let data;
    for(let attempt=0;attempt<3;attempt++){
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...params,start}),redirect:'error',signal:AbortSignal.timeout(25000)});
      data=await r.json();
      if(r.status===429||data.error==='QUERY_LIMIT_EXCEEDED'){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
      if(!r.ok||data.error||!Array.isArray(data.result))throw new Error('CRM read failed; check connection permissions');
      break;
    }
    if(!Array.isArray(data?.result))throw new Error('CRM rate limit; retry later');
    rows.push(...data.result);
    if(data.next==null)return rows;
    if(!Number.isInteger(data.next)||data.next<=start)throw new Error('Invalid CRM pagination');
    start=data.next;await new Promise(resolve=>setTimeout(resolve,550));
  }
  throw new Error('CRM result exceeds the safe limit; no partial totals published');
}
async function chunks(env,ids,method,field,select){const result=[];for(let i=0;i<ids.length;i+=50)result.push(...await bitrix(env,method,{filter:{[`@${field}`]:ids.slice(i,i+50)},select,order:{ID:'ASC'}}));return result;}
export function sanitize(prepared){return {duplicateImports:prepared.duplicateImports,leads:prepared.leads.map(l=>({ID:l.ID,DATE_CREATE:l.DATE_CREATE,STATUS_ID:l.STATUS_ID,ASSIGNED_BY_ID:l.ASSIGNED_BY_ID,attribution:l.attribution})),deals:prepared.deals.map(d=>({ID:d.ID,LEAD_ID:d.LEAD_ID,canonicalLeadId:d.canonicalLeadId,CLOSEDATE:d.CLOSEDATE,STAGE_SEMANTIC_ID:d.STAGE_SEMANTIC_ID,ASSIGNED_BY_ID:d.ASSIGNED_BY_ID}))};}
async function capture(env,month){
  try{
    const window=M.monthWindow(month),asOf=Date.now();
    const statuses=await bitrix(env,'crm.status.list',{order:{SORT:'ASC'}});
    const sources=Object.fromEntries(statuses.filter(s=>s.ENTITY_ID==='SOURCE').map(s=>[s.STATUS_ID,s.NAME]));
    const leads=await bitrix(env,'crm.lead.list',{filter:{'>=DATE_CREATE':window.start,'<DATE_CREATE':window.end,'<=DATE_CREATE':new Date(asOf).toISOString()},select:leadFields,order:{ID:'ASC'}});
    const cohortDeals=await chunks(env,leads.map(l=>l.ID),'crm.deal.list','LEAD_ID',dealFields);
    const closed=await bitrix(env,'crm.deal.list',{filter:{STAGE_SEMANTIC_ID:'S','>=CLOSEDATE':window.start,'<CLOSEDATE':window.end,'<=CLOSEDATE':new Date(asOf).toISOString()},select:dealFields,order:{ID:'ASC'}});
    const known=new Set(leads.map(l=>String(l.ID)));
    const missing=[...new Set(closed.map(d=>String(d.LEAD_ID)).filter(id=>/^\d+$/.test(id)&&id!=='0'&&!known.has(id)))];
    leads.push(...await chunks(env,missing,'crm.lead.list','ID',leadFields));
    const prepared=M.prepare({leads,deals:[...cohortDeals,...closed],people,sources,config});
    const payload={prepared:sanitize(prepared),people,window,asOf,completed:new Date().toISOString(),config:{qualifiedStages:config.qualifiedStages},definitionsVersion:1};
    await db(env).batch([
      db(env).prepare('INSERT INTO reports(month,payload,captured) VALUES (?,?,?) ON CONFLICT(month) DO UPDATE SET payload=excluded.payload,captured=excluded.captured').bind(month,JSON.stringify(payload),Date.now()),
      db(env).prepare('UPDATE refresh_locks SET status=?,expires=?,error=NULL WHERE month=?').bind('complete',Date.now()+15*60000,month)
    ]);
  }catch{
    await db(env).prepare('UPDATE refresh_locks SET status=?,error=?,expires=? WHERE month=?').bind('failed','CRM refresh could not finish. The last completed report is preserved.',Date.now()+60000,month).run();
  }
}
export async function handle(request,env,ctx){
  const origin=request.headers.get('Origin')||'',allowed=env.ALLOWED_ORIGIN||'https://roshanalii.github.io',url=new URL(request.url);
  if(url.pathname==='/setup')return setup(request,env);
  if(origin&&origin!==allowed)return response({error:'Origin not allowed'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600','Vary':'Origin'}});
  const reply=(body,status=200)=>response(body,status,origin);
  if(url.pathname==='/health')return reply({ok:true});
  if(url.pathname==='/session'&&request.method==='POST'){
    if(!env.CRM_PASSWORD_HASH||!env.CRM_PASSWORD_SALT)return reply({error:'Secure access is not configured'},503);
    const ip=request.headers.get('CF-Connecting-IP')||'unknown';
    const key=await hash(`${env.CRM_PASSWORD_SALT}:${ip}`);
    if(await limited(env,`login:${key}`,6,15*60000)||await limited(env,'login:global',100,60000))return reply({error:'Too many attempts. Please wait 15 minutes.'},429);
    const bodyText=await request.text();if(bodyText.length>1024)return reply({error:'Invalid request'},400);
    let body;try{body=JSON.parse(bodyText);}catch{return reply({error:'Invalid request'},400);}
    if(typeof body.password!=='string'||body.password.length>128||!equal(await passwordHash(body.password,env.CRM_PASSWORD_SALT),env.CRM_PASSWORD_HASH))return reply({error:'Incorrect password'},401);
    const token=hex(crypto.getRandomValues(new Uint8Array(32))),expires=Date.now()+HOUR;
    await db(env).prepare('INSERT INTO sessions(hash,expires) VALUES (?,?)').bind(await hash(token),expires).run();
    ctx.waitUntil(db(env).batch([db(env).prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()),db(env).prepare('DELETE FROM auth_attempts WHERE expires<?').bind(Date.now()-DAY)]));
    return reply({token,expires});
  }
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Sign in to view CRM results'},401);
  const session=await db(env).prepare('SELECT expires FROM sessions WHERE hash=? AND expires>?').bind(await hash(token),Date.now()).first();
  if(!session)return reply({error:'Session expired. Enter the password again.'},401);
  if(await limited(env,`api:${await hash(token)}`,90,60000))return reply({error:'Please wait before requesting more records'},429);
  if(url.pathname==='/sources'&&request.method==='GET')return reply({sources:(await bitrix(env,'crm.status.list',{filter:{ENTITY_ID:'SOURCE'}})).map(s=>({id:s.STATUS_ID,name:s.NAME}))});
  if(url.pathname==='/session'&&request.method==='DELETE'){await db(env).prepare('DELETE FROM sessions WHERE hash=?').bind(await hash(token)).run();return reply({ok:true});}
  if(url.pathname==='/report'&&['GET','POST'].includes(request.method)){
    const month=url.searchParams.get('month')||'';let window;
    try{window=M.monthWindow(month);}catch{return reply({error:'Choose a valid month'},400);}
    if(Date.parse(window.start)>Date.now()||Date.parse(window.start)<Date.now()-2*365*DAY)return reply({error:'Choose a month within the last two years'},400);
    const saved=await db(env).prepare('SELECT payload,captured FROM reports WHERE month=?').bind(month).first();
    let job=await db(env).prepare('SELECT status,expires,error FROM refresh_locks WHERE month=?').bind(month).first();
    const shouldRefresh=request.method==='POST'||!saved||Date.now()-saved.captured>6*HOUR;
    if(shouldRefresh&&(!job||job.expires<Date.now())){
      const lock=await db(env).prepare('INSERT INTO refresh_locks(month,expires,status,error) VALUES (?,?,?,NULL) ON CONFLICT(month) DO UPDATE SET expires=excluded.expires,status=excluded.status,error=NULL WHERE refresh_locks.expires<? RETURNING month').bind(month,Date.now()+10*60000,'running',Date.now()).first();
      if(lock){
        // Keep the request alive while fetching. Worker waitUntil is only a
        // short post-response grace period, not a durable job runner.
        await capture(env,month);
        job=await db(env).prepare('SELECT status,expires,error FROM refresh_locks WHERE month=?').bind(month).first();
        const fresh=await db(env).prepare('SELECT payload,captured FROM reports WHERE month=?').bind(month).first();
        return reply({report:fresh?JSON.parse(fresh.payload):null,refresh:job?.status,error:job?.error||null,stale:fresh?Date.now()-fresh.captured>6*HOUR:true},fresh?200:202);
      }
    }
    return reply({report:saved?JSON.parse(saved.payload):null,refresh:job?.status||'idle',error:job?.error||null,stale:saved?Date.now()-saved.captured>6*HOUR:true},saved?200:202);
  }
  if(url.pathname==='/review'&&request.method==='POST'){
    const id=url.searchParams.get('lead')||'';if(!/^\d+$/.test(id))return reply({error:'Invalid lead ID'},400);
    const lead=(await bitrix(env,'crm.lead.list',{filter:{ID:id},select:leadFields}))[0];if(!lead)return reply({error:'Lead is not readable'},404);
    const comments=await bitrix(env,'crm.timeline.comment.list',{filter:{ENTITY_ID:id,ENTITY_TYPE:'lead'},select:['ID','COMMENT','CREATED'],order:{ID:'ASC'}});
    const result=M.attribute(lead,people,{},config,comments.map(c=>c.COMMENT||'').join('\n'));
    return reply({lead:id,commentsChecked:comments.length,attribution:result,checkedAt:new Date().toISOString(),notice:'Review suggestions only. No CRM fields changed; no customer notes returned.'});
  }
  return reply({error:'Not found'},404);
}
export default {async fetch(request,env,ctx){try{return await handle(request,env,ctx);}catch{return response({error:'CRM service temporarily unavailable. Saved data has not been replaced.'},503,request.headers.get('Origin')===env.ALLOWED_ORIGIN?env.ALLOWED_ORIGIN:'');}}};
