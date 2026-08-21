window.VISIBILITY_DATA = Object.freeze({
  meta: {
    workspace: "Kirpa Properties",
    market: "UAE",
    asOf: "2026-08-21T17:00:00+04:00",
    liveSources: 1,
    totalSources: 8,
    liveSourceName: "Kirpa Social Ranking",
    prototype: true
  },
  scores: [
    { id: "visibility", label: "Visibility", value: 72, delta: 8.4, direction: "up", definition: "Discoverability and measurable exposure across tracked channels.", status: "Sample" },
    { id: "momentum", label: "Momentum", value: 64, delta: 12.0, direction: "up", definition: "How quickly visibility is accelerating against its own baseline.", status: "Sample" },
    { id: "capture", label: "Demand capture", value: 41, delta: -3.2, direction: "down", definition: "How effectively exposure creates identifiable commercial actions.", status: "Sample" },
    { id: "confidence", label: "Data confidence", value: 58, delta: 6.0, direction: "up", definition: "Coverage, freshness and reliability of all connected sources.", status: "Derived" }
  ],
  changes: [
    { id: "change-1", tone: "positive", title: "Agent visibility is accelerating", body: "The connected Social Ranking module is the first live signal. Add owned-account insights to separate public engagement from verified reach.", badge: "Live foundation" },
    { id: "change-2", tone: "warning", title: "Visibility cannot yet be tied to pipeline", body: "Bitrix24, tracked links and web analytics are not connected, so lead and revenue impact remain unverified.", badge: "Measurement gap" },
    { id: "change-3", tone: "neutral", title: "Project coverage needs a shared taxonomy", body: "Developer, project, community and campaign names must be normalised before cross-channel comparison is reliable.", badge: "Data foundation" }
  ],
  funnel: [
    { stage: "Seen", value: 128400, display: "128.4K", share: 100, status: "Sample" },
    { stage: "Attended", value: 41600, display: "41.6K", share: 72, status: "Sample" },
    { stage: "Acted", value: 1860, display: "1,860", share: 48, status: "Sample" },
    { stage: "Captured", value: 214, display: "214", share: 31, status: "Sample" },
    { stage: "Qualified", value: 57, display: "57", share: 19, status: "Sample" },
    { stage: "Converted", value: 4, display: "4", share: 9, status: "Sample" }
  ],
  channels: [
    { channel: "Instagram & agent network", visibility: 84, momentum: 18, actions: "Not connected", confidence: "Public + derived", status: "Live module" },
    { channel: "Google Search", visibility: 61, momentum: 4, actions: "Not connected", confidence: "Sample", status: "Connect" },
    { channel: "Google Maps & reviews", visibility: 68, momentum: 2, actions: "Not connected", confidence: "Sample", status: "Connect" },
    { channel: "Website & landing pages", visibility: 52, momentum: -3, actions: "Not connected", confidence: "Sample", status: "Connect" },
    { channel: "Paid media", visibility: 74, momentum: 7, actions: "Not connected", confidence: "Sample", status: "Connect" }
  ],
  opportunities: [
    {
      id: "opp-attribution",
      priority: "Critical",
      type: "Attribution",
      status: "Open",
      owner: "Unassigned",
      title: "Create the visibility-to-Bitrix attribution spine",
      observation: "Social performance is visible, but leads and deals cannot be traced back to the agent, content, project or campaign that influenced them.",
      evidence: "Social Ranking is live; GA4, tracked links and Bitrix24 are not connected.",
      impact: "Proves which visibility creates qualified pipeline instead of only views.",
      confidence: "Verified gap",
      sourceStatus: "Verified",
      action: "Issue unique agent/campaign links, preserve UTM parameters at lead creation, and map them to Bitrix24 source fields."
    },
    {
      id: "opp-taxonomy",
      priority: "High",
      type: "Data foundation",
      status: "Open",
      owner: "Data",
      title: "Normalise developer, project and community names",
      observation: "The same entity can appear under spelling variants across captions, transcripts, forms and CRM records.",
      evidence: "The current social workflow already uses a developer dictionary; the wider product needs a governed master taxonomy.",
      impact: "Makes project ownership, coverage gaps and conversion reporting trustworthy.",
      confidence: "Derived",
      sourceStatus: "Derived",
      action: "Create canonical IDs, aliases and review queues for developers, projects, communities and campaigns."
    },
    {
      id: "opp-agent-links",
      priority: "High",
      type: "Demand capture",
      status: "Open",
      owner: "Marketing",
      title: "Give every agent a measurable conversion path",
      observation: "Agent content can generate attention without a unique route into WhatsApp, forms or the CRM.",
      evidence: "Current ranking measures social performance; deterministic agent-level conversion IDs are not yet part of the workflow.",
      impact: "Separates personal popularity from company pipeline contribution.",
      confidence: "Verified gap",
      sourceStatus: "Verified",
      action: "Generate one governed short link and QR identity per agent, with project and campaign variants."
    },
    {
      id: "opp-search",
      priority: "Medium",
      type: "Search",
      status: "Open",
      owner: "Marketing",
      title: "Connect Search Console before defining SEO priorities",
      observation: "The product cannot yet distinguish branded demand, project demand and high-intent non-branded discovery.",
      evidence: "Search Console is not connected in the prototype workspace.",
      impact: "Reveals queries where Kirpa is close to winning and pages that need improvement.",
      confidence: "Verified gap",
      sourceStatus: "Verified",
      action: "Connect the verified domain property and import query, page, country and device dimensions."
    },
    {
      id: "opp-owned-insights",
      priority: "Medium",
      type: "Social",
      status: "Open",
      owner: "Social",
      title: "Separate public metrics from owned-account insights",
      observation: "Public views and engagement are useful for ranking, but they do not reveal verified reach, non-follower reach, saves or profile actions.",
      evidence: "The current live module is based on the established Social Ranking data pipeline.",
      impact: "Improves fairness, content diagnosis and confidence in agent contribution scores.",
      confidence: "Derived",
      sourceStatus: "Derived",
      action: "Connect authorised Meta insights for company and participating professional accounts where permissions allow."
    },
    {
      id: "opp-governance",
      priority: "Medium",
      type: "Governance",
      status: "Open",
      owner: "Management",
      title: "Define score ownership and anti-gaming rules",
      observation: "A composite score can create the wrong behaviour when teams do not understand its components or can optimise superficial activity.",
      evidence: "The current Momentum formula is transparent, but the broader platform introduces multiple commercial and confidence scores.",
      impact: "Keeps the system fair, explainable and aligned with qualified business outcomes.",
      confidence: "Derived",
      sourceStatus: "Derived",
      action: "Approve score definitions, weights, exclusions, minimum data thresholds and an appeal process."
    }
  ],
  searchKeywords: [
    { query: "Dubai property investment", position: 18, previous: 22, intent: "Investor", page: "/investment", status: "Sample" },
    { query: "Business Bay apartments", position: 11, previous: 13, intent: "Buyer", page: "/business-bay", status: "Sample" },
    { query: "Dubai off plan property", position: 27, previous: 25, intent: "Investor", page: "/off-plan", status: "Sample" },
    { query: "Kirpa Properties", position: 2, previous: 2, intent: "Branded", page: "/", status: "Sample" },
    { query: "Dubai property roadshow Australia", position: 9, previous: 16, intent: "Event", page: "/australia", status: "Sample" }
  ],
  aiPrompts: [
    { prompt: "Best Dubai property agency for overseas investors", mentioned: "No", cited: "No", competitors: 4, status: "Sample" },
    { prompt: "Dubai property investment company for Australian buyers", mentioned: "Yes", cited: "No", competitors: 3, status: "Sample" },
    { prompt: "Who can analyse Dubai property yield and exit risk?", mentioned: "No", cited: "No", competitors: 5, status: "Sample" },
    { prompt: "Real estate agencies in Dubai with international roadshows", mentioned: "Yes", cited: "Yes", competitors: 2, status: "Sample" }
  ],
  agents: [
    { handle: "aasfa.kirpa", visibility: 78, momentum: 86, brand: 72, capture: 38, trend: 14, status: "Sample enrichment" },
    { handle: "akshay.kirpa", visibility: 74, momentum: 68, brand: 81, capture: 44, trend: 8, status: "Sample enrichment" },
    { handle: "barkha.kirpa", visibility: 69, momentum: 75, brand: 67, capture: 35, trend: 11, status: "Sample enrichment" },
    { handle: "geethika.kirpa", visibility: 82, momentum: 79, brand: 76, capture: 48, trend: 17, status: "Sample enrichment" },
    { handle: "jai.kirpa", visibility: 71, momentum: 63, brand: 70, capture: 41, trend: 5, status: "Sample enrichment" }
  ],
  projects: [
    { name: "DAMAC content cluster", demand: 81, coverage: 58, competitor: 76, conversion: 42, opportunity: 84, status: "Sample" },
    { name: "Business Bay", demand: 74, coverage: 66, competitor: 71, conversion: 54, opportunity: 68, status: "Sample" },
    { name: "Sydney Roadshow", demand: 63, coverage: 79, competitor: 44, conversion: 57, opportunity: 61, status: "Sample" },
    { name: "Priority Project A", demand: 70, coverage: 28, competitor: 52, conversion: 49, opportunity: 88, status: "Sample" },
    { name: "Priority Project B", demand: 56, coverage: 61, competitor: 64, conversion: 38, opportunity: 54, status: "Sample" }
  ],
  competitors: [
    { name: "Kirpa Properties", share: 22, search: 61, social: 84, ai: 34, reviews: 68, status: "Sample composite" },
    { name: "Competitor A", share: 29, search: 82, social: 73, ai: 71, reviews: 77, status: "Public/sample" },
    { name: "Competitor B", share: 21, search: 74, social: 65, ai: 58, reviews: 81, status: "Public/sample" },
    { name: "Competitor C", share: 16, search: 54, social: 62, ai: 49, reviews: 72, status: "Public/sample" },
    { name: "Others", share: 12, search: 41, social: 48, ai: 36, reviews: 60, status: "Modelled/sample" }
  ],
  revenue: {
    outcomes: [
      { label: "Tracked actions", value: 1860, status: "Sample" },
      { label: "Captured leads", value: 214, status: "Sample" },
      { label: "Qualified", value: 57, status: "Sample" },
      { label: "Viewings", value: 18, status: "Sample" },
      { label: "Reservations", value: 4, status: "Sample" }
    ],
    sources: [
      { source: "Agent organic social", leads: 64, qualified: 19, rate: 29.7, revenue: "Unverified" },
      { source: "Company organic social", leads: 38, qualified: 11, rate: 28.9, revenue: "Unverified" },
      { source: "Paid social", leads: 71, qualified: 14, rate: 19.7, revenue: "Unverified" },
      { source: "Google search", leads: 29, qualified: 9, rate: 31.0, revenue: "Unverified" },
      { source: "Events & roadshows", leads: 12, qualified: 4, rate: 33.3, revenue: "Unverified" }
    ]
  },
  reputation: {
    score: 73,
    rating: 4.6,
    reviews: 128,
    responseRate: 82,
    themes: [
      { theme: "Consultant responsiveness", sentiment: 78, volume: 34, status: "Sample" },
      { theme: "Market knowledge", sentiment: 86, volume: 29, status: "Sample" },
      { theme: "Follow-up consistency", sentiment: 51, volume: 18, status: "Sample" },
      { theme: "Property information clarity", sentiment: 69, volume: 22, status: "Sample" }
    ]
  },
  integrations: [
    { id: "social-ranking", name: "Kirpa Social Ranking", category: "Social", status: "Connected", freshness: "Live module", coverage: 100, action: "Open module" },
    { id: "meta-insights", name: "Meta owned-account insights", category: "Social", status: "Not connected", freshness: "—", coverage: 0, action: "Plan connection" },
    { id: "search-console", name: "Google Search Console", category: "Search", status: "Not connected", freshness: "—", coverage: 0, action: "Plan connection" },
    { id: "ga4", name: "Google Analytics 4", category: "Website", status: "Not connected", freshness: "—", coverage: 0, action: "Plan connection" },
    { id: "business-profile", name: "Google Business Profile", category: "Local", status: "Not connected", freshness: "—", coverage: 0, action: "Plan connection" },
    { id: "bitrix", name: "Bitrix24 CRM", category: "CRM", status: "Not connected", freshness: "—", coverage: 0, action: "Plan connection" },
    { id: "meta-ads", name: "Meta Ads", category: "Paid media", status: "Not connected", freshness: "—", coverage: 0, action: "Plan connection" },
    { id: "tracking", name: "Visibility tracking links", category: "Attribution", status: "Not configured", freshness: "—", coverage: 0, action: "Configure" }
  ],
  methodology: [
    { label: "Verified", definition: "Direct first-party data or an observed system state." },
    { label: "Derived", definition: "Calculated from verified inputs using a visible formula." },
    { label: "Public", definition: "Publicly visible platform data, not private reach or conversion data." },
    { label: "Estimated", definition: "Calculated using sampling or explicit assumptions." },
    { label: "Modelled", definition: "Inferred by a statistical or machine-learning method." },
    { label: "Sample", definition: "Prototype data used to demonstrate the product before a source is connected." }
  ]
});
