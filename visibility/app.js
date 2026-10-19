(() => {
  "use strict";

  const DATA = window.VISIBILITY_DATA;
  const root = document.getElementById("viewRoot");
  const navList = document.getElementById("navList");
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menuToggle");
  const dateRange = document.getElementById("dateRange");
  const opportunityCount = document.getElementById("opportunityCount");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalEyebrow = document.getElementById("modalEyebrow");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");
  const toastRegion = document.getElementById("toastRegion");

  const validViews = new Set([
    "overview", "opportunities", "search", "social", "agents", "projects",
    "competitors", "revenue", "reputation", "health", "integrations"
  ]);

  const state = {
    view: validViews.has(location.hash.slice(1)) ? location.hash.slice(1) : "overview",
    range: Number(localStorage.getItem("visibility-range") || 30),
    opportunityOverrides: loadJson("visibility-opportunities", {}),
    opportunityFilters: { priority: "All", status: "All", type: "All", sort: "Priority", query: "" }
  };

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function deltaMarkup(delta, direction) {
    const sign = delta > 0 ? "+" : "";
    const tone = direction === "down" ? "negative" : direction === "up" ? "positive" : "neutral";
    return `<span class="delta ${tone}">${direction === "down" ? "↓" : direction === "up" ? "↑" : "→"} ${sign}${escapeHtml(delta)}%</span>`;
  }

  function badge(label, tone = "neutral") {
    const slug = String(tone).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `<span class="badge badge-${slug}">${escapeHtml(label)}</span>`;
  }

  function sourceBadge(status) {
    const statusKey = String(status).toLowerCase();
    let tone = "sample";
    if (statusKey.includes("verified") || statusKey.includes("connected") || statusKey.includes("live")) tone = "verified";
    else if (statusKey.includes("derived")) tone = "derived";
    else if (statusKey.includes("public")) tone = "public";
    else if (statusKey.includes("model")) tone = "modelled";
    return badge(status, tone);
  }

  function progress(value, label = "") {
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="progress" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${safeValue}"><span style="width:${safeValue}%"></span></div>`;
  }

  function coverageMarkup(value, label) {
    return value == null ? `<span class="unknown-value">Unknown</span>` : `<div class="metric-with-bar"><span>${value}%</span>${progress(value, label)}</div>`;
  }

  function renderPageHeader({ eyebrow, title, description, actions = "" }) {
    return `<section class="page-heading">
      <div>
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ""}
    </section>`;
  }

  function prototypeBanner(extra = "") {
    return `<div class="prototype-banner">
      <div class="prototype-icon">i</div>
      <div><strong>Prototype data boundary</strong><span>The Social Ranking module is live. Search, CRM, revenue, competitor and reputation values are sample data until their sources are connected.${extra ? ` ${escapeHtml(extra)}` : ""}</span></div>
      ${sourceBadge("1 live source")}
    </div>`;
  }

  function scoreCard(score) {
    return `<article class="score-card" tabindex="0" data-definition="${escapeHtml(score.definition)}">
      <div class="score-card-top"><span>${escapeHtml(score.label)}</span>${sourceBadge(score.status)}</div>
      <div class="score-value-row"><strong>${escapeHtml(score.value)}</strong><span>/100</span>${deltaMarkup(score.delta, score.direction)}</div>
      ${progress(score.value, score.label)}
      <p>${escapeHtml(score.definition)}</p>
    </article>`;
  }

  function overviewView() {
    const openOpps = getOpportunities().filter((item) => item.status !== "Completed" && item.status !== "Dismissed").slice(0, 4);
    return `${renderPageHeader({
      eyebrow: "Executive command centre",
      title: "What changed, why it matters, what to do next.",
      description: "A visibility-to-revenue cockpit for the company, agent network, projects and commercial outcomes.",
      actions: `<button class="secondary-button" data-action="open-view" data-target="health" type="button">Review data health</button><button class="primary-button" data-action="open-view" data-target="opportunities" type="button">Open opportunity inbox</button>`
    })}
    ${prototypeBanner()}
    <section class="score-grid">${DATA.scores.map(scoreCard).join("")}</section>

    <section class="dashboard-grid dashboard-grid-main">
      <article class="panel span-7">
        <header class="panel-header"><div><div class="eyebrow">Executive diagnosis</div><h2>What changed</h2></div><span class="muted-label">Last ${state.range} days</span></header>
        <div class="change-list">
          ${DATA.changes.map((item) => `<div class="change-item ${escapeHtml(item.tone)}"><div class="change-marker"></div><div><div class="change-title-row"><h3>${escapeHtml(item.title)}</h3>${badge(item.badge, item.tone)}</div><p>${escapeHtml(item.body)}</p></div></div>`).join("")}
        </div>
      </article>

      <article class="panel span-5">
        <header class="panel-header"><div><div class="eyebrow">Action queue</div><h2>Priority opportunities</h2></div><button class="text-button" data-action="open-view" data-target="opportunities" type="button">View all →</button></header>
        <div class="compact-opportunity-list">
          ${openOpps.map((item) => `<button class="compact-opportunity" data-action="open-opportunity" data-id="${escapeHtml(item.id)}" type="button"><span class="priority-dot priority-${item.priority.toLowerCase()}"></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.owner)} · ${escapeHtml(item.type)}</small></span><span class="chevron">›</span></button>`).join("")}
        </div>
      </article>
    </section>

    <section class="dashboard-grid">
      <article class="panel span-7">
        <header class="panel-header"><div><div class="eyebrow">Commercial journey</div><h2>Visibility-to-revenue funnel</h2></div>${sourceBadge("Sample")}</header>
        <div class="funnel-list">
          ${DATA.funnel.map((stage) => `<div class="funnel-row"><div class="funnel-label"><span>${escapeHtml(stage.stage)}</span><strong>${escapeHtml(stage.display)}</strong></div><div class="funnel-track"><span style="width:${stage.share}%"></span></div><small>${sourceBadge(stage.status)}</small></div>`).join("")}
        </div>
        <div class="panel-note"><strong>What makes this valuable:</strong> once links, GA4 and Bitrix24 are connected, each stage can be traced to the originating agent, content asset, project and campaign.</div>
      </article>

      <article class="panel span-5">
        <header class="panel-header"><div><div class="eyebrow">Project intelligence</div><h2>Demand-to-coverage gaps</h2></div><button class="text-button" data-action="open-view" data-target="projects" type="button">Explore →</button></header>
        <div class="project-mini-list">
          ${[...DATA.projects].sort((a, b) => b.opportunity - a.opportunity).slice(0, 4).map((project) => `<div class="project-mini"><div><strong>${escapeHtml(project.name)}</strong><span>Opportunity ${project.opportunity}</span></div>${progress(project.opportunity, `${project.name} opportunity`)}</div>`).join("")}
        </div>
      </article>
    </section>

    <section class="panel">
      <header class="panel-header"><div><div class="eyebrow">Channel portfolio</div><h2>Visibility and measurement health</h2></div><button class="text-button" data-action="open-view" data-target="integrations" type="button">Manage sources →</button></header>
      <div class="table-wrap"><table><thead><tr><th>Channel</th><th>Visibility</th><th>Momentum</th><th>Commercial actions</th><th>Confidence</th><th>Status</th></tr></thead><tbody>
        ${DATA.channels.map((channel) => `<tr><td><strong>${escapeHtml(channel.channel)}</strong></td><td><div class="metric-with-bar"><span>${channel.visibility}</span>${progress(channel.visibility, `${channel.channel} visibility`)}</div></td><td>${deltaMarkup(Math.abs(channel.momentum), channel.momentum < 0 ? "down" : "up")}</td><td>${escapeHtml(channel.actions)}</td><td>${sourceBadge(channel.confidence)}</td><td>${channel.status === "Live module" ? badge(channel.status, "positive") : `<button class="table-action" data-action="open-view" data-target="integrations" type="button">${escapeHtml(channel.status)}</button>`}</td></tr>`).join("")}
      </tbody></table></div>
    </section>`;
  }

  function getOpportunities() {
    return DATA.opportunities.map((item) => ({ ...item, ...(state.opportunityOverrides[item.id] || {}) }));
  }

  function saveOpportunity(id, patch) {
    state.opportunityOverrides[id] = { ...(state.opportunityOverrides[id] || {}), ...patch };
    localStorage.setItem("visibility-opportunities", JSON.stringify(state.opportunityOverrides));
    updateOpportunityCount();
  }

  function updateOpportunityCount() {
    const count = getOpportunities().filter((item) => item.status !== "Completed" && item.status !== "Dismissed").length;
    opportunityCount.textContent = String(count);
  }

  function opportunityCard(item) {
    const owners = ["Unassigned", "Management", "Marketing", "Social", "Data", "Sales", "Web/IT"];
    return `<article class="opportunity-card" data-opportunity-id="${escapeHtml(item.id)}">
      <div class="opportunity-head">
        <div class="opportunity-badges">${badge(item.priority, item.priority.toLowerCase())}${badge(item.type, "neutral")}${sourceBadge(item.sourceStatus)}</div>
        <label class="status-select"><span class="sr-only">Opportunity status</span><select data-opportunity-field="status"><option ${item.status === "Open" ? "selected" : ""}>Open</option><option ${item.status === "In Progress" ? "selected" : ""}>In Progress</option><option ${item.status === "Completed" ? "selected" : ""}>Completed</option><option ${item.status === "Dismissed" ? "selected" : ""}>Dismissed</option></select></label>
      </div>
      <h2>${escapeHtml(item.title)}</h2>
      <div class="opportunity-section"><span>Observation</span><p>${escapeHtml(item.observation)}</p></div>
      <div class="evidence-box"><strong>Evidence</strong><p>${escapeHtml(item.evidence)}</p></div>
      <div class="opportunity-grid"><div><span>Why it matters</span><p>${escapeHtml(item.impact)}</p></div><div><span>Confidence</span><p>${escapeHtml(item.confidence)}</p></div><div><span>Due date</span><p>${escapeHtml(item.dueDate || "Not scheduled")}</p></div><div><span>Expected impact</span><p>${escapeHtml(item.expectedImpact || "Not assessed")}</p></div></div>
      <div class="recommended-action"><div class="action-number">01</div><div><span>Recommended action</span><p>${escapeHtml(item.action)}</p></div></div>
      <footer class="opportunity-footer"><label><span>Owner</span><select data-opportunity-field="owner">${owners.map((owner) => `<option ${item.owner === owner ? "selected" : ""}>${escapeHtml(owner)}</option>`).join("")}</select></label><button class="secondary-button" data-action="copy-action" type="button">Copy action</button><button class="primary-button" data-action="mark-progress" type="button">${item.status === "Completed" ? "Reopen" : "Start action"}</button></footer>
    </article>`;
  }

  function opportunitiesView() {
    const all = getOpportunities();
    const types = [...new Set(all.map((item) => item.type))].sort();
    const priorities = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const filtered = all.filter((item) => {
      const filters = state.opportunityFilters;
      return (filters.priority === "All" || item.priority === filters.priority)
        && (filters.status === "All" || item.status === filters.status)
        && (filters.type === "All" || item.type === filters.type)
        && (!filters.query || `${item.title} ${item.observation} ${item.action}`.toLowerCase().includes(filters.query.toLowerCase()));
    }).sort((a, b) => state.opportunityFilters.sort === "Due date"
      ? String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"))
      : state.opportunityFilters.sort === "Owner"
        ? a.owner.localeCompare(b.owner)
        : (priorities[a.priority] ?? 9) - (priorities[b.priority] ?? 9));

    return `${renderPageHeader({
      eyebrow: "Operating system",
      title: "Opportunity inbox",
      description: "Turn signals into owned actions, measure completion and learn which interventions improve commercial outcomes.",
      actions: `<button class="secondary-button" data-action="reset-opportunities" type="button">Reset prototype state</button>`
    })}
    <section class="filter-bar">
      <label><span>Search</span><input id="oppSearch" type="search" placeholder="Search opportunities" value="${escapeHtml(state.opportunityFilters.query)}"></label>
      <label><span>Priority</span><select id="priorityFilter"><option>All</option>${["Critical", "High", "Medium", "Low"].map((value) => `<option ${state.opportunityFilters.priority === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      <label><span>Status</span><select id="statusFilter"><option>All</option>${["Open", "In Progress", "Completed", "Dismissed"].map((value) => `<option ${state.opportunityFilters.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      <label><span>Type</span><select id="typeFilter"><option>All</option>${types.map((value) => `<option ${state.opportunityFilters.type === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select></label>
      <label><span>Sort</span><select id="sortFilter">${["Priority", "Due date", "Owner"].map((value) => `<option ${state.opportunityFilters.sort === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      <div class="filter-summary"><strong>${filtered.length}</strong><span>of ${all.length} opportunities</span></div>
    </section>
    <section class="opportunity-list">${filtered.length ? filtered.map(opportunityCard).join("") : `<div class="empty-state"><strong>No matching opportunities</strong><span>Change the filters to view more actions.</span></div>`}</section>`;
  }

  function searchView() {
    return `${renderPageHeader({
      eyebrow: "Search everywhere",
      title: "Traditional search, local discovery and AI answers.",
      description: "Measure whether Kirpa is found, recommended and cited in the places where buyers research property decisions.",
      actions: `<button class="primary-button" data-action="plan-integration" data-integration="search-console" type="button">Connect search sources</button>`
    })}
    ${prototypeBanner("Connect the verified Kirpa properties before using these values for decisions.")}
    <section class="score-grid score-grid-3">
      <article class="score-card"><div class="score-card-top"><span>Search discoverability</span>${sourceBadge("Sample")}</div><div class="score-value-row"><strong>61</strong><span>/100</span>${deltaMarkup(4, "up")}</div>${progress(61, "Search discoverability")}<p>Visibility across priority branded and non-branded queries.</p></article>
      <article class="score-card"><div class="score-card-top"><span>AI answer presence</span>${sourceBadge("Sample")}</div><div class="score-value-row"><strong>34</strong><span>/100</span>${deltaMarkup(6, "up")}</div>${progress(34, "AI answer presence")}<p>Standardised prompt tests for mentions, recommendations and citations.</p></article>
      <article class="score-card"><div class="score-card-top"><span>Local authority</span>${sourceBadge("Sample")}</div><div class="score-value-row"><strong>68</strong><span>/100</span>${deltaMarkup(2, "up")}</div>${progress(68, "Local authority")}<p>Maps visibility, profile actions, review quality and listing accuracy.</p></article>
    </section>
    <section class="dashboard-grid">
      <article class="panel span-7"><header class="panel-header"><div><div class="eyebrow">Google discovery</div><h2>Priority keyword movement</h2></div>${sourceBadge("Sample")}</header><div class="table-wrap"><table><thead><tr><th>Query</th><th>Position</th><th>Movement</th><th>Intent</th><th>Landing page</th></tr></thead><tbody>${DATA.searchKeywords.map((row) => `<tr><td><strong>${escapeHtml(row.query)}</strong></td><td>${row.position}</td><td>${row.previous === row.position ? badge("No change") : deltaMarkup(Math.abs(row.previous - row.position), row.position < row.previous ? "up" : "down")}</td><td>${badge(row.intent, "neutral")}</td><td><code>${escapeHtml(row.page)}</code></td></tr>`).join("")}</tbody></table></div></article>
      <article class="panel span-5"><header class="panel-header"><div><div class="eyebrow">Opportunity model</div><h2>Almost-winning queries</h2></div></header><div class="insight-stack"><div class="insight-callout"><span class="insight-number">01</span><div><strong>Positions 5–20</strong><p>Prioritise pages already close to the first results instead of treating every keyword equally.</p></div></div><div class="insight-callout"><span class="insight-number">02</span><div><strong>Commercial intent first</strong><p>Weight investor, buyer and event queries above generic informational visibility.</p></div></div><div class="insight-callout"><span class="insight-number">03</span><div><strong>Connect to outcomes</strong><p>Compare query → page → enquiry → qualified lead → transaction once attribution is active.</p></div></div></div></article>
    </section>
    <section class="panel"><header class="panel-header"><div><div class="eyebrow">AI discovery</div><h2>Prompt monitoring</h2></div>${sourceBadge("Experimental sample")}</header><div class="table-wrap"><table><thead><tr><th>Standardised prompt</th><th>Kirpa mentioned</th><th>Kirpa cited</th><th>Competitors named</th><th>Evidence state</th></tr></thead><tbody>${DATA.aiPrompts.map((row) => `<tr><td><strong>${escapeHtml(row.prompt)}</strong></td><td>${badge(row.mentioned, row.mentioned === "Yes" ? "positive" : "warning")}</td><td>${badge(row.cited, row.cited === "Yes" ? "positive" : "neutral")}</td><td>${row.competitors}</td><td>${sourceBadge(row.status)}</td></tr>`).join("")}</tbody></table></div><div class="panel-note">AI answers vary by model, location, language, session and date. This module must retain prompt, model, market, timestamp, response evidence and repeated-test consistency.</div></section>`;
  }

  function socialView() {
    return `${renderPageHeader({
      eyebrow: "First live module",
      title: "Social Intelligence & Agent Ranking",
      description: "The established Kirpa Social Ranking remains intact and becomes the first live module inside the wider visibility product.",
      actions: `<a class="secondary-button button-link" href="../index.html" target="_blank" rel="noopener">Open full ranking ↗</a>`
    })}
    <div class="live-module-banner"><span class="status-pulse"></span><div><strong>Live connected module</strong><span>Powered by the existing public social-data pipeline, historical snapshots, Momentum formula and developer-mention workflows.</span></div>${sourceBadge("Live")}</div>
    <section class="social-bridge-grid">
      <article class="panel"><div class="eyebrow">What stays intact</div><h2>Existing ranking logic</h2><p>Current account roster, metrics, filters, calculations, historical data, mention analysis and update workflow remain the source of truth for the live ranking.</p></article>
      <article class="panel"><div class="eyebrow">What the wider product adds</div><h2>Commercial context</h2><p>Agent contribution, project coverage, trackable actions, qualified pipeline and revenue influence sit around the ranking without contaminating public metrics.</p></article>
      <article class="panel"><div class="eyebrow">Data boundary</div><h2>Public vs private</h2><p>Public social performance can remain visible. CRM leads, private insights, commission and management commentary require authenticated storage.</p></article>
    </section>
    <section class="embedded-module-panel">
      <div class="embedded-toolbar"><div><strong>Kirpa Social Ranking</strong><span>Embedded from the existing GitHub Pages application</span></div><a href="../index.html" target="_blank" rel="noopener">Open in a new tab ↗</a></div>
      <iframe class="social-frame" src="../index.html" title="Kirpa Social Ranking dashboard" loading="lazy"></iframe>
    </section>`;
  }

  function agentsView() {
    return `${renderPageHeader({
      eyebrow: "Distributed brand network",
      title: "Separate personal popularity from company contribution.",
      description: "Give every agent a transparent view of visibility, Kirpa amplification, measurable demand capture and improvement actions.",
      actions: `<button class="secondary-button" data-action="open-view" data-target="social" type="button">Open live ranking</button>`
    })}
    ${prototypeBanner("The enrichment scores below are demonstrative; use the embedded ranking for current live social performance.")}
    <section class="panel"><header class="panel-header"><div><div class="eyebrow">Agent network</div><h2>Contribution scorecard</h2></div><div class="legend-inline"><span><i class="legend-dot visibility"></i>Visibility</span><span><i class="legend-dot brand"></i>Brand contribution</span><span><i class="legend-dot capture"></i>Demand capture</span></div></header><div class="agent-list">${DATA.agents.map((agent, index) => `<article class="agent-row"><div class="agent-rank">${String(index + 1).padStart(2, "0")}</div><div class="agent-identity"><div class="agent-avatar">${escapeHtml(agent.handle.slice(0, 2).toUpperCase())}</div><div><strong>@${escapeHtml(agent.handle)}</strong><span>${sourceBadge(agent.status)}</span></div></div><div class="agent-score"><span>Visibility <strong>${agent.visibility}</strong></span>${progress(agent.visibility, `${agent.handle} visibility`)}</div><div class="agent-score"><span>Kirpa contribution <strong>${agent.brand}</strong></span>${progress(agent.brand, `${agent.handle} Kirpa contribution`)}</div><div class="agent-score"><span>Demand capture <strong>Not connected</strong></span><small>CRM attribution unavailable</small></div><div class="agent-trend">${deltaMarkup(agent.trend, "up")}</div><button class="icon-button" data-action="agent-detail" data-agent="${escapeHtml(agent.handle)}" type="button" aria-label="View @${escapeHtml(agent.handle)}">›</button></article>`).join("")}</div></section>
    <section class="dashboard-grid"><article class="panel span-6"><div class="eyebrow">Fairness controls</div><h2>Anti-gaming requirements</h2><ul class="check-list"><li>Normalise performance by audience size and account maturity.</li><li>Separate organic exposure from paid promotion.</li><li>Weight saves, shares and qualified actions above superficial posting volume.</li><li>Exclude company-assigned leads from agent-generated pipeline.</li><li>Show every formula, input and missing-data rule.</li></ul></article><article class="panel span-6"><div class="eyebrow">Agent activation</div><h2>From ranking to coaching</h2><ul class="check-list"><li>Weekly personal recommendations based on the agent’s own baseline.</li><li>Governed project briefs, CTAs, trackable links and QR codes.</li><li>Clear milestones without exposing sensitive revenue or lead data.</li><li>Learning loop that measures whether completed actions improved results.</li></ul></article></section>`;
  }

  function projectsView() {
    return `${renderPageHeader({
      eyebrow: "Market coverage intelligence",
      title: "Find demand that Kirpa is not yet capturing.",
      description: "Compare market demand, Kirpa coverage, competitor intensity and historical conversion potential by project, developer, community and campaign.",
      actions: `<button class="primary-button" data-action="plan-taxonomy" type="button">Review taxonomy design</button>`
    })}
    ${prototypeBanner()}
    <section class="panel"><header class="panel-header"><div><div class="eyebrow">Opportunity model</div><h2>Demand-to-coverage map</h2></div><div class="formula-chip">Demand × relevance × competitor momentum × coverage deficit × conversion potential</div></header><div class="project-table-grid"><div class="project-table-head"><span>Entity</span><span>Demand</span><span>Kirpa coverage</span><span>Competitor intensity</span><span>Conversion</span><span>Opportunity</span></div>${[...DATA.projects].sort((a, b) => b.opportunity - a.opportunity).map((project) => `<article class="project-table-row"><div><strong>${escapeHtml(project.name)}</strong><span>${sourceBadge(project.status)}</span></div><div><strong>${project.demand}</strong>${progress(project.demand, `${project.name} demand`)}</div><div><strong>${project.coverage}</strong>${progress(project.coverage, `${project.name} coverage`)}</div><div><strong>${project.competitor}</strong>${progress(project.competitor, `${project.name} competitor intensity`)}</div><div><strong>${project.conversion}</strong>${progress(project.conversion, `${project.name} conversion`)}</div><div class="opportunity-score"><strong>${project.opportunity}</strong><span>${project.opportunity >= 80 ? "Prioritise" : project.opportunity >= 65 ? "Monitor" : "Maintain"}</span></div></article>`).join("")}</div></section>
    <section class="dashboard-grid"><article class="panel span-7"><div class="eyebrow">Visibility graph</div><h2>Required entity relationships</h2><div class="graph-flow"><span>Agent</span><b>→</b><span>Content</span><b>→</b><span>Developer / project</span><b>→</b><span>Campaign</span><b>→</b><span>Lead</span><b>→</b><span>Deal</span></div><p class="panel-copy">A canonical entity layer is the product’s core intellectual property. It resolves aliases and connects every post, query, landing page and CRM outcome to the correct commercial object.</p></article><article class="panel span-5"><div class="eyebrow">Governance queue</div><h2>Taxonomy review</h2><div class="stat-list"><div><span>Canonical developers</span><strong>To import</strong></div><div><span>Project aliases</span><strong>To resolve</strong></div><div><span>Communities</span><strong>To govern</strong></div><div><span>Campaign IDs</span><strong>To issue</strong></div></div></article></section>`;
  }

  function competitorsView() {
    return `${renderPageHeader({
      eyebrow: "Market intelligence",
      title: "Measure share of visible attention without pretending private data is public.",
      description: "Compare public search, social, AI-answer and reputation signals against defined competitor groups with explicit evidence labels.",
      actions: `<button class="secondary-button" data-action="competitor-method" type="button">Review measurement rules</button>`
    })}
    ${prototypeBanner()}
    <section class="dashboard-grid"><article class="panel span-5"><header class="panel-header"><div><div class="eyebrow">Share of voice</div><h2>Measurable visibility</h2></div>${sourceBadge("Sample composite")}</header><div class="share-bars">${DATA.competitors.map((competitor) => `<div class="share-row"><div><strong>${escapeHtml(competitor.name)}</strong><span>${competitor.share}%</span></div><div class="share-track"><span style="width:${competitor.share * 3}%"></span></div></div>`).join("")}</div></article><article class="panel span-7"><header class="panel-header"><div><div class="eyebrow">Cross-channel benchmark</div><h2>Competitive position</h2></div></header><div class="table-wrap"><table><thead><tr><th>Company</th><th>Search</th><th>Social</th><th>AI</th><th>Reviews</th><th>Evidence</th></tr></thead><tbody>${DATA.competitors.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${row.search}</td><td>${row.social}</td><td>${row.ai}</td><td>${row.reviews}</td><td>${sourceBadge(row.status)}</td></tr>`).join("")}</tbody></table></div></article></section>
    <section class="panel"><header class="panel-header"><div><div class="eyebrow">Breakout detection</div><h2>Signals worth alerting on</h2></div></header><div class="alert-grid"><div class="alert-card"><span>01</span><strong>Project acceleration</strong><p>A competitor sharply increases coverage of a strategic developer or community.</p></div><div class="alert-card"><span>02</span><strong>Search encroachment</strong><p>A competitor begins ranking for high-intent queries Kirpa previously owned.</p></div><div class="alert-card"><span>03</span><strong>Market expansion</strong><p>A competitor enters a new language, source market or roadshow territory.</p></div><div class="alert-card"><span>04</span><strong>AI recommendation</strong><p>A competitor becomes repeatedly recommended or cited for a priority prompt cluster.</p></div></div></section>`;
  }

  function revenueView() {
    return `${renderPageHeader({
      eyebrow: "Commercial proof",
      title: "Connect visibility to qualified pipeline and revenue influence.",
      description: "Use deterministic source capture first, assisted attribution second and modelled influence only when clearly labelled.",
      actions: `<button class="primary-button" data-action="plan-integration" data-integration="bitrix" type="button">Plan Bitrix24 connection</button>`
    })}
    ${prototypeBanner("No lead, deal or revenue figures on this screen should be treated as live.")}
    <section class="outcome-grid">${DATA.revenue.outcomes.map((outcome) => `<article><span>${escapeHtml(outcome.label)}</span><strong>${formatNumber(outcome.value)}</strong>${sourceBadge(outcome.status)}</article>`).join("")}</section>
    <section class="dashboard-grid"><article class="panel span-7"><header class="panel-header"><div><div class="eyebrow">Source performance</div><h2>Lead quality by visibility source</h2></div>${sourceBadge("Sample")}</header><div class="table-wrap"><table><thead><tr><th>Source</th><th>Leads</th><th>Qualified</th><th>Qualification rate</th><th>Revenue</th></tr></thead><tbody>${DATA.revenue.sources.map((row) => `<tr><td><strong>${escapeHtml(row.source)}</strong></td><td>${row.leads}</td><td>${row.qualified}</td><td><div class="metric-with-bar"><span>${row.rate}%</span>${progress(row.rate * 2, `${row.source} qualification rate`)}</div></td><td>${badge(row.revenue, "warning")}</td></tr>`).join("")}</tbody></table></div></article><article class="panel span-5"><div class="eyebrow">Attribution hierarchy</div><h2>Evidence before modelling</h2><div class="attribution-stack"><div><span>1</span><strong>Deterministic</strong><p>UTM, QR, agent link, call number, form ID, DM keyword or referral code.</p></div><div><span>2</span><strong>Assisted</strong><p>Identified content interactions before lead creation or conversion.</p></div><div><span>3</span><strong>Self-reported</strong><p>Lead-declared first discovery source retained as a separate field.</p></div><div><span>4</span><strong>Modelled</strong><p>Estimated influence shown with method, assumptions and confidence.</p></div></div></article></section>
    <section class="panel"><header class="panel-header"><div><div class="eyebrow">Required CRM mapping</div><h2>Minimum Bitrix24 fields</h2></div></header><div class="field-grid">${["Visibility lead ID", "First-touch source", "Lead-creating touch", "Agent tracking ID", "Campaign ID", "Developer / project ID", "UTM parameters", "Qualification state", "Viewing / meeting", "Reservation / won", "Commission value", "Loss reason"].map((field) => `<span>${escapeHtml(field)}</span>`).join("")}</div></section>`;
  }

  function reputationView() {
    return `${renderPageHeader({
      eyebrow: "Trust and risk",
      title: "Visibility only has value when the market trusts what it sees.",
      description: "Monitor review quality, response discipline, recurring complaints, information accuracy and emerging reputation risk.",
      actions: `<button class="primary-button" data-action="plan-integration" data-integration="business-profile" type="button">Connect Business Profile</button>`
    })}
    ${prototypeBanner()}
    <section class="score-grid score-grid-4"><article class="score-card"><div class="score-card-top"><span>Trust score</span>${sourceBadge("Sample")}</div><div class="score-value-row"><strong>${DATA.reputation.score}</strong><span>/100</span></div>${progress(DATA.reputation.score, "Trust score")}</article><article class="score-card"><div class="score-card-top"><span>Average rating</span>${sourceBadge("Sample")}</div><div class="score-value-row"><strong>${DATA.reputation.rating}</strong><span>/5</span></div>${progress(DATA.reputation.rating * 20, "Average rating")}</article><article class="score-card"><div class="score-card-top"><span>Review volume</span>${sourceBadge("Sample")}</div><div class="score-value-row"><strong>${DATA.reputation.reviews}</strong><span>total</span></div></article><article class="score-card"><div class="score-card-top"><span>Response rate</span>${sourceBadge("Sample")}</div><div class="score-value-row"><strong>${DATA.reputation.responseRate}</strong><span>%</span></div>${progress(DATA.reputation.responseRate, "Response rate")}</article></section>
    <section class="dashboard-grid"><article class="panel span-7"><header class="panel-header"><div><div class="eyebrow">Voice of customer</div><h2>Recurring themes</h2></div></header><div class="theme-list">${DATA.reputation.themes.map((theme) => `<div class="theme-row"><div><strong>${escapeHtml(theme.theme)}</strong><span>${theme.volume} mentions · ${sourceBadge(theme.status)}</span></div><div class="sentiment-score"><strong>${theme.sentiment}</strong>${progress(theme.sentiment, `${theme.theme} sentiment`)}</div></div>`).join("")}</div></article><article class="panel span-5"><div class="eyebrow">Risk controls</div><h2>Accuracy and compliance checks</h2><ul class="check-list"><li>Outdated prices, payment plans and offer expiry dates.</li><li>Incorrect developer, project or handover claims.</li><li>Unanswered high-risk comments and reviews.</li><li>Agent profile, licensing and contact inconsistencies.</li><li>Unusual negative-volume or sentiment changes.</li></ul></article></section>`;
  }

  function healthView() {
    const connected = DATA.integrations.filter((item) => item.status === "Connected").length;
    const knownCoverage = DATA.integrations.filter((item) => item.coverage != null);
    const totalCoverage = knownCoverage.length ? Math.round(knownCoverage.reduce((sum, item) => sum + item.coverage, 0) / knownCoverage.length) : null;
    return `${renderPageHeader({
      eyebrow: "Trust layer",
      title: "Know exactly which numbers are reliable.",
      description: "Monitor source freshness, coverage, permission state, missing records and evidence classification before management uses a metric.",
      actions: `<button class="secondary-button" data-action="methodology" type="button">Open confidence methodology</button>`
    })}
    <section class="health-summary"><article><span>Connected sources</span><strong>${connected}/${DATA.integrations.length}</strong><small>Only Social Ranking is live</small></article><article><span>Known-source coverage</span><strong>${totalCoverage == null ? "Unknown" : `${totalCoverage}%`}</strong><small>Unconnected sources excluded</small></article><article><span>Critical blockers</span><strong>3</strong><small>Attribution, CRM and web analytics</small></article><article><span>Last reviewed</span><strong>Today</strong><small>${new Date(DATA.meta.asOf).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })}</small></article></section>
    <section class="panel"><header class="panel-header"><div><div class="eyebrow">Source registry</div><h2>Connection and coverage health</h2></div><button class="text-button" data-action="open-view" data-target="integrations" type="button">Manage integrations →</button></header><div class="table-wrap"><table><thead><tr><th>Source</th><th>Category</th><th>Status</th><th>Freshness</th><th>Coverage</th><th>Next action</th></tr></thead><tbody>${DATA.integrations.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.category)}</td><td>${row.status === "Connected" ? badge(row.status, "positive") : badge(row.status, "warning")}</td><td>${escapeHtml(row.freshness)}</td><td>${coverageMarkup(row.coverage, `${row.name} coverage`)}</td><td><button class="table-action" data-action="integration-detail" data-integration="${escapeHtml(row.id)}" type="button">${escapeHtml(row.action)}</button></td></tr>`).join("")}</tbody></table></div></section>
    <section class="panel"><header class="panel-header"><div><div class="eyebrow">Evidence vocabulary</div><h2>Confidence labels</h2></div></header><div class="methodology-grid">${DATA.methodology.map((item) => `<article>${sourceBadge(item.label)}<p>${escapeHtml(item.definition)}</p></article>`).join("")}</div></section>`;
  }

  function integrationsView() {
    return `${renderPageHeader({
      eyebrow: "Connection centre",
      title: "Build the data spine in the correct order.",
      description: "Connect the sources required to move from public visibility to verified attention, captured demand, qualified pipeline and revenue.",
      actions: `<button class="primary-button" data-action="integration-roadmap" type="button">View implementation sequence</button>`
    })}
    <section class="integration-grid">${DATA.integrations.map((integration) => `<article class="integration-card"><div class="integration-card-head"><div class="integration-logo">${escapeHtml(integration.name.split(" ").map((part) => part[0]).join("").slice(0, 2))}</div><div><strong>${escapeHtml(integration.name)}</strong><span>${escapeHtml(integration.category)}</span></div>${integration.status === "Connected" ? badge("Connected", "positive") : badge(integration.status, "warning")}</div><div class="integration-stats"><div><span>Coverage</span><strong>${integration.coverage == null ? "Unknown" : `${integration.coverage}%`}</strong></div><div><span>Freshness</span><strong>${escapeHtml(integration.freshness)}</strong></div></div>${integration.coverage == null ? `<div class="unknown-track">No source data</div>` : progress(integration.coverage, `${integration.name} coverage`)}<button class="${integration.status === "Connected" ? "secondary-button" : "primary-button"} full-width" data-action="integration-detail" data-integration="${escapeHtml(integration.id)}" type="button">${escapeHtml(integration.action)}</button></article>`).join("")}</section>
    <section class="panel"><div class="eyebrow">Recommended sequence</div><h2>Why this order matters</h2><div class="roadmap-steps"><div><span>01</span><strong>Tracking identity</strong><p>Issue agent, project and campaign IDs before importing more channel data.</p></div><div><span>02</span><strong>Website measurement</strong><p>Connect GA4 and Search Console so visibility actions can be observed.</p></div><div><span>03</span><strong>CRM truth</strong><p>Map deterministic source fields and sales outcomes in Bitrix24.</p></div><div><span>04</span><strong>Owned media depth</strong><p>Add Meta insights, ads, Maps and review data after the attribution spine exists.</p></div><div><span>05</span><strong>Competitive intelligence</strong><p>Add public and estimated external signals with explicit evidence boundaries.</p></div></div></section>`;
  }

  function renderView() {
    const renderers = {
      overview: overviewView,
      opportunities: opportunitiesView,
      search: searchView,
      social: socialView,
      agents: agentsView,
      projects: projectsView,
      competitors: competitorsView,
      revenue: revenueView,
      reputation: reputationView,
      health: healthView,
      integrations: integrationsView
    };
    root.innerHTML = renderers[state.view]();
    navList.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));
    document.title = `${navList.querySelector(`[data-view="${state.view}"] span:nth-child(2)`)?.textContent || "Visibility OS"} — Kirpa Properties`;
    root.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    bindViewControls();
  }

  function setView(view) {
    if (!validViews.has(view)) return;
    state.view = view;
    history.replaceState(null, "", `#${view}`);
    sidebar.classList.remove("open");
    renderView();
  }

  function bindViewControls() {
    document.querySelectorAll("[data-action='open-view']").forEach((button) => button.addEventListener("click", () => setView(button.dataset.target)));

    if (state.view === "opportunities") {
      const controls = {
        priorityFilter: "priority",
        statusFilter: "status",
        typeFilter: "type",
        sortFilter: "sort"
      };
      Object.entries(controls).forEach(([id, key]) => {
        document.getElementById(id)?.addEventListener("change", (event) => {
          state.opportunityFilters[key] = event.target.value;
          renderView();
        });
      });
      document.getElementById("oppSearch")?.addEventListener("input", (event) => {
        state.opportunityFilters.query = event.target.value;
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(renderView, 180);
      });
      document.querySelectorAll("[data-opportunity-field]").forEach((control) => control.addEventListener("change", (event) => {
        const card = event.target.closest("[data-opportunity-id]");
        if (!card) return;
        saveOpportunity(card.dataset.opportunityId, { [event.target.dataset.opportunityField]: event.target.value });
        showToast("Opportunity updated");
        renderView();
      }));
    }
  }

  function openModal({ title, eyebrow = "Visibility OS", body }) {
    modalTitle.textContent = title;
    modalEyebrow.textContent = eyebrow;
    modalBody.innerHTML = body;
    modalBackdrop.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => modalClose.focus(), 0);
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  function methodologyModal() {
    openModal({
      title: "Methodology & confidence",
      eyebrow: "Trust layer",
      body: `<p class="modal-intro">Every score and recommendation must be drillable to its source, formula, refresh time, missing-data policy and known limitation.</p><div class="methodology-grid modal-methodology">${DATA.methodology.map((item) => `<article>${sourceBadge(item.label)}<p>${escapeHtml(item.definition)}</p></article>`).join("")}</div><div class="modal-callout"><strong>Non-negotiable rule</strong><p>Use “unknown” when data is missing. Never silently replace missing data with zero or present public competitor metrics as private reach.</p></div>`
    });
  }

  function askVisibilityModal() {
    const examples = [
      "What should management do first?",
      "Which module is live today?",
      "Why is attribution the critical gap?",
      "How should agent performance be measured?"
    ];
    openModal({
      title: "Ask Visibility",
      eyebrow: "Evidence-linked analyst",
      body: `<p class="modal-intro">Ask a management question. This prototype answers from the product model and links the response to the relevant module.</p><form id="askForm" class="ask-form"><label><span class="sr-only">Question</span><input id="askInput" type="text" autocomplete="off" placeholder="Ask about visibility, agents, projects or attribution…"></label><button class="primary-button" type="submit">Analyse</button></form><div class="suggestion-list">${examples.map((example) => `<button type="button" data-question="${escapeHtml(example)}">${escapeHtml(example)}</button>`).join("")}</div><div id="askAnswer" class="ask-answer"><div class="empty-answer">Answers will show the conclusion, evidence boundary and next action.</div></div>`
    });
    const form = document.getElementById("askForm");
    const input = document.getElementById("askInput");
    const answer = document.getElementById("askAnswer");
    const respond = (question) => {
      const q = question.toLowerCase();
      let response;
      if (q.includes("first") || q.includes("priority")) {
        response = { conclusion: "Build deterministic tracking before adding more dashboards.", evidence: "Social Ranking is live, but GA4, tracked links and Bitrix24 are not connected.", action: "Issue agent/campaign IDs, preserve UTM data and map it into Bitrix24.", target: "opportunities" };
      } else if (q.includes("live") || q.includes("today")) {
        response = { conclusion: "Kirpa Social Ranking is the only live connected module in this release.", evidence: "It retains the existing public social-data pipeline, ranking logic and historical snapshots.", action: "Use Data Health to see which sources remain sample or unconnected.", target: "social" };
      } else if (q.includes("agent")) {
        response = { conclusion: "Measure personal visibility, Kirpa contribution and demand capture separately.", evidence: "A large personal audience does not prove company amplification or qualified pipeline contribution.", action: "Add governed agent links and owned-account insights, then normalise by audience size.", target: "agents" };
      } else if (q.includes("attribution") || q.includes("revenue") || q.includes("lead")) {
        response = { conclusion: "Attribution is the critical gap because visibility cannot yet be tied to qualified pipeline.", evidence: "No deterministic web-to-CRM source spine is connected in the prototype.", action: "Connect tracking identity, GA4 and Bitrix24 in that order.", target: "revenue" };
      } else if (q.includes("project") || q.includes("market")) {
        response = { conclusion: "Project opportunity requires demand, coverage and conversion signals joined through canonical entity IDs.", evidence: "The social workflow has developer-name logic, but the wider taxonomy is not yet governed.", action: "Create canonical developer, project, community and campaign records with aliases.", target: "projects" };
      } else {
        response = { conclusion: "The product should convert visibility signals into accountable actions and commercial proof.", evidence: "Only the Social Ranking source is live; other modules currently demonstrate the operating model.", action: "Review the Opportunity Inbox and Data Health before treating any sample score as operational.", target: "overview" };
      }
      answer.innerHTML = `<article class="answer-card"><div class="eyebrow">Conclusion</div><h3>${escapeHtml(response.conclusion)}</h3><div><strong>Evidence boundary</strong><p>${escapeHtml(response.evidence)}</p></div><div><strong>Recommended action</strong><p>${escapeHtml(response.action)}</p></div><button class="secondary-button" id="openAnswerModule" type="button">Open relevant module →</button></article>`;
      document.getElementById("openAnswerModule")?.addEventListener("click", () => { closeModal(); setView(response.target); });
    };
    form.addEventListener("submit", (event) => { event.preventDefault(); if (input.value.trim()) respond(input.value.trim()); });
    modalBody.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => { input.value = button.dataset.question; respond(button.dataset.question); }));
    input.focus();
  }

  function integrationModal(id) {
    const integration = DATA.integrations.find((item) => item.id === id);
    if (!integration) return;
    const plans = {
      "social-ranking": ["Keep the existing data workflow unchanged.", "Expose shared social metrics through a future authenticated API.", "Preserve the public dashboard as the team-facing module."],
      "meta-insights": ["Confirm eligible professional accounts and admin permissions.", "Store access tokens only in a secure backend.", "Import account and media insights with source-level freshness."],
      "search-console": ["Verify the Kirpa domain property.", "Authorise query, page, country and device reporting.", "Store daily snapshots and the last complete data date."],
      "ga4": ["Audit event names and conversion definitions.", "Retain UTM and tracking IDs through forms and WhatsApp actions.", "Join website events to CRM lead IDs server-side."],
      "business-profile": ["Confirm Business Profile ownership and API access.", "Import Search/Maps actions and reviews.", "Create review-response and listing-accuracy workflows."],
      "bitrix": ["Define source, campaign, agent and project custom fields.", "Receive lead/deal updates through secure webhooks.", "Keep PII and secrets outside the public GitHub Pages application."],
      "meta-ads": ["Connect the approved ad account.", "Import spend, delivery, creative and conversion fields.", "Report cost per qualified lead, not only cost per lead."],
      "tracking": ["Create canonical agent, project and campaign IDs.", "Generate short links, QR codes and WhatsApp deep links.", "Preserve first-touch and lead-creating touch separately."]
    };
    openModal({
      title: integration.name,
      eyebrow: integration.category,
      body: `<div class="integration-modal-status">${integration.status === "Connected" ? badge(integration.status, "positive") : badge(integration.status, "warning")}<span>Coverage ${integration.coverage == null ? "Unknown" : `${integration.coverage}%`} · ${escapeHtml(integration.freshness)}</span></div><p class="modal-intro">This release does not request credentials inside the public prototype. Production connections require a secure backend, authenticated workspace and least-privilege access.</p><ol class="modal-step-list">${(plans[id] || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol><div class="modal-callout"><strong>Next implementation object</strong><p>${id === "tracking" ? "Tracking identity and redirect service" : `${integration.name} connector specification and credential flow`}</p></div>`
    });
  }

  function exportSnapshot() {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      workspace: DATA.meta.workspace,
      dateRangeDays: state.range,
      evidenceBoundary: "Only Social Ranking is live; other values are prototype samples.",
      scores: DATA.scores,
      openOpportunities: getOpportunities().filter((item) => item.status !== "Completed" && item.status !== "Dismissed"),
      integrations: DATA.integrations
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kirpa-visibility-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("Executive snapshot exported");
  }

  navList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) setView(button.dataset.view);
  });

  root.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === "open-view") setView(actionTarget.dataset.target);
    if (action === "open-opportunity") {
      setView("opportunities");
      window.setTimeout(() => document.querySelector(`[data-opportunity-id="${CSS.escape(actionTarget.dataset.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
    }
    if (action === "copy-action") {
      const id = actionTarget.closest("[data-opportunity-id]")?.dataset.opportunityId;
      const item = getOpportunities().find((opportunity) => opportunity.id === id);
      if (item) {
        try { await navigator.clipboard.writeText(`${item.title}\n\n${item.action}`); showToast("Action copied"); }
        catch (_error) { showToast("Clipboard access was blocked"); }
      }
    }
    if (action === "mark-progress") {
      const id = actionTarget.closest("[data-opportunity-id]")?.dataset.opportunityId;
      const item = getOpportunities().find((opportunity) => opportunity.id === id);
      if (item) { saveOpportunity(id, { status: item.status === "Completed" ? "Open" : "In Progress" }); showToast(item.status === "Completed" ? "Opportunity reopened" : "Action started"); renderView(); }
    }
    if (action === "reset-opportunities") {
      localStorage.removeItem("visibility-opportunities");
      state.opportunityOverrides = {};
      showToast("Prototype opportunity state reset");
      renderView();
    }
    if (["integration-detail", "plan-integration"].includes(action)) integrationModal(actionTarget.dataset.integration);
    if (action === "methodology") methodologyModal();
    if (action === "agent-detail") {
      const agent = DATA.agents.find((item) => item.handle === actionTarget.dataset.agent);
      if (agent) openModal({ title: `@${agent.handle}`, eyebrow: "Sample agent enrichment", body: `<p class="modal-intro">This demonstrates the future private agent view. Current live social details remain in the Social Ranking module.</p><div class="agent-modal-grid"><div><span>Visibility</span><strong>${agent.visibility}</strong>${progress(agent.visibility, "Visibility")}</div><div><span>Momentum</span><strong>${agent.momentum}</strong>${progress(agent.momentum, "Momentum")}</div><div><span>Kirpa contribution</span><strong>${agent.brand}</strong>${progress(agent.brand, "Kirpa contribution")}</div><div><span>Project contribution</span><strong>${agent.project}</strong>${progress(agent.project, "Project contribution")}</div><div><span>Content consistency</span><strong>${agent.consistency}</strong>${progress(agent.consistency, "Content consistency")}</div><div><span>Demand capture</span><strong>${agent.capture}</strong></div><div><span>Qualified pipeline</span><strong>${agent.pipeline}</strong></div><div><span>Data confidence</span><strong>${agent.confidence}</strong></div></div><div class="modal-callout"><strong>Evidence boundary</strong><p>These enrichment scores are sample values. CRM contribution remains not connected. Use the embedded live ranking for current public social performance.</p></div>` });
    }
    if (action === "plan-taxonomy") {
      openModal({ title: "Visibility Graph taxonomy", eyebrow: "Data foundation", body: `<p class="modal-intro">Canonical entities make cross-channel and CRM analysis possible.</p><div class="field-grid modal-fields">${["Organisation", "Agent", "Social account", "Content asset", "Developer", "Project", "Community", "Listing", "Campaign", "Source market", "Lead", "Deal"].map((field) => `<span>${field}</span>`).join("")}</div><div class="modal-callout"><strong>Migration rule</strong><p>Preserve the existing developer dictionary and historical social records, then map them to canonical IDs without rewriting the live workflow first.</p></div>` });
    }
    if (action === "competitor-method") methodologyModal();
    if (action === "integration-roadmap") {
      openModal({ title: "Implementation sequence", eyebrow: "Build order", body: `<ol class="modal-step-list"><li>Tracking identity: agent, project and campaign IDs.</li><li>Website measurement: GA4 and Search Console.</li><li>CRM truth: Bitrix24 source and outcome mapping.</li><li>Owned-account depth: Meta insights, ads, Maps and reviews.</li><li>Competitive intelligence and AI-answer monitoring.</li></ol><div class="modal-callout"><strong>Reason</strong><p>Adding more visibility sources before deterministic attribution creates a bigger reporting system without proving business impact.</p></div>` });
    }
  });

  document.getElementById("askBtn").addEventListener("click", askVisibilityModal);
  document.getElementById("methodologyBtn").addEventListener("click", methodologyModal);
  document.getElementById("exportBtn").addEventListener("click", exportSnapshot);
  menuToggle.addEventListener("click", () => sidebar.classList.toggle("open"));
  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (event) => { if (event.target === modalBackdrop) closeModal(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); askVisibilityModal(); }
  });
  dateRange.value = String(state.range);
  dateRange.addEventListener("change", (event) => {
    state.range = Number(event.target.value);
    localStorage.setItem("visibility-range", String(state.range));
    showToast(`Date range changed to ${state.range} days`);
    renderView();
  });
  window.addEventListener("hashchange", () => {
    const next = location.hash.slice(1);
    if (validViews.has(next) && next !== state.view) { state.view = next; renderView(); }
  });

  updateOpportunityCount();
  renderView();
})();
