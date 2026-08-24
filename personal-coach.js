(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.KirpaPersonalCoach = api;
    if (typeof document !== 'undefined') api.installBrowser();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const STORAGE_KEY = 'kirpa-personal-coach-actions-v1';
  const MAX_ACTIONS = 3;
  const isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, places = 2) => {
    if (!isNumber(value)) return null;
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  };
  const median = values => {
    const rows = (values || []).filter(isNumber).slice().sort((a, b) => a - b);
    if (!rows.length) return null;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const titleCase = value => String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  const stableId = value => {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  const ARCHETYPES = {
    'investment-advice': {
      key: 'investment-analyst', label: 'Investment analyst',
      objective: 'Build trust and qualified investor enquiries',
      audience: 'Dubai property investors',
      approach: 'price, yield, supply, risk and exit analysis',
      cta: 'DM for the full investment breakdown'
    },
    'market-update': {
      key: 'market-authority', label: 'Market authority',
      objective: 'Build authority through evidence-led market interpretation',
      audience: 'Dubai buyers, sellers and investors',
      approach: 'market numbers, transactions and implications',
      cta: 'DM for the market data behind the conclusion'
    },
    'area-guide': {
      key: 'area-specialist', label: 'Community specialist',
      objective: 'Own a recognisable community or micro-market',
      audience: 'Buyers and investors comparing Dubai communities',
      approach: 'area prices, lifestyle, supply and buyer fit',
      cta: 'DM the area name for a tailored shortlist'
    },
    'property-showcase': {
      key: 'property-showcase-advisor', label: 'Property showcase advisor',
      objective: 'Turn property discovery into relevant enquiries',
      audience: 'Active Dubai property buyers',
      approach: 'clear, useful and visually led property walkthroughs',
      cta: 'DM for availability, price and viewing options'
    },
    educational: {
      key: 'buyer-educator', label: 'Buyer education advisor',
      objective: 'Build trust by making property decisions easier',
      audience: 'First-time and overseas Dubai property buyers',
      approach: 'plain-language answers to buyer questions',
      cta: 'DM your question for a direct answer'
    },
    'developer-news': {
      key: 'developer-specialialist', label: 'Developer and launch specialist',
      objective: 'Become a trusted source for launches and developer comparisons',
      audience: 'Off-plan buyers and investors',
      approach: 'developer, project and launch intelligence',
      cta: 'DM the project name for the complete comparison'
    },
    lifestyle: {
      key: 'trust-builder', label: 'Trust and relationship builder',
      objective: 'Build familiarity and trust that supports future enquiries',
      audience: 'People who choose an advisor before choosing a property',
      approach: 'credible personal proof, process and client experience',
      cta: 'DM to discuss your property objective privately'
    }
  };

  function roleArchetype(role) {
    const text = String(role || '').toLowerCase();
    if (/founder|chief|managing director|ceo/.test(text)) return {
      key: 'executive-authority', label: 'Executive market authority',
      objective: 'Build company trust and market authority',
      audience: 'Investors, partners, clients and the wider Dubai market',
      approach: 'leadership perspective, market interpretation and company proof',
      cta: 'DM the Kirpa team for the relevant specialist'
    };
    if (/commercial/.test(text)) return {
      key: 'commercial-advisor', label: 'Commercial property advisor',
      objective: 'Generate qualified commercial property conversations',
      audience: 'Business owners and commercial investors',
      approach: 'income, occupancy, location and exit analysis',
      cta: 'DM your commercial requirement and budget'
    };
    if (/secondary/.test(text)) return {
      key: 'secondary-market-advisor', label: 'Secondary-market advisor',
      objective: 'Build trust with ready-property buyers and sellers',
      audience: 'Buyers, sellers and landlords in the ready market',
      approach: 'real listings, comparable prices, negotiation and transaction evidence',
      cta: 'DM the area or property for a current-market assessment'
    };
    if (/off.?plan/.test(text)) return {
      key: 'offplan-advisor', label: 'Off-plan property advisor',
      objective: 'Generate qualified off-plan investor enquiries',
      audience: 'Dubai off-plan buyers and investors',
      approach: 'launch comparisons, payment plans, supply, risk and exit fit',
      cta: 'DM your budget for a filtered off-plan shortlist'
    };
    if (/content/.test(text)) return {
      key: 'content-creator', label: 'Property content creator',
      objective: 'Build useful visibility for Kirpa and its property specialists',
      audience: 'Dubai property audiences',
      approach: 'repeatable, audience-led property formats',
      cta: 'Follow Kirpa for practical property intelligence'
    };
    return {
      key: 'property-advisor', label: 'Dubai property advisor',
      objective: 'Build consistent visibility and qualified property enquiries',
      audience: 'Dubai property buyers and investors',
      approach: 'useful property guidance and relevant opportunities',
      cta: 'DM your budget and preferred location'
    };
  }

  function bestBy(rows, score, eligible = () => true) {
    return (rows || []).filter(eligible).slice().sort((a, b) => {
      const left = score(a);
      const right = score(b);
      return (isNumber(right) ? right : -Infinity) - (isNumber(left) ? left : -Infinity);
    })[0] || null;
  }

  function deriveStrategy(input) {
    const employee = input.employee || {};
    const analytics = input.analytics || {};
    const block = input.block || {};
    const declared = employee.accountStrategy && typeof employee.accountStrategy === 'object'
      ? employee.accountStrategy
      : employee.strategy && typeof employee.strategy === 'object' ? employee.strategy : {};
    const pillars = Array.isArray(block.contentPillars) ? block.contentPillars : [];
    const dominantPillar = bestBy(pillars, row => row.posts || 0);
    const strongestPillar = bestBy(
      pillars,
      row => row.medianRate,
      row => isNumber(row.medianRate) && (row.comparablePosts || 0) >= 2
    ) || dominantPillar;
    const formats = Array.isArray(analytics.formatPerformance) ? analytics.formatPerformance : [];
    const dominantFormat = bestBy(formats, row => row.posts || 0);
    const strongestFormat = bestBy(
      formats,
      row => row.medianInteractions,
      row => isNumber(row.medianInteractions) && (row.comparablePosts || 0) >= 2
    ) || dominantFormat;
    const inferred = ARCHETYPES[strongestPillar?.key]
      || ARCHETYPES[dominantPillar?.key]
      || roleArchetype(employee.role || input.person?.role);
    const source = Object.keys(declared).length ? 'declared' : 'observed';
    const configuredCapacity = declared.weeklyCapacity ?? declared.postsPerWeek;
    const targetCapacity = employee.targets?.postsPerWeek;
    const observedCadence = analytics.postsPerWeek;
    let weeklyCapacity = isNumber(configuredCapacity) ? configuredCapacity
      : isNumber(targetCapacity) ? targetCapacity
        : isNumber(observedCadence) && observedCadence > 0
          ? clamp(Math.round(Math.max(1, observedCadence) * 2) / 2, 1, 4)
          : 2;
    weeklyCapacity = round(clamp(weeklyCapacity, 0.5, 7), 1);
    const sample = analytics.postsInWindow || 0;
    const pillarShare = dominantPillar?.share || 0;
    const inferenceConfidence = source === 'declared' ? 'Confirmed by profile settings'
      : sample >= 8 && pillarShare >= 0.4 ? 'High-confidence observed pattern'
        : sample >= 4 ? 'Provisional observed pattern'
          : 'Early working hypothesis';
    const positioning = declared.positioning || declared.archetype || inferred.label;
    const objective = declared.objective || inferred.objective;
    const audience = declared.audience || inferred.audience;
    const approach = declared.approach || inferred.approach;
    const conversionRoute = declared.conversionRoute || declared.cta || inferred.cta;
    return {
      source,
      sourceLabel: source === 'declared'
        ? 'Declared account strategy'
        : 'Observed account strategy — employee confirmation needed',
      needsConfirmation: source !== 'declared',
      inferenceConfidence,
      key: declared.key || inferred.key,
      positioning,
      objective,
      audience,
      approach,
      conversionRoute,
      weeklyCapacity,
      capacityBasis: isNumber(configuredCapacity) ? 'Employee-declared capacity'
        : isNumber(targetCapacity) ? 'Personal target in the roster'
          : isNumber(observedCadence) ? 'Observed 30-day publishing rhythm'
            : 'Starting planning assumption',
      languages: Array.isArray(declared.languages) ? declared.languages.filter(Boolean) : [],
      boundaries: Array.isArray(declared.boundaries) ? declared.boundaries.filter(Boolean) : [],
      strongestPillar: strongestPillar ? {
        key: strongestPillar.key, label: strongestPillar.label,
        posts: strongestPillar.posts || 0, share: strongestPillar.share ?? null,
        medianRate: strongestPillar.medianRate ?? null,
        comparablePosts: strongestPillar.comparablePosts || 0
      } : null,
      dominantPillar: dominantPillar ? {
        key: dominantPillar.key, label: dominantPillar.label,
        posts: dominantPillar.posts || 0, share: dominantPillar.share ?? null
      } : null,
      strongestFormat: strongestFormat ? {
        type: strongestFormat.type, posts: strongestFormat.posts || 0,
        medianInteractions: strongestFormat.medianInteractions ?? null,
        comparablePosts: strongestFormat.comparablePosts || 0
      } : null,
      dominantFormat: dominantFormat ? { type: dominantFormat.type, posts: dominantFormat.posts || 0 } : null,
      summary: `Build ${objective.toLowerCase()} as a ${positioning.toLowerCase()} for ${audience.toLowerCase()}, using ${(strongestPillar?.label || 'the strongest measured topic').toLowerCase()} and ${(strongestFormat?.type ? titleCase(strongestFormat.type) : 'a repeatable').toLowerCase()} content at a realistic ${weeklyCapacity}-post weekly capacity.`
    };
  }

  function latestChange(points, key) {
    const usable = (points || []).filter(point => (
      isNumber(point?.[key]) && Number.isFinite(Date.parse(point.at || ''))
    )).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (usable.length < 2) return null;
    const current = usable[usable.length - 1];
    const previous = usable[usable.length - 2];
    const delta = current[key] - previous[key];
    return {
      key, from: previous[key], to: current[key], delta,
      pct: previous[key] ? delta / Math.abs(previous[key]) : null,
      fromAt: previous.at, toAt: current.at,
      days: (Date.parse(current.at) - Date.parse(previous.at)) / 86400000
    };
  }

  function movementAnalysis(points) {
    const definitions = [
      ['followers', 'Followers', 1],
      ['postsPerWeek', 'Publishing cadence', 1.2],
      ['engagementRate', 'Interaction rate', 1.5],
      ['medianInteractions', 'Typical interactions', 1]
    ];
    const drivers = definitions.map(([key, label, weight]) => {
      const change = latestChange(points, key);
      if (!change) return null;
      const normalized = isNumber(change.pct) ? change.pct
        : change.delta === 0 ? 0 : Math.sign(change.delta) * 0.01;
      return Object.assign(change, {
        label, weight, normalized,
        direction: change.delta > 0 ? 'up' : change.delta < 0 ? 'down' : 'flat'
      });
    }).filter(Boolean);
    const signal = drivers.reduce((sum, item) => sum + item.normalized * item.weight, 0);
    return {
      hasComparison: drivers.length > 0,
      overall: drivers.length === 0 ? 'Awaiting comparison'
        : signal > 0.025 ? 'Improving'
          : signal < -0.025 ? 'Declining' : 'Broadly stable',
      drivers: drivers.sort((a, b) => Math.abs(b.normalized * b.weight) - Math.abs(a.normalized * a.weight)),
      note: drivers.length
        ? 'Compared with the immediately previous validated capture for this same roster.'
        : 'A second validated capture is required before improvement or decline can be attributed.'
    };
  }

  function dataConfidence(input) {
    const analytics = input.analytics || {};
    const block = input.block || {};
    const captured = Date.parse(input.meta?.capturedAt || '');
    const ageHours = Number.isFinite(captured) ? Math.max(0, (Date.now() - captured) / 3600000) : null;
    const complete = analytics.windowComplete === true && block.windowComplete !== false;
    const posts = analytics.postsInWindow ?? analytics.observedPostsInWindow ?? 0;
    const comparable = analytics.comparablePosts ?? analytics.observedComparablePosts ?? 0;
    const coverage = analytics.metricCoverage || analytics.observedMetricCoverage || {};
    const missing = [];
    if (!complete) missing.push(analytics.coverageReason || 'Complete 30-day post coverage was not proved');
    if (posts > 0 && comparable < 3) missing.push(`${comparable}/3 comparable posts for team engagement comparison`);
    if ((coverage.videos || 0) > (coverage.videoViews || 0)) {
      missing.push(`${coverage.videoViews || 0}/${coverage.videos || 0} videos publicly reported views`);
    }
    if (block.score?.held === true && Array.isArray(block.score.eligibilityReasons)) missing.push(...block.score.eligibilityReasons);
    const stale = isNumber(ageHours) && ageHours > 108;
    return {
      complete, current: !stale,
      status: !complete ? 'Partial measurement'
        : stale ? 'Complete but overdue for refresh'
          : missing.length ? 'Complete with comparison limits' : 'Complete and current',
      tone: !complete || stale ? 'attention' : missing.length ? 'watch' : 'healthy',
      capturedAt: input.meta?.capturedAt || null,
      ageHours: round(ageHours, 1), posts, comparablePosts: comparable,
      metricCoverage: coverage,
      scoreEligible: block.score?.held !== true && block.score?.rank !== null,
      missing: [...new Set(missing.filter(Boolean))],
      nextStep: !complete ? 'Restore a complete verified window before changing strategy.'
        : comparable < 3 ? 'Publish enough comparable content to establish a reliable comparison.'
          : stale ? 'Run the next scheduled validated snapshot.'
            : 'No data repair is currently required.'
    };
  }

  function performanceDiagnosis(input, strategy, confidence) {
    const analytics = input.analytics || {};
    const block = input.block || {};
    const percentiles = block.teamPercentiles || {};
    const cadence = percentiles.postsPerWeek;
    const engagement = percentiles.interactionRate;
    const reach = percentiles.viewEfficiency;
    const follower = percentiles.followers;
    const dimensions = [
      { key: 'engagement', label: 'interaction efficiency', value: engagement },
      { key: 'reach', label: 'view efficiency', value: reach },
      { key: 'cadence', label: 'publishing cadence', value: cadence },
      { key: 'followers', label: 'audience base', value: follower }
    ].filter(row => isNumber(row.value));
    const strengths = dimensions.filter(row => row.value >= 60).sort((a, b) => b.value - a.value);
    const constraints = dimensions.filter(row => row.value < 45).sort((a, b) => a.value - b.value);
    const posts = analytics.postsInWindow || 0;
    const silentDays = block.daysSinceLastPost;
    let diagnosis;
    let primaryConstraint;
    if (!confidence.complete) {
      diagnosis = 'The account cannot be diagnosed responsibly because the latest 30-day window is incomplete.';
      primaryConstraint = 'Data completeness';
    } else if (posts === 0) {
      diagnosis = 'There is no recent content to evaluate; the immediate objective is to rebuild a measurable baseline.';
      primaryConstraint = 'No recent publishing activity';
    } else if ((analytics.comparablePosts || 0) < 3) {
      diagnosis = 'The account is active, but the sample is still too small for a reliable team-level conclusion.';
      primaryConstraint = 'Insufficient comparable content';
    } else if (isNumber(silentDays) && silentDays >= 10) {
      diagnosis = `A ${silentDays}-day publishing gap is now the most immediate threat to momentum.`;
      primaryConstraint = 'Publishing continuity';
    } else if (isNumber(cadence) && cadence < 40 && isNumber(engagement) && engagement >= 55) {
      diagnosis = 'Content quality is responding when published; inconsistent publishing is limiting the account more than content quality.';
      primaryConstraint = 'Publishing consistency';
    } else if (isNumber(cadence) && cadence >= 55 && isNumber(engagement) && engagement < 40) {
      diagnosis = 'Output is sufficient, but the typical post is not earning enough audience reaction. Improve topic relevance and opening execution.';
      primaryConstraint = 'Content response';
    } else if (isNumber(reach) && reach < 40 && isNumber(engagement) && engagement >= 55) {
      diagnosis = 'Existing viewers respond well, but content is not travelling far enough beyond the current follower base.';
      primaryConstraint = 'Distribution and discovery';
    } else if (isNumber(reach) && reach >= 55 && isNumber(engagement) && engagement < 40) {
      diagnosis = 'Reach is arriving, but the content is not converting enough of that attention into visible interaction.';
      primaryConstraint = 'Attention conversion';
    } else if (strengths.length >= 2 && !constraints.length) {
      diagnosis = `The account has a healthy foundation. Repeat the proven ${(strategy.strongestPillar?.label || 'content').toLowerCase()} pattern without sacrificing consistency.`;
      primaryConstraint = 'Protecting repeatability';
    } else {
      diagnosis = `The account is building a usable pattern. Concentrate on ${(strategy.strongestPillar?.label || strategy.approach).toLowerCase()} while collecting a stronger comparison sample.`;
      primaryConstraint = constraints[0]?.label ? titleCase(constraints[0].label) : 'Establishing a repeatable pattern';
    }
    return {
      diagnosis, primaryConstraint, strengths, constraints,
      score: isNumber(block.score?.value) ? round(block.score.value * 100, 0) : null,
      rank: block.score?.rank || null,
      scoreHeld: block.score?.held === true,
      percentiles: { cadence, engagement, reach, followers: follower }
    };
  }

  function strategyHook(strategy) {
    if (/investment|commercial/.test(strategy.key)) return 'State the decision first: price, yield, supply, risk or exit — then show the evidence.';
    if (/market|executive/.test(strategy.key)) return 'Open with one market conclusion, then show the number that makes it important.';
    if (/area/.test(strategy.key)) return 'Name the community and the buyer decision in the opening sentence.';
    if (/showcase/.test(strategy.key)) return 'Show the strongest feature immediately and place price plus location in the first three seconds.';
    if (/educator/.test(strategy.key)) return 'Open with the exact buyer question and answer the first part immediately.';
    if (/developer|offplan/.test(strategy.key)) return 'Name the developer or project, then state who it suits and the trade-off.';
    if (/secondary/.test(strategy.key)) return 'Lead with the current comparable price, seller problem or buyer advantage.';
    if (/trust/.test(strategy.key)) return 'Begin with a real client problem, decision or proof point rather than a generic introduction.';
    return 'Open with the property decision the viewer needs to make, not a general introduction.';
  }

  function strategySeries(strategy) {
    if (strategy.key === 'investment-analyst') return 'a “Good, Bad and Overpriced” comparison series';
    if (strategy.key === 'commercial-advisor') return 'a commercial deal-math series covering income, occupancy, risk and exit';
    if (/market|executive/.test(strategy.key)) return 'a weekly evidence-led Dubai market-view series';
    if (/area/.test(strategy.key)) return 'a four-part community series: price, rental demand, future supply and buyer fit';
    if (/showcase/.test(strategy.key)) return 'a walkthrough series using location, price, strongest feature and buyer fit';
    if (/educator/.test(strategy.key)) return 'a buyer FAQ series built from one real question per Reel';
    if (/developer|offplan/.test(strategy.key)) return 'a project comparison series covering payment plan, supply, risk and exit';
    if (/secondary/.test(strategy.key)) return 'a ready-market reality series using current listings and comparable transactions';
    if (/trust/.test(strategy.key)) return 'a client-decision and behind-the-process proof series';
    return 'a repeatable property-decision series built around the account’s strongest topic';
  }

  function actionScore(values = {}) {
    return round((values.strategyFit || 70) * 0.30 + (values.impact || 70) * 0.25 +
      (values.evidence || 50) * 0.20 + (values.feasibility || 80) * 0.15 +
      (values.urgency || 50) * 0.10, 1);
  }

  function confidenceLabel(evidenceCount, complete) {
    return complete && evidenceCount >= 3 ? 'High'
      : complete && evidenceCount >= 2 ? 'Medium' : 'Experimental';
  }

  function normalizeCoreAction(action, index, strategy, analytics) {
    const text = `${action?.action || ''} ${action?.because || ''}`.toLowerCase();
    const category = /post|cadence|rhythm|streak|week/.test(text) ? 'Consistency'
      : /hook|question|engagement/.test(text) ? 'Content response'
        : /developer/.test(text) ? 'Developer coverage'
          : /format|reel|carousel|image/.test(text) ? 'Format mix' : 'Content focus';
    const primaryMetric = category === 'Consistency' ? 'postsPerWeek'
      : category === 'Content response' ? 'interactionRate'
        : category === 'Developer coverage' ? 'developerShare' : 'medianInteractions';
    return {
      rule: `validated-core-${index}`, category,
      action: action.action, why: action.because, evidence: [action.because],
      steps: category === 'Content response'
        ? [strategyHook(strategy), `Keep the topic aligned with ${strategy.approach}.`, `End with: “${strategy.conversionRoute}”.`]
        : category === 'Consistency'
          ? [`Plan the next ${Math.max(1, Math.round(strategy.weeklyCapacity))} posts before filming.`, 'Batch research or filming in one session.', 'Keep the next gap inside the recommended limit.']
          : [`Keep the next content aligned with ${strategy.positioning}.`, `Use ${strategy.strongestPillar?.label?.toLowerCase() || strategy.approach} as the starting point.`, `Use the account CTA: ${strategy.conversionRoute}.`],
      successMetric: primaryMetric === 'postsPerWeek'
        ? `Reach or maintain ${strategy.weeklyCapacity} posts/week in the next complete window.`
        : primaryMetric === 'interactionRate'
          ? 'Increase personal median interaction rate by at least 10% or reach the current team median.'
          : primaryMetric === 'developerShare'
            ? 'Publish and process two developer-led Reels, then compare their performance.'
            : 'At least one of the next two posts should exceed current personal median interactions.',
      primaryMetric,
      targetValue: primaryMetric === 'postsPerWeek' ? strategy.weeklyCapacity : null,
      expectedDirection: 'up', evidenceCount: Math.max(1, analytics.comparablePosts || 0),
      score: actionScore({ strategyFit: 85, impact: 78, evidence: 78, feasibility: 85, urgency: index === 0 ? 85 : 60 })
    };
  }

  function buildRecommendations(input, strategy, confidence, performance) {
    const analytics = input.analytics || {};
    const block = input.block || {};
    const mentions = input.mentions || null;
    const team = input.team || {};
    const candidates = [];
    const add = candidate => {
      if (!candidate?.action || !candidate?.why) return;
      const evidenceCount = candidate.evidenceCount ?? 0;
      const rule = candidate.rule || stableId(candidate.action);
      candidates.push(Object.assign({
        id: stableId(`${input.person?.handle || input.person?.name || 'account'}|${rule}`),
        confidence: candidate.confidence || confidenceLabel(evidenceCount, confidence.complete),
        reviewAfterDays: candidate.reviewAfterDays || 14,
        score: isNumber(candidate.score) ? candidate.score : actionScore(candidate),
        evidence: (candidate.evidence || [candidate.why]).filter(Boolean),
        steps: (candidate.steps || []).filter(Boolean),
        primaryMetric: candidate.primaryMetric || null,
        targetValue: candidate.targetValue ?? null,
        expectedDirection: candidate.expectedDirection || 'up'
      }, candidate));
    };
    const finish = rows => rows.slice(0, MAX_ACTIONS).map((row, index) => Object.assign({ priority: index + 1 }, row));

    if (!confidence.complete) {
      add({
        rule: 'restore-measurement', category: 'Data recovery', score: 100, confidence: 'High',
        action: 'Keep the account active, but do not change strategy from this incomplete snapshot.',
        why: confidence.missing[0] || 'The full 30-day window was not verified.',
        evidence: confidence.missing,
        steps: ['Continue the existing content plan.', 'Do not treat old rankings as current.', 'Review after the next complete validated pull.'],
        successMetric: 'A complete validated 30-day window with no silently stale account data.',
        primaryMetric: 'dataCompleteness', targetValue: 1, evidenceCount: 0, reviewAfterDays: 4
      });
      return finish(candidates);
    }

    const posts = analytics.postsInWindow || 0;
    const comparable = analytics.comparablePosts || 0;
    const cadence = analytics.postsPerWeek;
    const engagement = analytics.interactionRate ?? analytics.observedInteractionRate;
    const viewEfficiency = analytics.viewEfficiency;
    const teamEngagement = block.teamBenchmarks?.interactionRate ?? team.engagement;
    const teamView = block.teamBenchmarks?.viewEfficiency ?? team.viewEfficiency;
    const pillar = strategy.strongestPillar;
    const format = strategy.strongestFormat;
    const silentDays = block.daysSinceLastPost;

    if (posts === 0) {
      add({
        rule: 'zero-post-baseline', category: 'Baseline recovery', score: 96,
        action: `Publish three measurable ${strategy.positioning.toLowerCase()} posts within 14 days.`,
        why: 'No posts were present in the complete 30-day window, so content performance cannot be evaluated.',
        evidence: ['0 posts in the verified 30-day window', `Strategy objective: ${strategy.objective}`],
        steps: [strategyHook(strategy), `Use ${strategySeries(strategy)} as the structure.`, `End with: “${strategy.conversionRoute}”.`],
        successMetric: 'Three public posts with supported likes and comments, including two Reels where practical.',
        primaryMetric: 'postsInWindow', targetValue: 3, evidenceCount: 0, reviewAfterDays: 14
      });
      return finish(candidates);
    }

    if (comparable < 3) add({
      rule: 'small-sample', category: 'Baseline experiment',
      action: `Use the next four posts to establish a reliable ${strategy.positioning.toLowerCase()} baseline.`,
      why: `${comparable} comparable post${comparable === 1 ? '' : 's'} are available; more evidence is required for a stable personal pattern.`,
      evidence: [`${comparable}/3 comparable posts`, `${posts} total posts in the window`],
      steps: [`Publish two posts using ${strategy.approach}.`, 'Publish two posts using a second practical format.', 'Keep audience and CTA constant so the comparison is measurable.'],
      successMetric: 'Four comparable posts and one clearly stronger topic or format pattern.',
      primaryMetric: 'comparablePosts', targetValue: 4, evidenceCount: comparable,
      urgency: 88, impact: 85, strategyFit: 90, feasibility: 82, reviewAfterDays: 14
    });

    for (const [index, action] of (block.nextActions || []).entries()) add(normalizeCoreAction(action, index, strategy, analytics));

    if (isNumber(silentDays) && silentDays >= 10) add({
      rule: 'long-gap', category: 'Consistency',
      action: `Publish one ${(strategy.strongestPillar?.label || strategy.positioning).toLowerCase()} post within 48 hours.`,
      why: `${silentDays} days have passed since the last post, which now outweighs smaller optimization opportunities.`,
      evidence: [`${silentDays}-day gap`, `${round(cadence, 1) ?? '—'} posts/week`],
      steps: [strategyHook(strategy), 'Use an already-researched topic rather than waiting for complex production.', `End with: “${strategy.conversionRoute}”.`],
      successMetric: 'Publish within 48 hours and keep the following gap below seven days.',
      primaryMetric: 'daysSinceLastPost', targetValue: 7, expectedDirection: 'down',
      evidenceCount: posts, urgency: 100, impact: 90, strategyFit: 90, feasibility: 92, reviewAfterDays: 7
    });

    if (isNumber(cadence) && cadence < strategy.weeklyCapacity * 0.8) add({
      rule: 'capacity-gap', category: 'Consistency',
      action: `Build a repeatable ${strategy.weeklyCapacity}-post weekly rhythm that fits this account’s strategy.`,
      why: `Current cadence is ${round(cadence, 1)} posts/week against a realistic ${strategy.weeklyCapacity}-post capacity.`,
      evidence: [`${round(cadence, 2)} current posts/week`, `${strategy.weeklyCapacity} planned posts/week`, `${posts} posts in 30 days`],
      steps: [`Reserve one recurring slot for ${strategySeries(strategy)}.`, 'Batch two pieces of research or filming.', 'Schedule the second post before publishing the first.'],
      successMetric: `Reach ${strategy.weeklyCapacity} posts/week without reducing interaction rate by more than 10%.`,
      primaryMetric: 'postsPerWeek', targetValue: strategy.weeklyCapacity, evidenceCount: posts,
      urgency: 75, impact: 86, strategyFit: 92, feasibility: 82, reviewAfterDays: 21
    });

    if (pillar && pillar.comparablePosts >= 2) add({
      rule: `pillar-${pillar.key}`, category: 'Content focus',
      action: `Make two of the next four posts ${pillar.label.toLowerCase()} content.`,
      why: `${pillar.label} is the strongest measurable personal pillar across ${pillar.comparablePosts} comparable posts.`,
      evidence: [`${pillar.comparablePosts} comparable posts`, `${Math.round((pillar.share || 0) * 100)}% of current output`, isNumber(pillar.medianRate) ? `${round(pillar.medianRate * 100, 2)}% median interaction rate` : null].filter(Boolean),
      steps: [strategyHook(strategy), `Turn the topic into ${strategySeries(strategy)}.`, `Keep the CTA consistent: ${strategy.conversionRoute}.`],
      successMetric: 'At least one of the two posts exceeds current personal median interaction rate.',
      primaryMetric: 'interactionRate', targetValue: isNumber(engagement) ? engagement * 1.05 : null,
      evidenceCount: pillar.comparablePosts, impact: 82, strategyFit: 98, feasibility: 85, reviewAfterDays: 14
    });
    else if (posts >= 3) add({
      rule: 'series-test', category: 'Strategy experiment',
      action: `Test ${strategySeries(strategy)} over the next three posts.`,
      why: 'No content pillar yet has enough repeated personal evidence to become a confident recommendation.',
      evidence: [`${posts} posts measured`, 'No pillar has two comparable posts with a stable median rate'],
      steps: [strategyHook(strategy), 'Keep the structure consistent across all three posts.', 'Change only the topic so the result can be compared fairly.'],
      successMetric: 'Three comparable posts and a repeatable pillar with a measurable median rate.',
      primaryMetric: 'comparablePosts', targetValue: Math.max(3, comparable + 2), evidenceCount: comparable,
      confidence: 'Experimental', strategyFit: 95, feasibility: 80, reviewAfterDays: 21
    });

    if (format && format.comparablePosts >= 2 && strategy.dominantFormat?.type !== format.type) add({
      rule: `format-${format.type}`, category: 'Format mix',
      action: `Use ${titleCase(format.type)} for at least two of the next four posts.`,
      why: `${titleCase(format.type)} has the strongest personal median interactions but is not the most-used format.`,
      evidence: [`${format.comparablePosts} comparable ${format.type} posts`, `${round(format.medianInteractions, 0)} median interactions`],
      steps: [`Keep the topic aligned with ${strategy.strongestPillar?.label?.toLowerCase() || strategy.approach}.`, strategyHook(strategy), 'Compare it with the current dominant format.'],
      successMetric: 'Both test posts should match or exceed current personal median interactions.',
      primaryMetric: 'medianInteractions', targetValue: format.medianInteractions, evidenceCount: format.comparablePosts,
      impact: 72, strategyFit: 82, feasibility: 78, reviewAfterDays: 14
    });

    if ((isNumber(teamEngagement) && isNumber(engagement) && engagement < teamEngagement)
      || (isNumber(performance.percentiles.engagement) && performance.percentiles.engagement < 40)) add({
      rule: 'engagement-gap', category: 'Content response',
      action: 'Rebuild the opening and interaction prompt on the next two posts.',
      why: isNumber(teamEngagement) && isNumber(engagement)
        ? `Personal interaction rate is ${round(engagement * 100, 2)}% versus a ${round(teamEngagement * 100, 2)}% team median.`
        : `The account sits in the ${performance.percentiles.engagement}th percentile for interaction efficiency.`,
      evidence: [isNumber(engagement) ? `${round(engagement * 100, 2)}% personal rate` : null, isNumber(teamEngagement) ? `${round(teamEngagement * 100, 2)}% team median` : null, `${comparable} comparable posts`].filter(Boolean),
      steps: [strategyHook(strategy), 'Remove any greeting or context that delays the main decision.', 'End with one direct question before the conversion CTA.'],
      successMetric: `Increase personal median interaction rate by 10%${isNumber(teamEngagement) ? ` or reach ${round(teamEngagement * 100, 2)}%` : ''}.`,
      primaryMetric: 'interactionRate', targetValue: isNumber(teamEngagement) ? teamEngagement : isNumber(engagement) ? engagement * 1.1 : null,
      evidenceCount: comparable, urgency: 70, impact: 88, strategyFit: 90, feasibility: 88, reviewAfterDays: 14
    });

    if ((isNumber(teamView) && isNumber(viewEfficiency) && viewEfficiency < teamView)
      || (isNumber(performance.percentiles.reach) && performance.percentiles.reach < 40)) add({
      rule: 'view-gap', category: 'Distribution',
      action: `Package the next two ${strategy.positioning.toLowerCase()} posts for discovery, not only existing followers.`,
      why: isNumber(teamView) && isNumber(viewEfficiency)
        ? `View efficiency is ${round(viewEfficiency, 2)}× followers versus a ${round(teamView, 2)}× team median.`
        : `The account sits in the ${performance.percentiles.reach}th percentile for view efficiency.`,
      evidence: [isNumber(viewEfficiency) ? `${round(viewEfficiency, 2)}× view efficiency` : null, isNumber(teamView) ? `${round(teamView, 2)}× team median` : null, `${analytics.viewsReporting || 0} videos reporting views`].filter(Boolean),
      steps: [strategyHook(strategy), 'Use a specific price, location, developer or buyer decision in the cover text.', 'Make the first visual understandable without sound.'],
      successMetric: `Increase median view efficiency by 15%${isNumber(teamView) ? ` or reach ${round(teamView, 2)}×` : ''}.`,
      primaryMetric: 'viewEfficiency', targetValue: isNumber(teamView) ? teamView : isNumber(viewEfficiency) ? viewEfficiency * 1.15 : null,
      evidenceCount: analytics.viewsReporting || 0, impact: 82, strategyFit: 88, feasibility: 82, reviewAfterDays: 14
    });

    if (mentions && (mentions.processedReels || 0) >= 2) {
      if ((mentions.developerShare || 0) === 0 && isNumber(team.developerShare) && /offplan|developer|investment|market/.test(strategy.key)) add({
        rule: 'developer-test', category: 'Developer coverage',
        action: 'Test one evidence-led developer comparison within the next four Reels.',
        why: `None of ${mentions.processedReels} processed Reels named a configured developer, while the team median share is ${round(team.developerShare * 100, 1)}%.`,
        evidence: [`0/${mentions.processedReels} Reels with a developer mention`, `${round(team.developerShare * 100, 1)}% team median share`],
        steps: ['Choose a developer relevant to the audience.', 'Compare delivery, price, payment plan and buyer fit.', `End with: “${strategy.conversionRoute}”.`],
        successMetric: 'One processed developer-led Reel compared against personal median views and interactions.',
        primaryMetric: 'developerShare', targetValue: 1 / Math.max(1, mentions.processedReels + 1),
        evidenceCount: mentions.processedReels, strategyFit: 90, feasibility: 80, reviewAfterDays: 14
      });
      else if (isNumber(team.developerDiversity) && (mentions.developerDiversity || 0) > 0 && mentions.developerDiversity < team.developerDiversity) add({
        rule: 'developer-diversity', category: 'Developer coverage',
        action: 'Add one different relevant developer to the next content cycle.',
        why: `${mentions.developerDiversity} developers are covered versus a team median of ${round(team.developerDiversity, 1)}.`,
        evidence: [`${mentions.developerDiversity} personal developers`, `${round(team.developerDiversity, 1)} team median`],
        steps: ['Select a developer matching the buyer segment.', 'Use a comparison rather than a purely promotional mention.', 'Measure whether it reaches a different audience.'],
        successMetric: 'Increase developer diversity by one while maintaining interaction rate.',
        primaryMetric: 'developerDiversity', targetValue: mentions.developerDiversity + 1,
        evidenceCount: mentions.processedReels, strategyFit: 75, feasibility: 85, reviewAfterDays: 21
      });
    }

    if (!candidates.length || (performance.strengths.length >= 2 && !performance.constraints.length)) add({
      rule: 'maintain', category: 'Maintain',
      action: `Protect the current rhythm and repeat the strongest ${(strategy.strongestPillar?.label || 'content').toLowerCase()} pattern.`,
      why: (block.cadence?.currentStreakWeeks || 0) >= 2
        ? `${block.cadence.currentStreakWeeks} consecutive measured weeks include at least one post, with no major weak dimension.`
        : 'No urgent underperformance signal exists; repeatability is more valuable than changing direction.',
      evidence: [(block.cadence?.currentStreakWeeks || 0) ? `${block.cadence.currentStreakWeeks}-week active streak` : null, strategy.strongestPillar ? `${strategy.strongestPillar.label} is the strongest observed pillar` : null].filter(Boolean),
      steps: [`Use ${strategySeries(strategy)} as the recurring structure.`, 'Change one variable at a time.', 'Retain the same audience and CTA.'],
      successMetric: 'Maintain or improve current cadence and interaction rate through the next validated window.',
      primaryMetric: 'interactionRate', targetValue: engagement, evidenceCount: Math.max(comparable, posts),
      strategyFit: 95, feasibility: 92, reviewAfterDays: 21
    });

    const selected = [];
    const categories = new Set();
    const signatures = new Set();
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      const signature = `${candidate.primaryMetric}|${candidate.action.toLowerCase().replace(/\d+(?:\.\d+)?/g, '#')}`;
      if (signatures.has(signature)) continue;
      if (categories.has(candidate.category) && selected.length < MAX_ACTIONS - 1) continue;
      signatures.add(signature);
      categories.add(candidate.category);
      selected.push(candidate);
      if (selected.length === MAX_ACTIONS) break;
    }
    return finish(selected);
  }

  function buildCoach(input = {}) {
    const strategy = deriveStrategy(input);
    const data = dataConfidence(input);
    const movement = movementAnalysis(input.points || []);
    const performance = performanceDiagnosis(input, strategy, data);
    const recommendations = buildRecommendations(input, strategy, data, performance);
    return {
      version: VERSION,
      strategy, data, movement, performance, recommendations,
      questions: [
        'Is my data complete and current?',
        'How am I performing?',
        'Why did my result improve or decline?',
        'What exactly should I do next?',
        'Did the recommended action actually work?'
      ],
      guarantee: 'The system guarantees a traceable measurement and review process, not a specific number of views, followers, leads or deals.'
    };
  }

  function evaluateAction(record, currentMetrics, currentSnapshotAt) {
    if (!record) return { verdict: 'Not tracked', tone: 'neutral', detail: 'No saved action exists.' };
    if (record.status !== 'completed') return {
      verdict: record.status === 'planned' ? 'Planned' : 'Not started', tone: 'neutral',
      detail: record.status === 'planned' ? 'Mark the action completed after implementation.' : 'Choose one action and mark it planned.'
    };
    if (!record.completedAtSnapshot || record.completedAtSnapshot === currentSnapshotAt) return {
      verdict: 'Measurement in progress', tone: 'watch',
      detail: 'The next validated snapshot is required before the result can be judged.'
    };
    const current = isNumber(currentMetrics?.[record.primaryMetric]) ? currentMetrics[record.primaryMetric] : null;
    const baseline = isNumber(record.baseline?.[record.primaryMetric]) ? record.baseline[record.primaryMetric] : null;
    if (!isNumber(current) || !isNumber(baseline)) return {
      verdict: 'Insufficient evidence', tone: 'watch',
      detail: `The ${record.primaryMetric || 'target'} metric is not available in both snapshots.`
    };
    const direction = record.expectedDirection || 'up';
    const delta = current - baseline;
    const relative = baseline ? delta / Math.abs(baseline) : null;
    const targetMet = isNumber(record.targetValue) && (direction === 'down' ? current <= record.targetValue : current >= record.targetValue);
    const improved = direction === 'down' ? delta < 0 : delta > 0;
    if (targetMet || (improved && (relative === null || Math.abs(relative) >= 0.05))) return {
      verdict: 'Worked', tone: 'healthy',
      detail: `${titleCase(record.primaryMetric)} moved from ${round(baseline, 4)} to ${round(current, 4)}${targetMet ? ' and reached the target' : ''}.`
    };
    if (improved) return {
      verdict: 'Partially worked', tone: 'watch',
      detail: `${titleCase(record.primaryMetric)} moved in the intended direction, but not enough to clear the success condition.`
    };
    return {
      verdict: 'Did not work yet', tone: 'attention',
      detail: `${titleCase(record.primaryMetric)} moved from ${round(baseline, 4)} to ${round(current, 4)}. Reassess execution before repeating it.`
    };
  }

  function formatNumber(value) {
    return isNumber(value) ? new Intl.NumberFormat('en', {
      notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1
    }).format(value) : '—';
  }
  const formatPct = value => isNumber(value) ? `${(value * 100).toFixed(Math.abs(value * 100) >= 10 ? 1 : 2)}%` : '—';
  const formatDate = value => Number.isFinite(Date.parse(value || ''))
    ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable';
  const formatDuration = hours => !isNumber(hours) ? '—' : hours < 48 ? `${round(hours, hours < 10 ? 1 : 0)}h` : `${round(hours / 24, 1)}d`;

  function browserGlobals() {
    return {
      data: typeof DATA !== 'undefined' ? DATA : null,
      registry: typeof REGISTRY !== 'undefined' ? REGISTRY : null,
      series: typeof SERIES !== 'undefined' ? SERIES : null,
      mentions: typeof MENTIONS !== 'undefined' ? MENTIONS : null
    };
  }

  function profilePointsFallback(series, registry, handle) {
    const key = `instagram::${String(handle || '').toLowerCase()}`;
    return (series?.profiles?.[key]?.points || []).filter(point => (
      point.validated === true && point.rosterVersion === registry?.rosterVersion
    ));
  }

  function browserContext(handle) {
    const globals = browserGlobals();
    if (!globals.data || !globals.registry) return null;
    let person = null;
    try { if (typeof rosterPeople === 'function') person = rosterPeople().find(item => item.handle === handle) || null; } catch (_) {}
    const employee = (globals.registry.employees || []).find(item => item.handles?.instagram === handle) || null;
    if (!person && employee) person = {
      name: employee.name, role: employee.role, handle,
      record: (globals.data.records || []).find(item => item.platform === 'instagram' && item.handle === handle) || null
    };
    if (!person) return null;
    let analytics = null;
    try { if (typeof analyticsForPerson === 'function') analytics = analyticsForPerson(person); } catch (_) {}
    analytics ||= (globals.data.leaderboards?.instagram?.analytics || []).find(row => row.handle === handle) || {};
    const block = (globals.data.people || []).find(row => row.handle === handle) || {};
    let points = [];
    try { if (typeof profilePoints === 'function') points = profilePoints(handle); } catch (_) {}
    if (!points.length) points = profilePointsFallback(globals.series, globals.registry, handle);
    const canonical = value => String(value || '').replace(/^@/, '').toLowerCase();
    const creator = (globals.mentions?.creators || []).find(row => canonical(row.handle) === canonical(handle)) || null;
    const creators = globals.mentions?.creators || [];
    return {
      person, employee, analytics, block, points, mentions: creator, meta: globals.data.meta || {},
      team: {
        engagement: globals.data.leaderboards?.instagram?.teamBenchmarks?.interactionRate ?? null,
        viewEfficiency: globals.data.leaderboards?.instagram?.teamBenchmarks?.viewEfficiency ?? null,
        developerShare: median(creators.map(row => row.developerShare)),
        developerDiversity: median(creators.map(row => row.developerDiversity))
      }
    };
  }

  function currentMetrics(context) {
    const a = context.analytics || {};
    return {
      dataCompleteness: a.windowComplete ? 1 : 0,
      followers: a.followers, postsInWindow: a.postsInWindow, comparablePosts: a.comparablePosts,
      postsPerWeek: a.postsPerWeek, interactionRate: a.interactionRate ?? a.observedInteractionRate,
      viewEfficiency: a.viewEfficiency, medianInteractions: a.medianInteractions,
      daysSinceLastPost: context.block?.daysSinceLastPost,
      developerShare: context.mentions?.developerShare,
      developerDiversity: context.mentions?.developerDiversity
    };
  }

  function loadTracking(handle) {
    if (typeof localStorage === 'undefined') return {};
    try { return (JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))[handle] || {}; }
    catch (_) { return {}; }
  }
  function saveTracking(handle, tracking) {
    if (typeof localStorage === 'undefined') return;
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      all[handle] = tracking;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  function metric(label, value, note) {
    return `<div class="coach-metric"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(note || '')}</small></div>`;
  }

  function fullSnapshot(context, coach) {
    const a = context.analytics || {};
    const b = context.block || {};
    const m = context.mentions || {};
    const followerChange = coach.movement.drivers.find(row => row.key === 'followers');
    const personalRate = a.interactionRate ?? a.observedInteractionRate;
    const commentRate = a.commentRate ?? a.observedCommentRate;
    const goals = b.goals?.goals || [];
    const bestTime = b.postingTime?.bestDay || b.postingTime?.bestBlock
      ? `${b.postingTime?.bestDay?.dayName || 'Day building'}${b.postingTime?.bestBlock?.blockLabel ? ` · ${b.postingTime.bestBlock.blockLabel}` : ''}`
      : 'Still building evidence';
    const score = isNumber(b.score?.value) ? `${Math.round(b.score.value * 100)}/100` : b.score?.held ? 'Held' : 'Building';
    return [
      metric('Data status', coach.data.status, `Captured ${formatDate(coach.data.capturedAt)}`),
      metric('Momentum', score, b.score?.rank ? `Team rank #${b.score.rank}` : (b.score?.eligibilityReasons || []).join(' · ')),
      metric('Followers', formatNumber(a.followers), followerChange ? `${followerChange.delta >= 0 ? '+' : ''}${formatNumber(followerChange.delta)} since prior capture` : 'Point-in-time public count'),
      metric('Following', formatNumber(a.following), 'Public profile count'),
      metric('Lifetime posts', formatNumber(a.lifetimePosts), 'Public profile count'),
      metric('30-day posts', formatNumber(a.postsInWindow), a.windowComplete ? 'Complete verified window' : 'Observed only'),
      metric('Publishing cadence', isNumber(a.postsPerWeek) ? `${round(a.postsPerWeek, 1)}/wk` : '—', 'Posts × 7 ÷ 30'),
      metric('Active days', formatNumber(a.activeDays), 'Distinct publishing dates'),
      metric('Median post gap', formatDuration(a.medianGapHours), 'Time between posts'),
      metric('Interaction rate', formatPct(personalRate), `${formatNumber(a.comparablePosts)} comparable posts`),
      metric('Comment rate', formatPct(commentRate), `${formatNumber(a.commentsReporting)} posts reporting`),
      metric('Median interactions', formatNumber(a.medianInteractions), 'Median likes + comments'),
      metric('Median likes', formatNumber(a.medianLikes), `${formatNumber(a.likesReporting)}/${formatNumber(a.metricCoverage?.posts)} reporting`),
      metric('Median comments', formatNumber(a.medianComments), `${formatNumber(a.commentsReporting)}/${formatNumber(a.metricCoverage?.posts)} reporting`),
      metric('Median video views', formatNumber(a.medianViews), `${formatNumber(a.viewsReporting)}/${formatNumber(a.metricCoverage?.videos)} videos reporting`),
      metric('View efficiency', isNumber(a.viewEfficiency) ? `${round(a.viewEfficiency, 2)}×` : '—', 'Median views ÷ followers'),
      metric('Comment-to-like ratio', formatPct(a.commentToLikeRatio), 'Median comments ÷ median likes'),
      metric('Total likes', formatNumber(a.totalLikes), 'Supported values only'),
      metric('Total comments', formatNumber(a.totalComments), 'Supported values only'),
      metric('Total video views', formatNumber(a.totalViews), 'Reporting videos only'),
      metric('Latest post', a.latestPostAt ? formatDate(a.latestPostAt) : 'No recent post', 'Relative activity evidence'),
      metric('Strongest pillar', coach.strategy.strongestPillar?.label || 'Building pattern', coach.strategy.strongestPillar ? `${coach.strategy.strongestPillar.comparablePosts} comparable posts` : 'Insufficient repeated evidence'),
      metric('Strongest format', coach.strategy.strongestFormat?.type ? titleCase(coach.strategy.strongestFormat.type) : 'Building pattern', coach.strategy.strongestFormat ? `${formatNumber(coach.strategy.strongestFormat.medianInteractions)} median interactions` : 'Insufficient repeated evidence'),
      metric('Best measured time', bestTime, 'Dubai time · personal pattern'),
      metric('Current streak', `${b.cadence?.currentStreakWeeks || 0} weeks`, `${b.cadence?.activeWeeks || 0}/${b.cadence?.weeksMeasured || 0} measured weeks active`),
      metric('Developer share', isNumber(m.developerShare) ? formatPct(m.developerShare) : 'Not processed', isNumber(m.processedReels) ? `${m.reelsWithDeveloperMention || 0}/${m.processedReels} processed Reels` : 'Audio intelligence pending'),
      metric('Developer diversity', isNumber(m.developerDiversity) ? formatNumber(m.developerDiversity) : '—', isNumber(m.totalDeveloperMentions) ? `${formatNumber(m.totalDeveloperMentions)} spoken mentions` : 'No audio total'),
      metric('Audio coverage', isNumber(m.processingCoverage) ? formatPct(m.processingCoverage) : '—', isNumber(m.totalReels) ? `${m.processedReels || 0}/${m.totalReels} Reels processed` : 'Not available'),
      metric('Goals', goals.length ? `${goals.filter(goal => goal.met === true).length}/${goals.filter(goal => goal.met !== null).length} met` : 'Not configured', 'Personal targets'),
      metric('Achievements', formatNumber((b.achievements || []).length), (b.achievements || []).map(item => item.label).join(' · ') || 'No current badge')
    ].join('');
  }

  function renderHero(context, coach) {
    const s = coach.strategy;
    return `<section class="coach-hero" id="kirpa-coach-hero">
      <div class="coach-hero-top"><div>
        <div class="coach-eyebrow">Personal account coach · ${esc(s.sourceLabel)}</div>
        <h3>${esc(coach.performance.diagnosis)}</h3>
        <p>${esc(s.summary)}</p>
      </div><div class="coach-data-badge ${esc(coach.data.tone)}"><b>${esc(coach.data.status)}</b><span>${esc(formatDate(coach.data.capturedAt))}</span></div></div>
      <details class="coach-full-snapshot" open>
        <summary>Full personal performance snapshot</summary>
        <div class="coach-snapshot-grid">${fullSnapshot(context, coach)}</div>
      </details>
      <div class="coach-strategy-card">
        <div><span>Positioning</span><b>${esc(s.positioning)}</b></div>
        <div><span>Objective</span><b>${esc(s.objective)}</b></div>
        <div><span>Audience</span><b>${esc(s.audience)}</b></div>
        <div><span>Approach</span><b>${esc(s.approach)}</b></div>
        <div><span>Practical capacity</span><b>${esc(`${s.weeklyCapacity} posts/week`)}</b></div>
        <div><span>Primary CTA</span><b>${esc(s.conversionRoute)}</b></div>
      </div>
      ${s.needsConfirmation ? `<p class="coach-confirmation">${esc(s.inferenceConfidence)}. Confirm this strategy when individual employee accounts are activated.</p>` : ''}
    </section>`;
  }

  function driverMarkup(driver) {
    const format = driver.key === 'engagementRate' ? formatPct
      : driver.key === 'postsPerWeek' ? value => `${round(value, 1)}/wk` : formatNumber;
    return `<li class="${esc(driver.direction)}"><b>${esc(driver.label)}</b><span>${esc(`${format(driver.from)} → ${format(driver.to)} · ${driver.delta >= 0 ? '+' : ''}${format(driver.delta)}`)}</span></li>`;
  }

  function actionMarkup(action, tracking) {
    const status = tracking[action.id]?.status || 'not-started';
    return `<article class="coach-action">
      <div class="coach-action-head"><span class="coach-priority">Priority ${action.priority}</span><span>${esc(action.category)}</span><span>${esc(action.confidence)} confidence</span></div>
      <h4>${esc(action.action)}</h4><p><b>Why:</b> ${esc(action.why)}</p>
      <details><summary>Evidence and execution</summary><div class="coach-action-detail">
        <div><b>Evidence</b><ul>${action.evidence.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>
        <div><b>Do this</b><ol>${action.steps.map(item => `<li>${esc(item)}</li>`).join('')}</ol></div>
      </div></details>
      <div class="coach-success"><b>Success condition</b><span>${esc(action.successMetric)}</span><small>Review after ${action.reviewAfterDays} days or the next validated snapshot.</small></div>
      <div class="coach-action-controls"><button type="button" data-coach-action="${esc(action.id)}" data-coach-status="planned" aria-pressed="${status === 'planned'}">${status === 'planned' ? 'Planned ✓' : 'Mark planned'}</button><button type="button" data-coach-action="${esc(action.id)}" data-coach-status="completed" aria-pressed="${status === 'completed'}">${status === 'completed' ? 'Completed ✓' : 'Mark completed'}</button></div>
    </article>`;
  }

  function reviewMarkup(tracking, metrics, snapshotAt) {
    const rows = Object.values(tracking || {});
    if (!rows.length) return '<div class="coach-empty-review"><b>No recommendation tracked yet.</b><span>Mark an action planned or completed. It can be evaluated only after a later validated snapshot.</span></div>';
    return `<div class="coach-review-list">${rows.sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '')).slice(0, 5).map(record => {
      const result = evaluateAction(record, metrics, snapshotAt);
      return `<article class="coach-review ${esc(result.tone)}"><div><span>${esc(record.status)}</span><b>${esc(record.action)}</b></div><strong>${esc(result.verdict)}</strong><p>${esc(result.detail)}</p></article>`;
    }).join('')}</div>`;
  }

  function renderJourney(context, coach, tracking) {
    const d = coach.data;
    const p = coach.performance;
    const metrics = currentMetrics(context);
    return `<section class="coach-journey" id="kirpa-coach-journey">
      <div class="coach-journey-head"><div><span>Personalized performance plan</span><h3>Five questions answered from this account’s own evidence</h3></div><p>${esc(coach.guarantee)}</p></div>
      <nav class="coach-question-nav">${coach.questions.map((question, index) => `<a href="#coach-question-${index + 1}"><span>${index + 1}</span>${esc(question)}</a>`).join('')}</nav>
      <div class="coach-questions">
        <article class="coach-question" id="coach-question-1"><div class="coach-question-number">1</div><div><h3>Is my data complete and current?</h3><div class="coach-answer-line"><b class="${esc(d.tone)}">${esc(d.status)}</b><span>${esc(d.nextStep)}</span></div><div class="coach-facts"><span>${formatNumber(d.posts)} posts measured</span><span>${formatNumber(d.comparablePosts)} comparable</span><span>${d.scoreEligible ? 'Momentum eligible' : 'Momentum held'}</span><span>Captured ${esc(formatDate(d.capturedAt))}</span></div>${d.missing.length ? `<details><summary>Open data limitations</summary><ul>${d.missing.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>` : '<p class="coach-positive">No material data limitation is blocking this account.</p>'}</div></article>
        <article class="coach-question" id="coach-question-2"><div class="coach-question-number">2</div><div><h3>How am I performing?</h3><p class="coach-diagnosis">${esc(p.diagnosis)}</p><div class="coach-columns"><div><b>Current strengths</b>${p.strengths.length ? `<ul>${p.strengths.map(item => `<li>${esc(`${titleCase(item.label)} · ${item.value}th percentile`)}</li>`).join('')}</ul>` : '<span>No high-confidence team strength yet.</span>'}</div><div><b>Primary constraint</b><strong>${esc(p.primaryConstraint)}</strong>${p.constraints.length ? `<ul>${p.constraints.map(item => `<li>${esc(`${titleCase(item.label)} · ${item.value}th percentile`)}</li>`).join('')}</ul>` : '<span>No severe comparison gap detected.</span>'}</div></div></div></article>
        <article class="coach-question" id="coach-question-3"><div class="coach-question-number">3</div><div><h3>Why did my result improve or decline?</h3><div class="coach-answer-line"><b>${esc(coach.movement.overall)}</b><span>${esc(coach.movement.note)}</span></div>${coach.movement.drivers.length ? `<ul class="coach-drivers">${coach.movement.drivers.map(driverMarkup).join('')}</ul>` : '<p class="coach-positive">A second validated capture is needed; this snapshot becomes the baseline.</p>'}</div></article>
        <article class="coach-question" id="coach-question-4"><div class="coach-question-number">4</div><div><h3>What exactly should I do next?</h3><p>Only the three highest-priority actions are shown. Each fits this account strategy and has evidence plus a measurable success condition.</p><div class="coach-actions">${coach.recommendations.map(action => actionMarkup(action, tracking)).join('')}</div></div></article>
        <article class="coach-question" id="coach-question-5"><div class="coach-question-number">5</div><div><h3>Did the recommended action actually work?</h3><p class="coach-storage-note">Preview tracking is stored only in this browser. Authenticated employee accounts must move this history to server-side storage.</p>${reviewMarkup(tracking, metrics, context.meta?.capturedAt)}</div></article>
      </div>
    </section>`;
  }

  const STYLE = `
    #kirpa-coach-hero *,#kirpa-coach-journey *{box-sizing:border-box}.coach-hero{margin-top:22px;padding:20px;border:1px solid var(--line,#e8ddd2);border-radius:18px;background:rgba(255,255,255,.94);box-shadow:0 12px 30px rgba(52,35,25,.08)}.coach-hero-top{display:flex;justify-content:space-between;gap:20px}.coach-eyebrow{color:var(--orange-deep,#b93614);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.coach-hero h3{margin:6px 0 0;font:700 clamp(19px,2.4vw,28px)/1.16 Manrope,system-ui,sans-serif;letter-spacing:-.03em}.coach-hero-top p{margin:8px 0 0;color:var(--dust,#796f68);font-size:12px}.coach-data-badge{min-width:190px;padding:11px 13px;border-radius:12px;background:#f4efe9}.coach-data-badge b,.coach-data-badge span{display:block}.coach-data-badge span{margin-top:3px;color:var(--dust,#796f68);font-size:9px}.coach-data-badge.healthy{background:rgba(45,128,98,.12)}.coach-data-badge.watch{background:rgba(168,107,20,.12)}.coach-data-badge.attention{background:rgba(169,69,69,.12)}.coach-full-snapshot{margin-top:16px}.coach-full-snapshot>summary{cursor:pointer;font-size:11px;font-weight:800}.coach-snapshot-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.coach-metric{min-height:91px;padding:11px;border:1px solid var(--line,#e8ddd2);border-radius:11px;background:#fff}.coach-metric span,.coach-metric b,.coach-metric small{display:block}.coach-metric span{color:var(--dust,#796f68);font-size:8px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.coach-metric b{margin-top:7px;font-size:15px;line-height:1.2}.coach-metric small{margin-top:5px;color:var(--dust,#796f68);font-size:8px;line-height:1.35}.coach-strategy-card{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;overflow:hidden;margin-top:10px;border:1px solid var(--line,#e8ddd2);border-radius:12px;background:var(--line,#e8ddd2)}.coach-strategy-card>div{min-height:72px;padding:11px;background:var(--paper-warm,#fbf7f2)}.coach-strategy-card span,.coach-strategy-card b{display:block}.coach-strategy-card span{color:var(--dust,#796f68);font-size:8px;font-weight:800;text-transform:uppercase}.coach-strategy-card b{margin-top:5px;font-size:10px;line-height:1.4}.coach-confirmation{margin:10px 0 0!important;padding:9px 11px;border-left:3px solid var(--amber,#a86b14);background:rgba(168,107,20,.08);font-size:10px!important}.coach-journey{margin:20px 0 30px}.coach-journey-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:12px}.coach-journey-head span{color:var(--orange-deep,#b93614);font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.coach-journey-head h3{margin:4px 0 0;font:400 23px/1.1 'DM Serif Display',Georgia,serif}.coach-journey-head p{max-width:390px;margin:0;color:var(--dust,#796f68);font-size:9px;text-align:right}.coach-question-nav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-bottom:10px}.coach-question-nav a{display:flex;align-items:center;gap:6px;min-height:48px;padding:8px;border:1px solid var(--line,#e8ddd2);border-radius:9px;background:#fff;color:var(--ink,#171717);font-size:8px;font-weight:700;line-height:1.25;text-decoration:none}.coach-question-nav a span{display:grid;place-items:center;width:21px;height:21px;flex:0 0 auto;border-radius:50%;background:var(--orange,#f15a29);color:#fff}.coach-questions{display:grid;gap:9px}.coach-question{display:grid;grid-template-columns:40px minmax(0,1fr);gap:12px;padding:16px;border:1px solid var(--line,#e8ddd2);border-radius:14px;background:#fff;scroll-margin-top:20px}.coach-question-number{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--ink,#171717);color:#fff;font-weight:800}.coach-question h3{margin:0 0 8px;font-size:16px}.coach-question p{margin:0 0 9px;color:var(--dust,#796f68);font-size:10px}.coach-answer-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.coach-answer-line b{padding:5px 8px;border-radius:999px;background:rgba(45,128,98,.12);font-size:9px}.coach-answer-line b.attention{background:rgba(169,69,69,.12);color:var(--crimson,#a94545)}.coach-answer-line b.watch{background:rgba(168,107,20,.12);color:var(--amber,#a86b14)}.coach-answer-line span{color:var(--dust,#796f68);font-size:9px}.coach-facts{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.coach-facts span{padding:5px 7px;border-radius:999px;background:var(--paper-warm,#fbf7f2);color:var(--dust,#796f68);font-size:8px}.coach-question summary{cursor:pointer;font-size:9px;font-weight:800}.coach-question li{margin:4px 0;color:var(--dust,#796f68);font-size:9px}.coach-positive{margin:9px 0 0!important;font-size:9px!important}.coach-diagnosis{padding:10px 12px;border-left:3px solid var(--orange,#f15a29);background:var(--paper-warm,#fbf7f2);color:var(--ink,#171717)!important;font-size:11px!important}.coach-columns{display:grid;grid-template-columns:1fr 1fr;gap:8px}.coach-columns>div{padding:10px;border-radius:9px;background:var(--paper-warm,#fbf7f2)}.coach-columns b,.coach-columns strong,.coach-columns span{display:block}.coach-columns strong{margin-top:6px;font-size:13px}.coach-columns span{margin-top:6px;color:var(--dust,#796f68);font-size:9px}.coach-columns ul{margin:6px 0 0;padding-left:16px}.coach-drivers{display:grid;gap:5px;margin:9px 0 0;padding:0;list-style:none}.coach-drivers li{display:flex;justify-content:space-between;gap:10px;margin:0;padding:8px 9px;border-radius:8px;background:var(--paper-warm,#fbf7f2)}.coach-drivers li.up{border-left:3px solid var(--emerald,#2d8062)}.coach-drivers li.down{border-left:3px solid var(--crimson,#a94545)}.coach-actions{display:grid;gap:8px;margin-top:11px}.coach-action{padding:13px;border:1px solid var(--line,#e8ddd2);border-radius:12px;background:var(--paper-warm,#fbf7f2)}.coach-action-head{display:flex;gap:5px;flex-wrap:wrap}.coach-action-head span{padding:4px 6px;border-radius:999px;background:#fff;color:var(--dust,#796f68);font-size:7px;font-weight:800;text-transform:uppercase}.coach-action-head .coach-priority{background:var(--orange,#f15a29);color:#fff}.coach-action h4{margin:9px 0 5px;font-size:13px}.coach-action-detail{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.coach-action-detail>div{padding:8px;border-radius:8px;background:#fff}.coach-action-detail ul,.coach-action-detail ol{margin:5px 0 0;padding-left:16px}.coach-success{display:grid;gap:3px;margin-top:9px;padding:8px 9px;border-radius:8px;background:#fff}.coach-success b{font-size:8px;text-transform:uppercase}.coach-success span{font-size:9px}.coach-success small{color:var(--dust,#796f68);font-size:7px}.coach-action-controls{display:flex;gap:6px;margin-top:8px}.coach-action-controls button{padding:7px 8px;border:1px solid var(--line,#e8ddd2);border-radius:8px;background:#fff;font-size:8px;font-weight:800;cursor:pointer}.coach-action-controls button[aria-pressed=true]{border-color:var(--orange,#f15a29);background:rgba(241,90,41,.1)}.coach-storage-note{font-size:8px!important}.coach-empty-review{display:grid;gap:4px;padding:11px;border-radius:9px;background:var(--paper-warm,#fbf7f2)}.coach-empty-review span{color:var(--dust,#796f68);font-size:9px}.coach-review-list{display:grid;gap:6px}.coach-review{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:9px;border-radius:9px;background:var(--paper-warm,#fbf7f2);border-left:3px solid var(--dust,#796f68)}.coach-review.healthy{border-color:var(--emerald,#2d8062)}.coach-review.watch{border-color:var(--amber,#a86b14)}.coach-review.attention{border-color:var(--crimson,#a94545)}.coach-review span,.coach-review b{display:block}.coach-review span{color:var(--dust,#796f68);font-size:7px;text-transform:uppercase}.coach-review b,.coach-review strong{font-size:9px}.coach-review p{grid-column:1/-1;margin:0;font-size:8px}.coach-storage-note{font-size:8px!important}@media(max-width:900px){.coach-snapshot-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.coach-question-nav{grid-template-columns:1fr}.coach-hero-top,.coach-journey-head{flex-direction:column;align-items:stretch}.coach-data-badge{min-width:0}.coach-journey-head p{text-align:left}}@media(max-width:620px){.coach-hero{padding:14px}.coach-snapshot-grid,.coach-strategy-card,.coach-columns,.coach-action-detail{grid-template-columns:1fr}.coach-question{grid-template-columns:1fr}.coach-review{grid-template-columns:1fr}.coach-review p{grid-column:auto}}

    /* KIRPA_EMPLOYEE_CONTRAST_GUARD_V1
     * The coach hero is injected inside the dark analytics header. Every light
     * surface therefore needs its own foreground colour rather than inheriting
     * white text from .analytics-hero.
     */
    #kirpa-coach-hero,
    #kirpa-coach-hero .coach-hero,
    #kirpa-coach-hero .coach-metric,
    #kirpa-coach-hero .coach-strategy-card > div,
    #kirpa-coach-hero .coach-data-badge,
    #kirpa-coach-hero .coach-confirmation,
    #kirpa-coach-journey,
    #kirpa-coach-journey .coach-question,
    #kirpa-coach-journey .coach-action,
    #kirpa-coach-journey .coach-action-detail > div,
    #kirpa-coach-journey .coach-success,
    #kirpa-coach-journey .coach-columns > div,
    #kirpa-coach-journey .coach-drivers li,
    #kirpa-coach-journey .coach-review,
    #kirpa-coach-journey .coach-empty-review {
      color: var(--ink, #171717);
    }
    #kirpa-coach-hero h3,
    #kirpa-coach-hero h4,
    #kirpa-coach-hero b,
    #kirpa-coach-hero strong,
    #kirpa-coach-hero summary,
    #kirpa-coach-hero p,
    #kirpa-coach-journey h3,
    #kirpa-coach-journey h4,
    #kirpa-coach-journey b,
    #kirpa-coach-journey strong,
    #kirpa-coach-journey summary {
      color: var(--ink, #171717);
    }
    #kirpa-coach-hero .coach-data-badge span,
    #kirpa-coach-hero .coach-metric span,
    #kirpa-coach-hero .coach-metric small,
    #kirpa-coach-hero .coach-strategy-card span {
      color: var(--dust, #796f68);
    }
    #kirpa-coach-journey .coach-question-number,
    #kirpa-coach-journey .coach-action-head .coach-priority {
      color: #fff;
    }

  `;

  let activeHandle = null;
  let observer = null;

  function removeLegacyActions(container) {
    for (const heading of container.querySelectorAll('.analytics-subhead')) {
      if (heading.textContent.trim().toLowerCase() !== 'what to do next') continue;
      const next = heading.nextElementSibling;
      heading.remove();
      if (next?.classList.contains('action-list')) next.remove();
    }
  }

  function mountCoach(handle) {
    const container = document.getElementById('analytics-content');
    if (!container || !handle || !container.querySelector('.analytics-hero')) return;
    const context = browserContext(handle);
    if (!context) return;
    const coach = buildCoach(context);
    const tracking = loadTracking(handle);
    container.querySelector('#kirpa-coach-hero')?.remove();
    container.querySelector('#kirpa-coach-journey')?.remove();
    removeLegacyActions(container);
    container.querySelector('.analytics-hero').insertAdjacentHTML('beforeend', renderHero(context, coach));
    const note = container.querySelector('.analytics-body .analytics-note');
    if (note) note.insertAdjacentHTML('afterend', renderJourney(context, coach, tracking));
  }

  function trackAction(handle, actionId, status) {
    const context = browserContext(handle);
    if (!context) return;
    const action = buildCoach(context).recommendations.find(item => item.id === actionId);
    if (!action) return;
    const tracking = loadTracking(handle);
    const prior = tracking[action.id] || {};
    const now = new Date().toISOString();
    tracking[action.id] = Object.assign({}, prior, {
      id: action.id, action: action.action, category: action.category,
      primaryMetric: action.primaryMetric, targetValue: action.targetValue,
      expectedDirection: action.expectedDirection, status,
      baseline: prior.baseline || currentMetrics(context),
      assignedAt: prior.assignedAt || now,
      assignedAtSnapshot: prior.assignedAtSnapshot || context.meta?.capturedAt || null,
      completedAt: status === 'completed' ? now : prior.completedAt || null,
      completedAtSnapshot: status === 'completed' ? context.meta?.capturedAt || null : prior.completedAtSnapshot || null,
      updatedAt: now
    });
    saveTracking(handle, tracking);
    mountCoach(handle);
  }

  function installBrowser() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('kirpa-personal-coach-style')) {
      const style = document.createElement('style');
      style.id = 'kirpa-personal-coach-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    document.addEventListener('click', event => {
      const analyticsButton = event.target.closest?.('[data-analytics-handle]');
      if (analyticsButton) activeHandle = analyticsButton.dataset.analyticsHandle;
      const actionButton = event.target.closest?.('[data-coach-action]');
      if (actionButton && activeHandle) trackAction(activeHandle, actionButton.dataset.coachAction, actionButton.dataset.coachStatus);
    }, true);
    const start = () => {
      const target = document.getElementById('analytics-content');
      if (!target || observer) return;
      observer = new MutationObserver(() => {
        if (!activeHandle || !target.querySelector('.analytics-hero') || target.querySelector('#kirpa-coach-hero')) return;
        if (target.dataset.coachMounting === 'true') return;
        target.dataset.coachMounting = 'true';
        try { mountCoach(activeHandle); } finally { delete target.dataset.coachMounting; }
      });
      observer.observe(target, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  return {
    VERSION, buildCoach, deriveStrategy, dataConfidence, movementAnalysis,
    performanceDiagnosis, buildRecommendations, evaluateAction, latestChange,
    installBrowser,
    _internal: { stableId, actionScore, roleArchetype, strategyHook, strategySeries, median }
  };
});
