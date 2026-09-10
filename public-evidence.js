(() => {
  'use strict';
  const host=document.getElementById('public-evidence');
  if(!host)return;
  const M=KirpaPublicMetrics;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>typeof n==='number'?n.toLocaleString('en-GB'):'Not reported';
  const timestamp=s=>s?new Date(s).toLocaleString('en-GB',{timeZone:'Asia/Dubai',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' Dubai':'Not captured';
  let data,page=0,calendarMonth,calendarTarget='from';
  const field=name=>host.querySelector(`[data-evidence-${name}]`);
  function metric(title,value,detail){return `<div><b>${esc(value)}</b><span>${esc(title)}</span><small>${esc(detail)}</small></div>`;}
  function counter(title,t){return metric(title,(t.reporting<t.expected && t.value!==null?'≥ ':'')+fmt(t.value),`${t.reporting}/${t.expected} posts reporting`);}
  function renderCalendar(){
    const from=field('from').value,to=field('to').value,max=M.date(data.generatedAt);
    field('calendar').innerHTML=`<div class="evidence-calendar-toolbar"><div role="group" aria-label="Date to select">
      <button type="button" data-calendar-target="from" aria-pressed="${calendarTarget==='from'}">From · ${esc(from||'Choose date')}</button>
      <button type="button" data-calendar-target="to" aria-pressed="${calendarTarget==='to'}">To · ${esc(to||'Choose date')}</button></div>
      <div><button type="button" data-calendar-step="-1" aria-label="Previous month">←</button>
      <button type="button" data-calendar-step="1" aria-label="Next month" ${M.calendarMonth(calendarMonth,1).month>=max.slice(0,7)?'disabled':''}>→</button></div></div>
      <p class="evidence-calendar-hint" aria-live="polite">Choose the <strong>${calendarTarget==='from'?'From':'To'}</strong> date below. Both dates are included, in Dubai time. Uses saved data only.</p>
      <div class="evidence-months">${[0,1].map(offset=>{
        const m=M.calendarMonth(calendarMonth,offset);
        return `<div role="group" aria-label="${esc(m.label)}"><h4>${esc(m.label)}</h4><div class="evidence-days">
        ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span aria-hidden="true">${d}</span>`).join('')}
        ${'<span aria-hidden="true"></span>'.repeat(m.padding)}
        ${m.days.map(day=>`<button type="button" data-calendar-day="${day}" aria-label="${day}${day===from?' · From':''}${day===to?' · To':''}" aria-pressed="${day===from||day===to}" class="${day>=from&&day<=to?'in-range':''}" ${day>max||(calendarTarget==='to'&&from&&day<from)?'disabled':''}>${Number(day.slice(-2))}</button>`).join('')}</div></div>`;
      }).join('')}</div>`;
  }
  function render(){
    const from=field('from').value,to=field('to').value;
    renderCalendar();
    if(!from||!to||from>to){field('output').textContent='Choose a start date on or before the end date.';return;}
    if(to>M.date(data.generatedAt)){field('output').textContent='Choose dates on or before the latest saved capture: '+M.date(data.generatedAt)+'.';return;}
    const s=M.summarize(data,field('account').value,from,to,field('basis').value);
    const maxPage=Math.max(0,Math.ceil(s.posts.length/50)-1);page=Math.min(page,maxPage);
    field('output').innerHTML=`<div class="evidence-cards">
      ${metric('Feed posts captured',fmt(s.posts.length),`${s.reels} Reels · ${s.images} images · ${s.carousels} carousels · ${s.videos} videos`)}
      ${counter('Public video plays',s.plays)}${counter('Attention · likes + comments',s.attention)}${counter('Reported shares',s.shares)}</div>
      <p>Published ${esc(from)} to ${esc(to)}, Dubai time. These are accumulated counters on those posts, <strong>not activity earned within the dates</strong>. Stories are shown separately below. ${s.retainedPosts?`${s.retainedPosts} posts are retained from an earlier capture and were not re-observed in the latest collection; they may be outside its window, omitted or removed. Choose “Latest capture only” to exclude them.`:''} ${s.stalePosts?`${s.stalePosts} posts have counters older than 108 hours.`:''}</p>
      <details><summary>Coverage, definitions & collection evidence</summary><p>Reel = Instagram Reel format. Video = a source-labelled video post. A carousel counts as one feed post. Drafts, deleted content and private Insights are not available. No profile visits, unique reach, Story views or saves are estimated.</p>
      <ul>${s.accounts.map(a=>{const c=a.coverage,h=a.historyCoverage;return `<li><strong>@${esc(a.handle)}</strong> · ${c?.complete?'Feed checks passed':'Feed coverage incomplete'} · ${esc(timestamp(a.capturedAt))}<br>${esc(c?.from||'Unknown start')} → ${esc(c?.to||a.capturedAt)}${h?` · 90-day backfill ${h.complete?'checked':'incomplete'}`:' · 90-day backfill not yet verified'}${a.lastHistoryAttempt?` · Latest backfill attempt: ${esc(a.lastHistoryAttempt.reason)}`:''}${a.sharesPilot?` · Shares sample: ${a.sharesPilot.reporting}/${a.sharesPilot.requested} reporting`:''}</li>`;}).join('')}</ul>
      <p>“Checks passed” means the returned feed passed ownership, date, duplicate, preview and safety-limit checks. Public scraping still cannot prove that Instagram exposed every post. Any ≥ total is a confirmed minimum.</p></details>
      ${s.accounts.length===1?comparison(s.accounts[0]):'<p class="evidence-note">Select an individual account to see changes between its captures.</p>'}
      <details open><summary>Every captured post · ${fmt(s.posts.length)} results</summary><div class="evidence-scroll"><table><thead><tr><th>Published · Dubai</th><th>Account / format</th><th>Likes</th><th>Comments</th><th>Plays</th><th>Shares</th><th>Captured · Dubai</th><th>Evidence</th></tr></thead><tbody>
      ${s.posts.slice(page*50,page*50+50).map(p=>`<tr><td>${esc(timestamp(p.postedAt))}</td><td>@${esc(p.handle)}<br>${esc(p.type)}</td><td>${fmt(p.likes)}</td><td>${fmt(p.comments)}</td><td>${['reel','video'].includes(p.type)?fmt(p.videoPlayCount):'Not public'}</td><td>${fmt(p.shares)}${p.sharesObservedAt?`<br><small>${esc(timestamp(p.sharesObservedAt))}</small>`:''}</td><td>${esc(timestamp(p.metricsObservedAt))}</td><td>${M.safeUrl(p.url)?`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open post ↗</a>`:'No verified link'}</td></tr>`).join('')||'<tr><td colspan="8">No posts captured for these dates. Review the coverage above before interpreting this as zero publishing.</td></tr>'}
      </tbody></table></div><div class="evidence-pages"><button type="button" data-evidence-prev ${page===0?'disabled':''}>Previous</button><span>Page ${page+1} of ${maxPage+1}</span><button type="button" data-evidence-next ${page===maxPage?'disabled':''}>Next</button></div></details>`;
  }
  function comparison(a){
    const c=M.compare(a);
    if(!c)return '<p class="evidence-note">Counter changes start with the next comparable capture. Current captured totals remain available above.</p>';
    return `<details><summary>Observed changes between captures</summary><p>${esc(timestamp(c.from))} → ${esc(timestamp(c.to))} · ${c.matched} posts present in both captures. New posts and missing counters are excluded. This is a tracked-post comparison, not total Instagram account activity.</p><div class="evidence-cards">${metric('Follower change',fmt(c.followerChange),'Public profile counts')}${Object.entries(c.fields).map(([k,v])=>metric(({likes:'Like counter change',comments:'Comment counter change',videoPlayCount:'Play counter change'})[k],fmt(v.value),`${v.reporting} matched posts · ${v.decreases} counter decreases`)).join('')}</div><p>Negative changes are kept as reported; they may reflect removed interactions or source corrections.</p></details>`;
  }
  async function load(){
    try{
      const res=await fetch('data/public-evidence.json',{cache:'no-store'});
      if(!res.ok)throw new Error();data=await res.json();
      if(data.version!==1||!Array.isArray(data.accounts))throw new Error();
      const b=M.bounds(data.generatedAt,'month');
      calendarMonth=M.calendarMonth(b.to.slice(0,7),-1).month;
      host.innerHTML=`<div class="evidence-head"><div><div class="section-label">Public performance · evidence explorer</div><h3>Count it. Check it.</h3><p>Exact reported counters, transparent coverage. Feed refresh: every four days.</p></div></div>
      <div class="evidence-controls"><label>Account<select data-evidence-account><option value="team">Kirpa team · owned posts</option>${data.accounts.map(a=>`<option value="${esc(a.handle)}">${esc(a.name)} · @${esc(a.handle)}${a.company?' · company page':''}</option>`).join('')}</select></label>
      <label>Period<select data-evidence-period><option value="month">This calendar month</option><option value="last-month">Last calendar month</option><option value="week">This calendar week</option><option value="90">Last 90 calendar days</option><option value="custom">Custom dates</option></select></label>
      <label>From<input type="date" data-evidence-from value="${b.from}" max="${b.to}"></label><label>To<input type="date" data-evidence-to value="${b.to}" max="${b.to}"></label><label>Evidence basis<select data-evidence-basis><option value="archive">All captured history</option><option value="latest">Latest capture only</option></select></label></div><section class="evidence-calendar" aria-label="Choose a date range"><h4>Choose dates on the calendar</h4><div data-evidence-calendar></div></section><div data-evidence-output aria-live="polite"></div>`;
      host.addEventListener('change',e=>{
        page=0;
        if(e.target===field('period')&&e.target.value!=='custom'){
          const b=M.bounds(data.generatedAt,e.target.value);field('from').value=b.from;field('to').value=b.to;
          calendarMonth=b.from.slice(0,7);calendarTarget='from';
        }else if(e.target.matches('input')){
          field('period').value='custom';
          if(e.target.value)calendarMonth=e.target.value.slice(0,7);
        }
        render();
      });
      host.addEventListener('click',e=>{
        const button=e.target.closest('button');if(!button||button.disabled)return;
        if(button.dataset.calendarTarget){calendarTarget=button.dataset.calendarTarget;renderCalendar();field('calendar').querySelector(`[data-calendar-target="${calendarTarget}"]`).focus();return;}
        if(button.dataset.calendarStep){
          const step=button.dataset.calendarStep;calendarMonth=M.calendarMonth(calendarMonth,Number(step)).month;renderCalendar();
          const control=field('calendar').querySelector(`[data-calendar-step="${step}"]`);
          (control.disabled?field('calendar').querySelector('[data-calendar-step="-1"]'):control).focus();return;
        }
        if(button.dataset.calendarDay){
          const day=button.dataset.calendarDay;
          const range=M.selectCalendarDate({from:field('from').value,to:field('to').value},calendarTarget,day,M.date(data.generatedAt));
          if(!range)return;
          field('from').value=range.from;field('to').value=range.to;field('period').value='custom';
          calendarTarget=calendarTarget==='from'?'to':'from';page=0;render();
          field('calendar').querySelector(`[data-calendar-day="${day}"]`).focus();return;
        }
        if(button.matches('[data-evidence-prev]')){page--;render();}
        if(button.matches('[data-evidence-next]')){page++;render();}
      });
      render();
    }catch(_){host.innerHTML='<h3>Public performance evidence</h3><p>The evidence file could not be loaded. Existing dashboard results remain visible; no replacement totals have been invented.</p>';}
  }
  load();
})();
