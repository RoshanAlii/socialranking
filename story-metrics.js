(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KirpaStoryMetrics=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  const day=at=>new Date(Date.parse(at)+4*3600000).toISOString().slice(0,10);
  function periodStart(at,period){
    const local=new Date(Date.parse(at)+4*3600000);
    if(period==='month')return `${day(at).slice(0,7)}-01`;
    if(period==='week')local.setUTCDate(local.getUTCDate()-((local.getUTCDay()+6)%7));
    else local.setUTCDate(local.getUTCDate()-29);
    return local.toISOString().slice(0,10);
  }
  function summarize(data,handle,period='month',wallNow=Date.now()){
    if(!data?.generatedAt)return null;
    const now=data.generatedAt,from=periodStart(now,period),to=day(now);
    const accounts=(data.accounts||[]).filter(a=>handle==='team'?!a.company:a.handle===handle);
    const wanted=new Set(accounts.map(a=>a.handle));
    const rows=(data.daily||[]).filter(r=>wanted.has(r.handle)&&r.date>=from&&r.date<=to);
    const counts=rows.reduce((s,r)=>({image:s.image+r.image,video:s.video+r.video}),{image:0,video:0});
    const checks=(data.checks||[]).filter(c=>day(c.at)>=from&&day(c.at)<=to);
    const fresh=accounts.filter(a=>a.status==='checked'&&a.lastSuccessAt&&wallNow-Date.parse(a.lastSuccessAt)>=0&&wallNow-Date.parse(a.lastSuccessAt)<=13*3600000).length;
    const started=accounts.map(a=>a.monitoringSince).filter(Boolean).sort();
    return {...counts,total:counts.image+counts.video,activeDays:new Set(rows.map(r=>r.date)).size,
      from,to,rows,accounts,fresh,monitoringSince:started[0]||null,
      failedChecks:checks.filter(c=>(c.failed||[]).some(h=>wanted.has(h))).length};
  }
  return {day,periodStart,summarize};
});
