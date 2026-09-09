/* Separate Story surface; never modifies feed totals or scoring inputs. */
(() => {
  'use strict';
  const host=document.getElementById('story-activity');
  if(!host)return;
  let data=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=s=>s?new Date(s.length===10?s+'T00:00:00+04:00':s).toLocaleDateString('en-GB',{timeZone:'Asia/Dubai',day:'numeric',month:'short',year:'numeric'}):'Not started';
  const timestamp=s=>s?new Date(s).toLocaleString('en-GB',{timeZone:'Asia/Dubai',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' Dubai':'Not yet checked';
  function cards(s){
    const count=s.monitoringSince?`${s.total?'≥ ':''}${s.total.toLocaleString()}`:'Not started';
    return `<div class="story-cards"><div><b>${count}</b><span>Stories captured<br>Minimum observed, not a complete total</span></div><div><b>${s.image} / ${s.video}</b><span>Image / video Stories captured</span></div><div><b>${s.activeDays}</b><span>Days with captured Stories</span></div><div><b>${s.fresh} / ${s.accounts.length}</b><span>Profiles checked within 13 hours<br>${s.failedChecks} incomplete checks in period</span></div></div>`;
  }
  function render(){
    if(!data)return;
    const person=host.querySelector('select[data-story-account]'),period=host.querySelector('select[data-story-period]');
    const s=KirpaStoryMetrics.summarize(data,person.value,period.value);
    const output=host.querySelector('[data-story-output]');
    const dates=[...new Set(s.rows.map(r=>r.date))].sort().reverse();
    output.innerHTML=`<p>${esc(date(s.from))}–${esc(date(s.to))} · Dubai calendar dates · monitoring began ${esc(date(s.monitoringSince))}</p>${cards(s)}
      <details><summary>Daily publishing breakdown & collection evidence</summary><div class="story-scroll"><table><thead><tr><th>Date</th><th>Image Stories</th><th>Video Stories</th><th>Captured total</th></tr></thead><tbody>${dates.map(d=>{const rows=s.rows.filter(r=>r.date===d),im=rows.reduce((n,r)=>n+r.image,0),vi=rows.reduce((n,r)=>n+r.video,0);return `<tr><td>${esc(date(d))}</td><td>${im}</td><td>${vi}</td><td>${im+vi}</td></tr>`;}).join('')||'<tr><td colspan="4">No Stories captured in this period. This does not prove that none were published.</td></tr>'}</tbody></table></div>
      <ul>${s.accounts.map(a=>`<li>@${esc(a.handle)} · last successful check: ${esc(timestamp(a.lastSuccessAt))}${a.reason?` · ${esc(a.reason)}`:''}</li>`).join('')}</ul></details>
      <p class="story-note">Story content expires; missed or deleted Stories cannot be reconstructed. This is publishing activity only: no Story views, profile visits or reach. Stories are not added to feed totals or rankings.</p>
      <p class="story-note">${esc(data.budget?.lastStatus||'Awaiting first collection')} · Story allowance: $${Number(data.budget?.reservedOrSpentUsd||0).toFixed(2)} used/reserved of $${Number(data.budget?.limitUsd||0).toFixed(2)} this month. Checks pause at the limit; feed collection is separate.</p>`;
  }
  function mountPerson(){
    if(!data)return;
    for(const node of document.querySelectorAll('[data-story-person]:not([data-story-mounted])')){
      node.dataset.storyMounted='true';
      const s=KirpaStoryMetrics.summarize(data,node.dataset.storyPerson,'month');
      node.innerHTML=`<h3>Story publishing · this month</h3>${cards(s)}<p class="story-note">${esc(date(s.from))}–${esc(date(s.to))} · Dubai. Collection began ${esc(date(s.monitoringSince))}. Captured counts are a minimum; Story views, reach and profile visits are not public. Excluded from momentum scoring.</p>`;
    }
  }
  async function load(){
    try{
      const res=await fetch('data/stories.json',{cache:'no-store'});
      if(!res.ok)throw new Error();
      data=await res.json();
      if(data.version!==1||!Array.isArray(data.accounts)||!Array.isArray(data.daily))throw new Error();
      host.innerHTML=`<div class="story-head"><div><div class="section-label">Public Story activity</div><h3>Publishing beyond the feed</h3><p>Apify observations · no account logins · separate from feed performance</p></div><div class="story-controls"><label>Account<select data-story-account><option value="team">Kirpa team · combined</option>${data.accounts.map(a=>`<option value="${esc(a.handle)}">${esc(a.name)} · @${esc(a.handle)}</option>`).join('')}</select></label><label>Period<select data-story-period><option value="month">This month</option><option value="week">This week</option><option value="30">Last 30 calendar days</option></select></label></div></div><div data-story-output aria-live="polite"></div>`;
      host.addEventListener('change',render);render();mountPerson();
      const target=document.getElementById('analytics-content');
      if(target)new MutationObserver(mountPerson).observe(target,{childList:true,subtree:true});
    }catch(_){host.innerHTML='<h3>Public Story activity</h3><p>Story observations have not loaded. Feed data remains available; no Story totals are assumed.</p>';}
  }
  load();
})();
