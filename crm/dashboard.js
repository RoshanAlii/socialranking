(() => {
  'use strict';
  const root=document.getElementById('crm-results');if(!root)return;
  const M=window.KirpaCRM,A=window.KirpaSecure,$=id=>root.querySelector(`[data-crm="${id}"]`),e=M.escape;
  let snapshot=null,page=0,busy=false;
  root.innerHTML=`<div class="section-label">CRM · Social leads & sales</div><h3>What is our visibility bringing in?</h3><p>Confirmed lead origins and sales outcomes, alongside the social activity that supports them.</p>
    <form data-crm="login" class="crm-controls"><label>CRM access password<input data-crm="password" type="password" autocomplete="current-password" required></label><button type="submit">Unlock CRM results</button></form>
    <div data-crm="controls" class="crm-controls" hidden><label>Calendar month · Dubai<input type="month" data-crm="month"></label><label>Originating account<select data-crm="creator"><option value="">All confirmed accounts</option></select></label><button data-crm="load" type="button">Load month</button><button data-crm="refresh" type="button">Refresh CRM</button><button data-crm="lock" type="button">Lock CRM</button></div>
    <p class="crm-status" data-crm="status" role="status">CRM data is password-protected on the server. No customer records are stored in the public site.</p>
    <div data-crm="body" hidden><p data-crm="period"></p><div class="crm-cards" data-crm="cards"></div>
    <h4>Attribution coverage</h4><div class="crm-cards" data-crm="quality"></div><p class="crm-note" data-crm="coverage"></p>
    <details><summary>Compare accounts · leads and conversion</summary><div class="crm-table" data-crm="ranks"></div></details>
    <h4>Supporting CRM records</h4><div class="crm-controls"><label>Show<select data-crm="kind"><option value="confirmed">Confirmed cohort leads</option><option value="closures">Deals closed this month</option><option value="needs_review">Awaiting attribution review</option><option value="unattributed">Social source · creator unknown</option><option value="unknown">No verified social origin</option></select></label><label>Find record ID<input type="search" data-crm="search" placeholder="Lead or deal ID"></label></div>
    <div class="crm-table" data-crm="records"></div><div class="crm-controls"><button data-crm="prev">Previous</button><span data-crm="pages"></span><button data-crm="next">Next</button></div><p data-crm="review" role="status"></p>
    <details><summary>Definitions, evidence and limitations</summary><p><b>Confirmed leads:</b> unique leads created in the selected Dubai calendar month with an evidenced originating account. Assignment alone is never origin evidence.</p><p><b>Lead-to-sale conversion:</b> unique confirmed leads from that cohort linked to at least one currently won deal, divided by the same cohort’s lead count. Multiple deals do not multiply converted leads.</p><p><b>Deals closed this month:</b> currently won deals with a CRM closing date in this month, including deals whose leads were created earlier. This is not independently verified payment or contract completion.</p><p><b>Coverage:</b> incomplete sources are shown separately and excluded from confirmed-account totals. Check notes for potential matches, then verify and correct the source in Bitrix24. This dashboard never edits CRM records. Notes are not automatically scanned across the whole CRM.</p><p><b>Privacy:</b> this shared password grants the same report access to every holder. Customer names, contact details, deal values and note text are not returned. Record links still require Bitrix24 access.</p><p><b>History:</b> past months show lead cohorts evaluated with current CRM states, not frozen historical outcomes. Deleted or inaccessible records and missing lead-to-deal links cannot be reconstructed. Conversations and attended meetings are not inferred from completed tasks.</p></details></div>`;
  const fmt=n=>n==null?'Not measured':Number(n).toLocaleString('en-GB');
  const rate=(n,d)=>d?`${(n/d*100).toFixed(1)}%`:'No cohort leads';
  const card=(label,value,detail)=>`<div class="crm-card">${e(label)}<strong>${e(value)}</strong><small>${e(detail)}</small></div>`;
  function lock(){snapshot=null;$('body').hidden=true;$('body').querySelectorAll('[data-crm="records"],[data-crm="cards"],[data-crm="quality"],[data-crm="ranks"]').forEach(n=>n.replaceChildren());$('review').textContent='';$('login').hidden=false;$('controls').hidden=true;$('status').textContent='Enter the access password to view CRM results.';}
  async function load(force=false){
    if(busy||!A.isAuthenticated())return;busy=true;$('load').disabled=$('refresh').disabled=true;
    $('status').textContent='Reading the CRM and checking complete lead-to-deal links. Large months can take a few minutes…';
    try{
      const data=await A.request('/report?month='+encodeURIComponent($('month').value),{method:force?'POST':'GET'});
      if(!A.isAuthenticated())return;
      if(data.report){
        const previous=$('creator').value;snapshot=data.report;page=0;
        $('creator').innerHTML='<option value="">All confirmed accounts</option>'+snapshot.people.map(p=>`<option value="${e(p.handle)}">${e(p.name)} · @${e(p.handle)}</option>`).join('');
        if(snapshot.people.some(p=>p.handle===previous))$('creator').value=previous;
        $('body').hidden=false;render();
      }
      $('status').textContent=data.error||(data.refresh==='running'?'Another CRM refresh is in progress. Load the month again shortly.':data.report?`Completed CRM read · ${new Date(data.report.completed).toLocaleString('en-GB',{timeZone:'Asia/Dubai'})} Dubai. ${data.stale?'Showing the last completed report.':'Cached securely for up to six hours.'}`:'No completed report yet. Try loading this month again.');
    }catch(err){$('status').textContent=err.message+(snapshot?' The last completed report remains visible.':'');}
    finally{busy=false;$('load').disabled=$('refresh').disabled=false;}
  }
  function render(){
    if(!snapshot)return;const s=snapshot,who=$('creator').value,q=M.summarize(s.prepared,s.window,who,s.asOf,s.config);
    $('period').textContent=`${s.window.month} · 1st through last calendar day, Asia/Dubai. Outcomes as observed at the displayed CRM capture time.`;
    $('cards').innerHTML=card('Confirmed leads generated',fmt(q.leads),'Created in this calendar month')+card('Leads with a won deal',fmt(q.converted),'Unique leads from this same cohort')+card('Lead-to-sale conversion',rate(q.converted,q.leads),`${q.converted} ÷ ${q.leads} cohort leads`)+card('Closed-won deals',fmt(q.closedDeals),'CRM closing date in this month · any lead age')+card('Open linked deals',fmt(q.openDeals),'Current pipeline for this cohort');
    $('quality').innerHTML=card('Awaiting review',fmt(q.review),'Possible social origin; excluded from confirmed totals')+(!who?card('Social source · creator unknown',fmt(q.unattributed),'Source needs an originating account')+card('No verified social origin',fmt(q.unknown),'Other sources and unresolved records'):'');
    $('coverage').textContent=`${s.prepared.duplicateImports} repeated integration imports deduplicated. ${q.unlinkedClosures} readable closed deals have no readable lead link. Figures cover records available to the dedicated CRM connection, not all Instagram enquiries.`;
    const ranks=s.people.map(p=>({...p,q:M.summarize(s.prepared,s.window,p.handle,s.asOf,s.config)})).sort((a,b)=>b.q.leads-a.q.leads||a.name.localeCompare(b.name));let last=-1,rank=0;
    $('ranks').innerHTML='<table><thead><tr><th>Rank · confirmed leads</th><th>Account</th><th>Leads</th><th>Conversion</th><th>Closed deals</th></tr></thead><tbody>'+ranks.map((p,i)=>{if(p.q.leads!==last){rank=i+1;last=p.q.leads;}return `<tr><td>${p.q.leads?rank:'—'}</td><td><button data-select-creator="${e(p.handle)}">${e(p.name)}</button>${p.company?' · Company':''}</td><td>${p.q.leads}</td><td>${e(rate(p.q.converted,p.q.leads))} · ${p.q.converted}/${p.q.leads}</td><td>${p.q.closedDeals}</td></tr>`;}).join('')+'</tbody></table>';
    const kind=$('kind').value,isDeal=kind==='closures',search=$('search').value.trim();
    let rows=isDeal?q.closures:q.cohort.filter(l=>l.attribution.status===kind&&(!who||l.attribution.creator===who||l.attribution.candidates.includes(who)));
    rows=rows.filter(r=>!search||String(r.ID).includes(search)).sort((a,b)=>Number(b.ID)-Number(a.ID));page=Math.max(0,Math.min(page,Math.ceil(rows.length/25)-1));
    $('records').innerHTML='<table><thead><tr><th>Record</th><th>Date · Dubai</th><th>Originating account / evidence</th><th>Current responsible</th><th>Check</th></tr></thead><tbody>'+rows.slice(page*25,page*25+25).map(r=>{
      const lead=isDeal?s.prepared.leads.find(l=>String(l.ID)===r.canonicalLeadId):r,a=lead?.attribution;
      const assigned=/^\d+$/.test(String(r.ASSIGNED_BY_ID))?String(r.ASSIGNED_BY_ID):'';
      return `<tr><td><a href="https://kirpa.bitrix24.com/crm/${isDeal?'deal':'lead'}/details/${e(r.ID)}/" target="_blank" rel="noopener noreferrer">${isDeal?'Deal':'Lead'} #${e(r.ID)}</a></td><td>${e(new Date(isDeal?r.CLOSEDATE:r.DATE_CREATE).toLocaleDateString('en-GB',{timeZone:'Asia/Dubai'}))}</td><td>${a?.creator?'@'+e(a.creator):'Origin not confirmed'}<br>${e(a?.evidence)}${a?.candidates?.length?'<br>Possible: '+a.candidates.map(e).join(', '):''}</td><td>${assigned?`<a href="https://kirpa.bitrix24.com/company/personal/user/${assigned}/" target="_blank" rel="noopener noreferrer">CRM user #${assigned}</a>`:'Not recorded'}</td><td>${lead?`<button data-review-lead="${e(lead.ID)}">Check notes</button>`:''}</td></tr>`;
    }).join('')+(rows.length?'':'<tr><td colspan="5">No matching records in this completed CRM report.</td></tr>')+'</tbody></table>';
    $('pages').textContent=rows.length?`${page*25+1}–${Math.min(page*25+25,rows.length)} of ${rows.length}`:'0 records';$('prev').disabled=page===0;$('next').disabled=(page+1)*25>=rows.length;
  }
  $('login').addEventListener('submit',async event=>{event.preventDefault();const b=$('login').querySelector('button');b.disabled=true;try{await A.login($('password').value);$('password').value='';}catch(err){$('status').textContent=err.message;}finally{b.disabled=false;}});
  $('month').value=new Date(Date.now()+4*3600000).toISOString().slice(0,7);
  $('load').onclick=()=>load();$('refresh').onclick=()=>load(true);$('lock').onclick=()=>A.logout().catch(()=>{});
  ['creator','kind','search'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{page=0;render();}));
  $('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
  root.addEventListener('click',async ev=>{const b=ev.target.closest('button');if(b?.dataset.selectCreator){$('creator').value=b.dataset.selectCreator;page=0;render();}if(b?.dataset.reviewLead){b.disabled=true;try{const r=await A.request('/review?lead='+encodeURIComponent(b.dataset.reviewLead),{method:'POST'});$('review').textContent=`Lead #${r.lead}: ${r.commentsChecked} comments checked. ${r.attribution.evidence}. ${r.attribution.candidates.length?'Possible account(s): '+r.attribution.candidates.join(', ')+'. ':''}Verify the original enquiry and correct its source in Bitrix24. No records changed.`;}catch(err){$('review').textContent=err.message;}finally{b.disabled=false;}}});
  function unlock(){$('login').hidden=true;$('controls').hidden=false;load();}
  window.addEventListener('kirpa-crm-unlocked',unlock);window.addEventListener('kirpa-crm-locked',lock);
  if(A.isAuthenticated())unlock();else lock();
})();
