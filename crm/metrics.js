(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KirpaCRM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const text = value => String(value ?? '').trim();
  const norm = value => text(value).toLowerCase();
  const handle = value => norm(value).replace(/^@/, '');
  const social = value => /\b(instagram|personal social|social media|instagram lead summary)\b/i.test(text(value));
  const escape = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function roster(registry) {
    return [
      ...(registry.employees || []).filter(p => p.confirmed && !p.optOut && p.handles?.instagram).map(p => ({name:p.name, handle:handle(p.handles.instagram), company:false})),
      ...(registry.brandAccounts || []).filter(p => p.confirmed && p.platform === 'instagram').map(p => ({name:p.name, handle:handle(p.handle), company:true}))
    ];
  }
  function mentioned(value, people) {
    const tokens = norm(value).match(/[a-z0-9_]+(?:\.[a-z0-9_]+)*/g) || [];
    return people.filter(p => tokens.includes(p.handle)).map(p => p.handle);
  }
  function attribute(lead, people, sources = {}, config = {}, notes = '') {
    const origin = config.originators?.[text(lead.ORIGINATOR_ID)];
    const mapped = config.sources?.[text(lead.SOURCE_ID)];
    const explicit = [origin, mapped].filter(v => people.some(p => p.handle === v));
    const detail = text(lead.SOURCE_DESCRIPTION);
    const source = text(sources[lead.SOURCE_ID]);
    // Only a standalone origin declaration is accepted automatically. Longer
    // prose, timeline comments, assignments and names are review evidence only.
    const declaration = detail.match(/^Instagram\s+@([a-z0-9_.]+)$/i);
    if (declaration && people.some(p => p.handle === handle(declaration[1]))) explicit.push(handle(declaration[1]));
    const confirmed = [...new Set(explicit)];
    if (confirmed.length === 1) return {status:'confirmed', creator:confirmed[0], candidates:[], evidence:origin ? 'Known capture integration' : mapped ? 'Approved source mapping' : 'Exact source declaration', social:true};
    if (confirmed.length > 1) return {status:'needs_review', creator:null, candidates:confirmed, evidence:'Conflicting structured sources', social:true};
    const prose = [source,detail,lead.COMMENTS,lead.UF_CRM_1755148569691,lead.UF_CRM_1755515975693,notes].join(' ');
    const candidates = social(prose) ? mentioned(prose, people) : [];
    if (candidates.length) return {status:'needs_review', creator:null, candidates, evidence:'Social context and creator handle; human review required', social:true};
    if (social(source) || social(detail)) return {status:'unattributed', creator:null, candidates:[], evidence:'Social source recorded; creator not established', social:true};
    if (social(prose)) return {status:'needs_review', creator:null, candidates:[], evidence:'Social reference in CRM notes; origin not established', social:true};
    return {status:'unknown', creator:null, candidates:[], evidence:'No verified social origin', social:false};
  }
  function monthWindow(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Choose a valid calendar month.');
    const [year, month] = value.split('-').map(Number);
    const next = new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);
    return {start:`${value}-01T00:00:00+04:00`,end:`${next}-01T00:00:00+04:00`,month:value};
  }
  function inWindow(value, window, asOf = Infinity) {
    const time = Date.parse(value);
    return Number.isFinite(time) && time >= Date.parse(window.start) && time < Date.parse(window.end) && time <= asOf;
  }
  function unique(items) {
    const map = new Map();
    for (const item of items) {
      const id = text(item.ID);
      if (!/^\d+$/.test(id)) throw new Error('CRM returned a record without a valid ID.');
      const old = map.get(id);
      if (!old || (Date.parse(item.DATE_MODIFY) || 0) >= (Date.parse(old.DATE_MODIFY) || 0)) map.set(id,item);
    }
    return [...map.values()];
  }
  function prepare({leads, deals, people, sources, config, comments = {}}) {
    const aliases = new Map(), canonical = new Map(), origins = new Map();
    // A verified integration's immutable origin ID can identify duplicate imports.
    // Otherwise preserve distinct lead IDs; same names/assignees are never merged.
    for (const lead of unique(leads).sort((a,b) => Number(a.ID)-Number(b.ID))) {
      const key = config.originators?.[lead.ORIGINATOR_ID] && lead.ORIGIN_ID ? `${lead.ORIGINATOR_ID}:${lead.ORIGIN_ID}` : `lead:${lead.ID}`;
      const id = origins.get(key) || text(lead.ID);
      origins.set(key,id); aliases.set(text(lead.ID),id);
      if (!canonical.has(id)) canonical.set(id,{...lead,attribution:attribute(lead,people,sources,config,comments[lead.ID])});
    }
    return {leads:[...canonical.values()],deals:unique(deals).map(d => ({...d,canonicalLeadId:aliases.get(text(d.LEAD_ID)) || null})),duplicateImports:aliases.size-canonical.size};
  }
  function summarize(prepared, window, creator = '', asOf = Date.now(), config = {}) {
    const matches = lead => !creator || lead.attribution.creator === creator;
    const eligible = lead => lead.attribution.status === 'confirmed' && matches(lead);
    const cohort = prepared.leads.filter(l => inWindow(l.DATE_CREATE,window,asOf));
    const confirmed = cohort.filter(eligible);
    const ids = new Set(confirmed.map(l => text(l.ID)));
    const allEligible = new Set(prepared.leads.filter(eligible).map(l => text(l.ID)));
    const won = prepared.deals.filter(d => d.STAGE_SEMANTIC_ID === 'S' && Date.parse(d.CLOSEDATE) <= asOf);
    const linked = won.filter(d => ids.has(d.canonicalLeadId));
    const converted = new Set(linked.map(d => d.canonicalLeadId));
    const closures = won.filter(d => allEligible.has(d.canonicalLeadId) && inWindow(d.CLOSEDATE,window,asOf));
    const open = prepared.deals.filter(d => d.STAGE_SEMANTIC_ID === 'P' && ids.has(d.canonicalLeadId));
    const qualifiedIds = new Set(config.qualifiedStages || []);
    return {
      leads:confirmed.length, converted:converted.size, conversion:confirmed.length ? converted.size/confirmed.length : null,
      qualified:qualifiedIds.size ? confirmed.filter(l => qualifiedIds.has(text(l.STATUS_ID))).length : null,
      openDeals:open.length, closedDeals:closures.length,
      review:cohort.filter(l => l.attribution.status === 'needs_review' && (!creator || l.attribution.candidates.includes(creator))).length,
      unattributed:creator ? null : cohort.filter(l => l.attribution.status === 'unattributed').length,
      unknown:creator ? null : cohort.filter(l => l.attribution.status === 'unknown').length,
      coverage:cohort.length ? cohort.filter(l=>l.attribution.status==='confirmed').length/cohort.length : null,
      cohort, confirmed, closures, linked, open,
      unlinkedClosures:won.filter(d => !d.canonicalLeadId && inWindow(d.CLOSEDATE,window,asOf)).length
    };
  }
  return {escape,roster,mentioned,attribute,monthWindow,inWindow,unique,prepare,summarize};
});
