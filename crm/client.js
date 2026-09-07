(function () {
  'use strict';
  const M = window.KirpaCRM, $ = id => document.getElementById(id), esc = M.escape;
  const methods = new Set(['crm.lead.list','crm.deal.list','crm.status.list','crm.timeline.comment.list']);
  let config, people = [], snapshot = null, page = 0, busy = false;
  const notes = {};
  const leadFields = ['ID','DATE_CREATE','DATE_MODIFY','SOURCE_ID','SOURCE_DESCRIPTION','COMMENTS','ORIGINATOR_ID','ORIGIN_ID','ASSIGNED_BY_ID','STATUS_ID','UF_CRM_1755148569691','UF_CRM_1755515975693'];
  const dealFields = ['ID','LEAD_ID','DATE_CREATE','DATE_MODIFY','CLOSEDATE','STAGE_ID','STAGE_SEMANTIC_ID','ASSIGNED_BY_ID'];
  const fmt = n => n == null ? 'Not measured' : Number(n).toLocaleString('en-GB');
  const rate = (n,d) => d ? `${(n/d*100).toFixed(1)}%` : 'No cohort leads';
  function list(method, params) {
    if (!methods.has(method)) return Promise.reject(new Error('This view only permits approved read methods.'));
    return new Promise((resolve,reject) => {
      const rows = []; let finished = false;
      const timer = setTimeout(() => {finished = true;reject(new Error('CRM read timed out. Last completed results remain visible.'));},120000);
      const done = (error,result) => {if(finished)return;finished=true;clearTimeout(timer);error ? reject(error) : resolve(result);};
      window.BX24.callMethod(method,params,result => {
        if (finished) return;
        if (result.error()) return done(new Error(`Could not complete ${method}. Check CRM permissions and retry.`));
        const batch = result.data();
        if (!Array.isArray(batch)) return done(new Error('Unexpected CRM response. No partial totals published.'));
        rows.push(...batch);
        if(rows.length > 20000) return done(new Error('More than 20,000 records. Narrow the reporting window; partial totals are withheld.'));
        if(result.more()) setTimeout(() => {if(!finished)result.next();},550);
        else done(null,rows);
      });
    });
  }
  async function chunks(values, method, field, select) {
    const rows = [];
    for(let i=0;i<values.length;i+=50) rows.push(...await list(method,{filter:{[`@${field}`]:values.slice(i,i+50)},select,order:{ID:'ASC'}}));
    return rows;
  }
  async function refresh() {
    if(busy)return;
    busy=true;$('refresh').disabled=true;
    try {
      const window = M.monthWindow($('month').value), started = Date.now();
      $('status').textContent='Reading CRM sources, cohort leads and linked deals…';
      const statuses = await list('crm.status.list',{order:{SORT:'ASC'}});
      const sources = Object.fromEntries(statuses.filter(s=>s.ENTITY_ID==='SOURCE').map(s=>[s.STATUS_ID,s.NAME]));
      const leads = await list('crm.lead.list',{filter:{'>=DATE_CREATE':window.start,'<DATE_CREATE':window.end,'<=DATE_CREATE':new Date(started).toISOString()},select:leadFields,order:{ID:'ASC'}});
      const cohortDeals = await chunks(leads.map(l=>l.ID),'crm.deal.list','LEAD_ID',dealFields);
      const closed = await list('crm.deal.list',{filter:{STAGE_SEMANTIC_ID:'S','>=CLOSEDATE':window.start,'<CLOSEDATE':window.end,'<=CLOSEDATE':new Date(started).toISOString()},select:dealFields,order:{ID:'ASC'}});
      const ids = new Set(leads.map(l=>String(l.ID)));
      const missing = [...new Set(closed.map(d=>String(d.LEAD_ID)).filter(id=>/^\d+$/.test(id)&&id!=='0'&&!ids.has(id)))];
      leads.push(...await chunks(missing,'crm.lead.list','ID',leadFields));
      const prepared = M.prepare({leads,deals:[...cohortDeals,...closed],people,sources,config,comments:notes});
      // Replace atomically: any failed page or deal lookup leaves the last
      // complete in-memory report and its original period untouched.
      snapshot={prepared,leads,deals:[...cohortDeals,...closed],sources,statuses,window,asOf:started,completed:new Date()};page=0;
      $('report').hidden=false;render();
      $('status').textContent=`Complete read · ${snapshot.completed.toLocaleString('en-GB',{timeZone:'Asia/Dubai'})} Dubai. Current-user CRM visibility only.`;
    } catch(error) {
      $('status').textContent=error.message+(snapshot ? ` Showing last completed ${snapshot.window.month} results.` : ' No report has been published.');
    } finally {busy=false;$('refresh').disabled=false;}
  }
  const card = (label,value,detail) => `<div class="card">${esc(label)}<strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
  function render() {
    if(!snapshot)return;
    const s=snapshot, creator=$('creator').value, q=M.summarize(s.prepared,s.window,creator,s.asOf,config);
    $('period').textContent=`${s.window.month} · Dubai calendar month · outcomes observed at ${s.completed.toLocaleString('en-GB',{timeZone:'Asia/Dubai'})}.`;
    $('metrics').innerHTML=card('Confirmed leads generated',fmt(q.leads),'Created in the selected month')+card('Leads resulting in a won deal',fmt(q.converted),'Unique leads from that same cohort')+card('Lead-to-sale conversion',rate(q.converted,q.leads),`${q.converted} converted ÷ ${q.leads} cohort leads`)+card('Closed-won deals',fmt(q.closedDeals),'CRM closing date in selected month; any lead age')+card('Open linked deals',fmt(q.openDeals),'Current pipeline for this cohort')+(q.qualified==null?'':card('Currently qualified leads',fmt(q.qualified),'Approved current lead-stage mapping'));
    $('quality').innerHTML=card('Awaiting review',fmt(q.review),'Excluded from confirmed results')+(!creator?card('Social source · creator unknown',fmt(q.unattributed),'Not assigned to an agent by guesswork')+card('No verified social origin',fmt(q.unknown),'Other sources and unresolved records'):'');
    $('coverage').textContent=`${s.prepared.duplicateImports} verified repeat imports deduplicated. ${q.unlinkedClosures} readable won deals in this month have no readable lead link; they cannot be attributed through a lead. CRM notes are checked on demand, not exhaustively scanned.`;
    let lastCount=null,rank=0;
    const ranks=people.map(p=>({...p,m:M.summarize(s.prepared,s.window,p.handle,s.asOf,config)})).sort((a,b)=>b.m.leads-a.m.leads||a.name.localeCompare(b.name));
    $('ranking').innerHTML=`<table><thead><tr><th>Rank</th><th>Originating account</th><th>Confirmed leads</th><th>Lead-to-sale</th><th>Closed deals</th></tr></thead><tbody>${ranks.map((p,i)=>{if(p.m.leads!==lastCount){rank=i+1;lastCount=p.m.leads;}return `<tr><td>${p.m.leads?rank:'—'}</td><td><button data-creator="${esc(p.handle)}">${esc(p.name)}</button><br>@${esc(p.handle)}${p.company?' · Company account':''}</td><td>${p.m.leads}</td><td>${esc(rate(p.m.converted,p.m.leads))} · ${p.m.converted}/${p.m.leads}</td><td>${p.m.closedDeals}</td></tr>`;}).join('')}</tbody></table>`;
    renderRecords(q);
  }
  function renderRecords(q) {
    const kind=$('record-kind').value,creator=$('creator').value,search=$('search').value.trim();
    let rows=kind==='closures'?q.closures:q.cohort.filter(l=>{
      const a=l.attribution,status=kind==='review'?'needs_review':kind;
      return a.status===status&&(!creator||a.creator===creator||a.candidates.includes(creator));
    });
    rows=rows.filter(r=>!search||String(r.ID).includes(search)).sort((a,b)=>Number(b.ID)-Number(a.ID));
    page=Math.max(0,Math.min(page,Math.ceil(rows.length/50)-1));
    const visible=rows.slice(page*50,page*50+50),deal=kind==='closures';
    $('records').innerHTML=`<table><thead><tr><th>CRM record</th><th>${deal?'Closing date':'Created · Dubai'}</th><th>Origin evidence</th><th>Current responsible</th><th>Review</th></tr></thead><tbody>${visible.map(r=>{
      const lead=deal?snapshot.prepared.leads.find(l=>String(l.ID)===r.canonicalLeadId):r,a=lead?.attribution;
      return `<tr><td><a href="https://kirpa.bitrix24.com/crm/${deal?'deal':'lead'}/details/${esc(r.ID)}/" target="_blank" rel="noopener noreferrer">${deal?'Deal':'Lead'} #${esc(r.ID)}</a></td><td>${esc(new Date(deal?r.CLOSEDATE:r.DATE_CREATE).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}))}</td><td>${a?.creator?'@'+esc(a.creator):'Not confirmed'}<br>${esc(a?.evidence)}${a?.candidates.length?'<br>Possible: '+a.candidates.map(esc).join(', '):''}</td><td><a href="https://kirpa.bitrix24.com/company/personal/user/${/^\d+$/.test(String(r.ASSIGNED_BY_ID))?r.ASSIGNED_BY_ID:'0'}/" target="_blank" rel="noopener noreferrer">User #${esc(r.ASSIGNED_BY_ID)}</a></td><td>${lead?`<button data-notes="${esc(lead.ID)}">Check CRM notes</button>`:''}</td></tr>`;
    }).join('')||'<tr><td colspan="5">No matching records in this completed CRM read.</td></tr>'}</tbody></table>`;
    $('pagination').textContent=rows.length?`${page*50+1}–${Math.min(page*50+50,rows.length)} of ${rows.length}`:'0 records';
    $('previous').disabled=page===0;$('next').disabled=(page+1)*50>=rows.length;
  }
  async function checkNotes(id,button) {
    if(busy)return;button.disabled=true;
    const current=snapshot;
    try {
      const comments=await list('crm.timeline.comment.list',{filter:{ENTITY_ID:id,ENTITY_TYPE:'lead'},select:['ID','COMMENT','CREATED'],order:{ID:'ASC'}});
      if(current!==snapshot)return;
      notes[id]=comments.map(c=>c.COMMENT||'').join('\n');
      snapshot.prepared=M.prepare({leads:snapshot.leads,deals:snapshot.deals,people,sources:snapshot.sources,config,comments:notes});
      $('review-notice').textContent=`Lead #${id} · ${comments.length} timeline comments checked. Notes can contain customer information; they are kept only in this session.\n${notes[id]||'No timeline comments returned.'}\nVerify against the original enquiry before correcting Source detail in Bitrix24. No CRM fields were changed.`;
      render();
    } catch(error){$('review-notice').textContent=error.message;} finally{button.disabled=false;}
  }
  $('refresh').addEventListener('click',refresh);
  ['creator','record-kind','search'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{page=0;render();}));
  $('previous').addEventListener('click',()=>{page--;render();});$('next').addEventListener('click',()=>{page++;render();});
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.creator){$('creator').value=b.dataset.creator;page=0;render();}if(b?.dataset.notes)checkNotes(b.dataset.notes,b);});
  async function init() {
    const values=await Promise.all(['config.json','roster.json'].map(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('Application package is incomplete.');return r.json();}));
    [config]=values;people=M.roster(values[1]);
    for(const p of people){const o=document.createElement('option');o.value=p.handle;o.textContent=`${p.name} · @${p.handle}`;$('creator').append(o);}
    $('month').value=new Date(Date.now()+4*3600000).toISOString().slice(0,7);
    if(window.parent===window) return;
    const sdk=document.createElement('script');sdk.src='https://api.bitrix24.com/api/v1/';
    sdk.onerror=()=>{$('status').textContent='Bitrix24 connection could not load. Reopen this application from Kirpa Bitrix24.';};
    sdk.onload=()=>{
      window.BX24.init(()=>{
        const auth=window.BX24.getAuth();
        if(auth?.domain!==config.portal){$('status').textContent='This application is restricted to Kirpa Bitrix24.';return;}
        $('refresh').disabled=false;$('status').textContent='Bitrix24 session connected. Choose a month and load its CRM results.';
      });
    };
    document.head.append(sdk);
  }
  init().catch(()=>{$('status').textContent='Application configuration could not load. No CRM totals are shown.';});
})();
