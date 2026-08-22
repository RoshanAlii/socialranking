'use strict';

/*
 * Personal account coaching.
 *
 * The ranking engine answers how an account performed. This module turns the
 * same validated evidence into an account-specific strategy, diagnosis and
 * three measurable next actions. It never invents an employee objective: a
 * strategy is either declared in handles.json or explicitly labelled as an
 * inference from that person's own content, role and capacity.
 */

const R = require('./rank');
const C = require('./content');

const COACH_VERSION = 1;

const ARCHETYPES = {
  'baseline-building': {
    label: 'Baseline-building account',
    objective: 'Establish a reliable personal content baseline before optimising.',
    positioning: 'Dubai property advisor building a measurable repeatable presence.',
  },
  'investment-analyst': {
    label: 'Investment analyst',
    objective: 'Build decision-making authority and attract qualified investor conversations.',
    positioning: 'Evidence-led advisor comparing price, yield, supply, risk and exit potential.',
  },
  'property-walkthrough': {
    label: 'Property walkthrough creator',
    objective: 'Convert property access and visual inventory into qualified property interest.',
    positioning: 'Property advisor who helps buyers understand homes through clear visual tours.',
  },
  'area-specialist': {
    label: 'Area specialist',
    objective: 'Own a recognisable community or micro-market in the audience’s mind.',
    positioning: 'Local-market advisor explaining one area in depth and repeatedly.',
  },
  'developer-specialist': {
    label: 'Developer and project specialist',
    objective: 'Build authority around launches, developers and project selection.',
    positioning: 'Project specialist who explains developer choices rather than only promoting inventory.',
  },
  'buyer-educator': {
    label: 'Buyer educator',
    objective: 'Build trust by removing confusion and answering practical buyer questions.',
    positioning: 'Clear, useful advisor helping buyers make fewer mistakes.',
  },
  'relationship-builder': {
    label: 'Trust and relationship builder',
    objective: 'Turn personal familiarity into relevant property conversations and referrals.',
    positioning: 'Approachable advisor connecting personal trust with practical property expertise.',
  },
  'balanced-advisor': {
    label: 'Balanced property advisor',
    objective: 'Build consistent visibility while discovering the strongest repeatable content lane.',
    positioning: 'Dubai property advisor combining education, projects and personal trust.',
  },
};

const ARCHETYPE_ALIASES = {
  analyst: 'investment-analyst',
  analysis: 'investment-analyst',
  investment: 'investment-analyst',
  'investment-advisor': 'investment-analyst',
  walkthrough: 'property-walkthrough',
  tours: 'property-walkthrough',
  'property-showcase': 'property-walkthrough',
  area: 'area-specialist',
  community: 'area-specialist',
  developer: 'developer-specialist',
  project: 'developer-specialist',
  education: 'buyer-educator',
  educational: 'buyer-educator',
  trust: 'relationship-builder',
  personal: 'relationship-builder',
  lifestyle: 'relationship-builder',
  new: 'baseline-building',
  baseline: 'baseline-building',
  balanced: 'balanced-advisor',
};

const PILLAR_ARCHETYPES = {
  'investment-advice': 'investment-analyst',
  'market-update': 'investment-analyst',
  'property-showcase': 'property-walkthrough',
  'area-guide': 'area-specialist',
  'developer-news': 'developer-specialist',
  educational: 'buyer-educator',
  lifestyle: 'relationship-builder',
};

const COMPONENT_LABELS = {
  followers: 'follower context',
  engagementRate: 'engagement efficiency',
  postsPerWeek: 'publishing cadence',
  followerGrowth: 'follower growth',
};

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, places = 2) {
  if (!isNumber(value)) return null;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function pct(value, places = 2) {
  return isNumber(value) ? `${round(value * 100, places)}%` : 'unavailable';
}

function canonical(value) {
  return String(value || '').trim().toLowerCase().replace(/[ _]+/g, '-');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function strongest(rows, valueKey, minimum = 0) {
  return (rows || [])
    .filter(row => isNumber(row?.[valueKey]) && row[valueKey] >= minimum)
    .slice()
    .sort((a, b) => b[valueKey] - a[valueKey])[0] || null;
}

function normalizeArchetype(value) {
  const key = canonical(value);
  if (ARCHETYPES[key]) return key;
  return ARCHETYPE_ALIASES[key] || null;
}

function declaredStrategyOf(employee) {
  const value = employee?.accountStrategy || employee?.strategy || null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length ? value : null;
}

function rolePositioning(role) {
  const value = String(role || '').toLowerCase();
  if (value.includes('commercial')) return 'Commercial property specialist';
  if (value.includes('secondary')) return 'Ready and resale property advisor';
  if (value.includes('offplan') || value.includes('off-plan')) return 'Off-plan property advisor';
  if (value.includes('founder') || value.includes('managing director')) return 'Market authority and company leader';
  if (value.includes('team leader')) return 'Sales leader and property advisor';
  if (value.includes('content')) return 'Kirpa property-content specialist';
  return 'Dubai property advisor';
}

function observedStrategy(record, employee, context) {
  const days = context.days || R.WINDOW_DAYS;
  const now = context.now === undefined ? R.asOf([record]) : context.now;
  const complete = R.isUsable(record) && R.windowCoverage(record, now, days).complete;
  const posts = complete ? R.windowPosts(record, now, days) : [];
  const pillars = context.pillars || C.personContentPillars(record, now, days) || [];
  const formats = context.formats || (complete ? C.personFormatMix(record, now, days) : []);
  const dominantPillar = strongest(pillars, 'posts');
  const dominantFormat = strongest(formats, 'posts');
  const pillarShare = dominantPillar?.share || (posts.length && dominantPillar ? dominantPillar.posts / posts.length : null);

  let archetype = 'balanced-advisor';
  if (!complete || posts.length < 4) archetype = 'baseline-building';
  else if (dominantPillar && PILLAR_ARCHETYPES[dominantPillar.key]) {
    archetype = PILLAR_ARCHETYPES[dominantPillar.key];
  } else if (dominantFormat && ['reel', 'video'].includes(dominantFormat.type) && dominantFormat.share >= 0.7) {
    archetype = 'property-walkthrough';
  }

  const evidence = [];
  if (!complete) evidence.push('The 30-day post window is incomplete, so the strategy is provisional.');
  else evidence.push(`${posts.length} posts were available in the complete ${days}-day window.`);
  if (dominantPillar) evidence.push(`${dominantPillar.label} is ${Math.round((pillarShare || 0) * 100)}% of current output.`);
  if (dominantFormat) evidence.push(`${dominantFormat.type} is the most-used measured format with ${dominantFormat.posts} posts.`);
  if (employee?.role) evidence.push(`Role context: ${employee.role}.`);

  const confidence = complete && posts.length >= 8 && pillarShare >= 0.4
    ? 'high'
    : complete && posts.length >= 4
      ? 'medium'
      : 'experimental';

  return {
    archetype,
    complete,
    posts,
    pillars,
    formats,
    dominantPillar,
    dominantFormat,
    pillarShare,
    evidence,
    confidence,
  };
}

function inferAccountStrategy(record, employee = {}, context = {}) {
  const observed = observedStrategy(record, employee, context);
  const declared = declaredStrategyOf(employee);
  const declaredArchetype = normalizeArchetype(
    declared?.primaryArchetype || declared?.archetype || declared?.type,
  );
  const archetype = declaredArchetype || observed.archetype;
  const meta = ARCHETYPES[archetype] || ARCHETYPES['balanced-advisor'];
  const declaredCapacity = declared?.contentCapacityPerWeek ?? declared?.postsPerWeek ?? declared?.weeklyCapacity;
  const targetCapacity = employee?.targets?.postsPerWeek ?? context.targets?.postsPerWeek;
  const capacityPerWeek = isNumber(declaredCapacity) && declaredCapacity > 0
    ? declaredCapacity
    : isNumber(targetCapacity) && targetCapacity > 0
      ? targetCapacity
      : 3;
  const preferredFormats = unique(
    Array.isArray(declared?.preferredFormats)
      ? declared.preferredFormats.map(value => canonical(value))
      : observed.dominantFormat?.type ? [observed.dominantFormat.type] : [],
  );

  return {
    source: declared ? 'declared' : 'inferred',
    confirmationRequired: !declared,
    archetype,
    label: meta.label,
    objective: declared?.primaryObjective || declared?.objective || meta.objective,
    positioning: declared?.positioning || `${rolePositioning(employee?.role || record?.role)} · ${meta.positioning}`,
    audience: declared?.targetAudience || declared?.audience || null,
    markets: Array.isArray(declared?.markets) ? declared.markets : [],
    languages: Array.isArray(declared?.languages) ? declared.languages : [],
    capacityPerWeek,
    preferredFormats,
    primaryCta: declared?.primaryCta || declared?.conversionRoute || null,
    boundaries: Array.isArray(declared?.boundaries) ? declared.boundaries : [],
    confidence: declared ? 'declared' : observed.confidence,
    evidence: observed.evidence,
    observed: {
      dominantPillar: observed.dominantPillar ? {
        key: observed.dominantPillar.key,
        label: observed.dominantPillar.label,
        posts: observed.dominantPillar.posts,
        share: observed.dominantPillar.share,
        medianRate: observed.dominantPillar.medianRate,
        comparablePosts: observed.dominantPillar.comparablePosts,
      } : null,
      dominantFormat: observed.dominantFormat ? {
        type: observed.dominantFormat.type,
        posts: observed.dominantFormat.posts,
        share: observed.dominantFormat.share,
        medianRate: observed.dominantFormat.medianRate,
        ratedPosts: observed.dominantFormat.ratedPosts,
      } : null,
      posts: observed.posts.length,
      windowComplete: observed.complete,
    },
  };
}

function buildDiagnosis(record, strategy, context = {}) {
  const days = context.days || R.WINDOW_DAYS;
  const now = context.now === undefined ? R.asOf([record]) : context.now;
  const coverage = R.windowCoverage(record, now, days);
  const analytics = context.analytics || {};
  const pillars = context.pillars || C.personContentPillars(record, now, days) || [];
  const posts = coverage.complete ? R.windowPosts(record, now, days) : [];
  const silentDays = isNumber(context.daysSinceLastPost)
    ? context.daysSinceLastPost
    : C.daysSinceLastPost(record, now, days);
  const team = context.teamBenchmarks || {};
  const cadenceMedian = isNumber(team.postsPerWeek) ? team.postsPerWeek : context.benchmarks?.cadence;
  const engagementMedian = isNumber(team.interactionRate) ? team.interactionRate : context.benchmarks?.engagement;
  const viewMedian = team.viewEfficiency;
  const cadence = analytics.postsPerWeek;
  const engagement = analytics.interactionRate ?? analytics.observedInteractionRate;
  const views = analytics.viewEfficiency;
  const ratedPillars = pillars.filter(row => row.comparablePosts >= 2 && isNumber(row.medianRate));
  const bestPillar = strongest(ratedPillars, 'medianRate');
  const dominantPillar = strongest(pillars, 'posts');
  const pillarLift = bestPillar && dominantPillar && isNumber(dominantPillar.medianRate) && dominantPillar.medianRate > 0
    ? bestPillar.medianRate / dominantPillar.medianRate
    : null;

  const result = (key, label, summary, evidence, confidence, priority) => ({
    key, label, summary, evidence: unique(evidence), confidence, priority,
  });

  if (!coverage.complete) {
    return result(
      'data-confidence',
      'Data confidence is the first constraint',
      'A complete current window is required before content advice can be treated as reliable.',
      [coverage.reason, 'Performance comparisons and optimisation recommendations are held.'],
      'high',
      1,
    );
  }
  if (posts.length === 0) {
    return result(
      'inactivity',
      'Activity is the first constraint',
      `There are no posts in the verified ${days}-day window, so the account cannot yet reveal a winning pattern.`,
      [`0 posts in ${days} days.`, 'Engagement and content-fit comparisons cannot be calculated.'],
      'high',
      1,
    );
  }
  if (posts.length < 3) {
    return result(
      'measurement-base',
      'The sample is too small to optimise confidently',
      'The account needs a small structured publishing baseline before changing strategy.',
      [`${posts.length} measured post${posts.length === 1 ? '' : 's'} in ${days} days.`, 'Three supported posts are required for the team engagement comparison.'],
      'high',
      1,
    );
  }
  if (isNumber(silentDays) && silentDays >= 10) {
    return result(
      'recency-gap',
      'A long publishing gap is interrupting momentum',
      'The immediate priority is to restart the account without abandoning its strongest content lane.',
      [`Last measured post was ${silentDays} days before the snapshot.`, `${posts.length} posts were published in the window.`],
      'high',
      1,
    );
  }
  if (isNumber(cadence) && cadence < strategy.capacityPerWeek * 0.75) {
    return result(
      'cadence',
      'Consistency is the primary constraint',
      'The account’s measured output is below its declared or assigned capacity, so increasing complexity would be counterproductive.',
      [`Current cadence ${round(cadence, 2)}/week.`, `Strategy capacity ${round(strategy.capacityPerWeek, 2)}/week.`],
      'high',
      2,
    );
  }
  if (isNumber(views) && isNumber(viewMedian) && views < viewMedian * 0.8 && isNumber(engagement) && isNumber(engagementMedian) && engagement >= engagementMedian) {
    return result(
      'reach',
      'Content quality is stronger than content discovery',
      'People who see the content respond, but the typical video is not travelling as far as the team benchmark.',
      [`View efficiency ${round(views, 2)}× versus team median ${round(viewMedian, 2)}×.`, `Interaction rate ${pct(engagement)} versus team median ${pct(engagementMedian)}.`],
      'medium',
      2,
    );
  }
  if (isNumber(engagement) && isNumber(engagementMedian) && engagement < engagementMedian * 0.8 && isNumber(views) && isNumber(viewMedian) && views >= viewMedian) {
    return result(
      'interaction',
      'Reach is not converting into enough public response',
      'The account is earning distribution, but the opening, point of view or call to action is not creating proportional interaction.',
      [`View efficiency ${round(views, 2)}× versus team median ${round(viewMedian, 2)}×.`, `Interaction rate ${pct(engagement)} versus team median ${pct(engagementMedian)}.`],
      'medium',
      2,
    );
  }
  if (isNumber(engagement) && isNumber(engagementMedian) && engagement < engagementMedian * 0.8 && isNumber(views) && isNumber(viewMedian) && views < viewMedian * 0.8) {
    return result(
      'content-fit',
      'The current content pattern needs a controlled reset',
      'Both discovery and audience response are below the current team benchmark, so changing only posting frequency is unlikely to solve the issue.',
      [`Interaction rate ${pct(engagement)}.`, `View efficiency ${round(views, 2)}×.`],
      'medium',
      2,
    );
  }
  if (bestPillar && dominantPillar && bestPillar.key !== dominantPillar.key && isNumber(pillarLift) && pillarLift >= 1.25) {
    return result(
      'mix-misalignment',
      'The strongest topic is underused',
      `${bestPillar.label} is outperforming the account’s most-used topic and deserves a larger share of the next content cycle.`,
      [`${bestPillar.label}: ${bestPillar.comparablePosts} comparable posts.`, `${round(pillarLift, 2)}× the typical interaction rate of ${dominantPillar.label}.`],
      'medium',
      3,
    );
  }
  if (isNumber(context.score?.components?.followerGrowth) && context.score.components.followerGrowth < 0) {
    return result(
      'audience-growth',
      'Current content is not translating into audience growth',
      'The account should turn its strongest topic into a recognisable repeatable series before adding more topics.',
      [`Weekly-equivalent follower growth ${pct(context.score.components.followerGrowth)}.`, dominantPillar ? `${dominantPillar.label} is the largest current pillar.` : null],
      'medium',
      3,
    );
  }
  return result(
    'scale-strength',
    'The account has no critical performance failure',
    'The priority is to protect the strongest proven pattern, improve conversion discipline and test one change at a time.',
    [
      isNumber(cadence) ? `${round(cadence, 2)} posts/week.` : null,
      isNumber(engagement) ? `${pct(engagement)} personal interaction rate.` : null,
      bestPillar ? `${bestPillar.label} is the strongest measured pillar.` : null,
    ],
    posts.length >= 6 ? 'high' : 'medium',
    4,
  );
}

function recommendationConfidence(value) {
  if (value >= 78) return 'high';
  if (value >= 58) return 'medium';
  return 'experimental';
}

function addCandidate(list, candidate) {
  const dimensions = Object.assign({
    strategicRelevance: 70,
    expectedImpact: 65,
    evidenceConfidence: 55,
    feasibility: 75,
    urgency: 50,
  }, candidate.dimensions || {});
  const score = round(
    dimensions.strategicRelevance * 0.30 +
    dimensions.expectedImpact * 0.25 +
    dimensions.evidenceConfidence * 0.20 +
    dimensions.feasibility * 0.15 +
    dimensions.urgency * 0.10,
    1,
  );
  list.push({
    category: candidate.category || 'Improve',
    priority: candidate.priority || 3,
    score,
    confidence: candidate.confidence || recommendationConfidence(dimensions.evidenceConfidence),
    action: candidate.action,
    because: candidate.because,
    instructions: unique(candidate.instructions || []),
    successMetric: candidate.successMetric || 'Compare the completed posts with this account’s current personal baseline.',
    deadline: candidate.deadline || 'Within 7 days',
    reviewAfter: candidate.reviewAfter || 'Review 7 days after the final recommended post',
    evidence: unique(candidate.evidence || []),
    dimensions,
  });
}

function genericInstructions(action) {
  const text = String(action || '').toLowerCase();
  if (text.includes('post in the next')) return ['Use the strongest measured pillar.', 'Keep production simple enough to publish on time.', 'Use one clear property decision or buyer question.'];
  if (text.includes('hook') || text.includes('question')) return ['State the buyer decision in the opening sentence.', 'Make one defensible point instead of listing many features.', 'End with one direct question or trackable DM prompt.'];
  if (text.includes('developer')) return ['Choose one developer relevant to current inventory.', 'Explain the buyer fit and one material risk.', 'Use the same call to action so results remain comparable.'];
  if (text.includes('rhythm') || text.includes('post')) return ['Schedule the posts before the week begins.', 'Batch filming or research where practical.', 'Do not add extra formats until the rhythm is achieved.'];
  return ['Keep the test to one deliberate change.', 'Use the same measurement window and personal baseline.', 'Record what was published so the next snapshot can evaluate it.'];
}

function archetypeCandidate(strategy, analytics, diagnosis, observed, context) {
  const medianView = isNumber(analytics.viewEfficiency) ? `${round(analytics.viewEfficiency, 2)}×` : null;
  const medianRate = isNumber(analytics.interactionRate ?? analytics.observedInteractionRate)
    ? pct(analytics.interactionRate ?? analytics.observedInteractionRate)
    : null;
  const bestPillar = strongest((context.pillars || []).filter(row => row.comparablePosts >= 2), 'medianRate');
  const capacity = Math.max(1, Math.round(strategy.capacityPerWeek));
  const common = {
    category: strategy.archetype === 'baseline-building' ? 'Experiment' : 'Improve',
    priority: diagnosis.priority,
    dimensions: {
      strategicRelevance: 95,
      expectedImpact: 78,
      evidenceConfidence: strategy.source === 'declared' ? 75 : strategy.confidence === 'high' ? 78 : strategy.confidence === 'medium' ? 64 : 42,
      feasibility: 82,
      urgency: diagnosis.priority <= 2 ? 82 : 58,
    },
  };

  switch (strategy.archetype) {
    case 'baseline-building':
      return Object.assign({}, common, {
        category: 'Experiment',
        action: 'Run a six-post baseline experiment before optimising the account.',
        because: 'The current sample cannot yet distinguish a repeatable strength from a one-post result.',
        instructions: [
          'Publish two buyer-education posts.',
          'Publish two property or project explainers.',
          'Publish two posts in the format you can sustain most easily.',
          'Keep the call to action consistent across all six posts.',
        ],
        successMetric: 'Complete six measured posts and identify at least one format or pillar with two comparable results.',
        deadline: `Within ${capacity >= 3 ? 14 : 21} days`,
        reviewAfter: 'Review after the sixth post has had 7 days to collect public results',
      });
    case 'investment-analyst':
      return Object.assign({}, common, {
        action: 'Turn the next content cycle into a repeatable property-decision series.',
        because: bestPillar
          ? `${bestPillar.label} is the strongest measured account pillar across ${bestPillar.comparablePosts} comparable posts.`
          : 'The account’s observed positioning is analytical, so the recommendation should reinforce decision authority rather than chase unrelated formats.',
        instructions: [
          'Frame each post around one investment decision.',
          'Compare price, yield, future supply, material risk and exit route.',
          'State one clear conclusion rather than leaving every option equal.',
          'Use one consistent DM prompt for the supporting analysis.',
        ],
        successMetric: `Publish two decision-led posts; at least one should exceed ${medianView ? `the current ${medianView} view-efficiency baseline` : medianRate ? `the current ${medianRate} interaction-rate baseline` : 'the account’s current personal median'}.`,
      });
    case 'property-walkthrough':
      return Object.assign({}, common, {
        action: 'Test two walkthroughs with the buyer decision stated in the first three seconds.',
        because: 'The account is visually led; the highest-leverage change is improving how quickly the property, price and buyer fit become clear.',
        instructions: [
          'Open with location, price and the most distinctive feature.',
          'Show the strongest visual proof before a long introduction.',
          'Name who the property is and is not suitable for.',
          'End with one property-specific DM prompt.',
        ],
        successMetric: `At least one test should exceed ${medianView ? `the ${medianView} personal view-efficiency baseline` : 'the current median video result'}.`,
      });
    case 'area-specialist':
      return Object.assign({}, common, {
        action: 'Publish a four-part series on one priority community.',
        because: 'Area authority is built through repeated useful coverage, not isolated mentions of many locations.',
        instructions: [
          'Part 1: current entry prices and transaction reality.',
          'Part 2: rental demand and realistic yield.',
          'Part 3: future supply and material risks.',
          'Part 4: which buyer profile fits the area.',
        ],
        successMetric: 'Complete all four posts and compare their median interaction and view efficiency with the rest of the account.',
        deadline: 'Within 14 days',
        reviewAfter: 'Review 7 days after part four',
      });
    case 'developer-specialist':
      return Object.assign({}, common, {
        action: 'Build the next two developer posts around selection criteria, not promotion alone.',
        because: 'Developer authority becomes useful when the audience understands buyer fit, delivery evidence and trade-offs.',
        instructions: [
          'Explain one reason to consider the developer.',
          'Explain one material limitation or buyer mismatch.',
          'Compare the project with one credible alternative.',
          'Use the same developer-inquiry call to action.',
        ],
        successMetric: `At least one post should exceed ${medianRate ? `the ${medianRate} personal interaction-rate baseline` : 'the current personal median interaction result'}.`,
      });
    case 'buyer-educator':
      return Object.assign({}, common, {
        action: 'Create a three-post buyer-question series using questions already heard in sales conversations.',
        because: 'The account’s strongest positioning is clarity and usefulness, so recommendations should deepen that authority.',
        instructions: [
          'Use one real buyer question per post.',
          'Answer it in a clear sequence without jargon.',
          'Include one mistake or risk buyers should avoid.',
          'End by asking viewers which decision they are facing.',
        ],
        successMetric: `The three-post series should match or exceed ${medianRate ? `the ${medianRate} personal interaction-rate baseline` : 'the current median interaction result'}.`,
        deadline: 'Within 14 days',
        reviewAfter: 'Review 7 days after the third post',
      });
    case 'relationship-builder':
      return Object.assign({}, common, {
        action: 'Connect personal trust content to one practical property decision in the next three posts.',
        because: 'Personal familiarity is valuable only when viewers can also understand the advisor’s property expertise and next step.',
        instructions: [
          'Keep the personal context brief and natural.',
          'Link it to one buyer, seller or investor decision.',
          'Include one proof point from current market work.',
          'Use one clear conversation prompt.',
        ],
        successMetric: `At least two of the three posts should exceed ${medianRate ? `the ${medianRate} personal interaction-rate baseline` : 'the account’s current interaction median'}.`,
      });
    default:
      return Object.assign({}, common, {
        category: 'Experiment',
        action: bestPillar
          ? `Make two of the next four posts ${bestPillar.label.toLowerCase()} content.`
          : 'Run one controlled four-post content cycle around a single buyer problem.',
        because: bestPillar
          ? `${bestPillar.label} is currently the strongest measured pillar, but the account does not yet have one confirmed strategic lane.`
          : 'A controlled cycle will reveal a stronger repeatable lane without forcing a premature account identity.',
        instructions: [
          'Keep one audience and one property problem consistent.',
          'Use two posts in the strongest current format.',
          'Test one adjacent format without changing the topic.',
          'Use the same call to action across the cycle.',
        ],
        successMetric: 'Identify one repeatable topic-format combination that beats the account’s current personal median twice.',
        deadline: 'Within 14 days',
        reviewAfter: 'Review 7 days after the fourth post',
      });
  }
}

function buildRecommendations(record, employee, strategy, diagnosis, context = {}) {
  const list = [];
  const analytics = context.analytics || {};
  const days = context.days || R.WINDOW_DAYS;
  const now = context.now === undefined ? R.asOf([record]) : context.now;
  const coverage = R.windowCoverage(record, now, days);
  const posts = coverage.complete ? R.windowPosts(record, now, days) : [];
  const pillars = context.pillars || C.personContentPillars(record, now, days) || [];
  const formats = context.formats || (coverage.complete ? C.personFormatMix(record, now, days) : []);
  const bestPillar = strongest(pillars.filter(row => row.comparablePosts >= 2), 'medianRate');
  const bestFormat = strongest(formats.filter(row => row.ratedPosts >= 2), 'medianRate');
  const capacity = Math.max(1, Math.round(strategy.capacityPerWeek));

  if (!coverage.complete) {
    addCandidate(list, {
      category: 'Recover',
      priority: 1,
      action: 'Restore a complete verified account pull before changing content strategy.',
      because: coverage.reason,
      instructions: ['Confirm the public handle still resolves.', 'Retry the complete date-bounded posts query.', 'Do not treat the previous score as a current result.'],
      successMetric: `A validated ${days}-day window with every measured post tied to this account.`,
      deadline: 'Before the next recommendation cycle',
      reviewAfter: 'Review immediately after the next successful snapshot',
      dimensions: { strategicRelevance: 100, expectedImpact: 100, evidenceConfidence: 100, feasibility: 90, urgency: 100 },
    });
    return list;
  }

  if (posts.length === 0) {
    addCandidate(list, {
      category: 'Recover',
      priority: 1,
      action: 'Publish one strategically relevant post within 48 hours.',
      because: `No posts were measured in the last ${days} days.`,
      instructions: ['Use the simplest sustainable format.', 'Address one buyer decision linked to the account strategy.', 'Use one clear conversation prompt.'],
      successMetric: 'One verified post enters the next snapshot and establishes a fresh activity point.',
      deadline: 'Within 48 hours',
      reviewAfter: 'Review after the post has had 7 days to collect public results',
      dimensions: { strategicRelevance: 100, expectedImpact: 95, evidenceConfidence: 100, feasibility: 95, urgency: 100 },
    });
  }

  for (const action of context.existingActions || []) {
    addCandidate(list, {
      category: /re-enter|restart|next 48 hours/i.test(action.action) ? 'Recover' : /protect|hold|repeat/i.test(action.action) ? 'Maintain' : /try|test/i.test(action.action) ? 'Experiment' : 'Improve',
      priority: action.priority || 3,
      action: action.action,
      because: action.because,
      instructions: genericInstructions(action.action),
      successMetric: /week|rhythm|cadence|post/i.test(action.action)
        ? `Reach or move toward ${round(strategy.capacityPerWeek, 1)} sustainable posts per week without reducing the current personal interaction baseline.`
        : 'The tested posts should beat the account’s current personal median on the metric named in the evidence.',
      deadline: action.priority <= 1 ? 'Within 48 hours' : 'Within 7 days',
      dimensions: {
        strategicRelevance: 78,
        expectedImpact: action.priority <= 2 ? 82 : 68,
        evidenceConfidence: 78,
        feasibility: 82,
        urgency: action.priority <= 2 ? 88 : 55,
      },
    });
  }

  if (posts.length > 0) {
    addCandidate(list, archetypeCandidate(strategy, analytics, diagnosis, { posts }, {
      pillars, formats, employee, bestPillar, bestFormat,
    }));
  }

  if (bestPillar && bestPillar.comparablePosts >= 2) {
    addCandidate(list, {
      category: 'Maintain',
      priority: 3,
      action: `Protect ${bestPillar.label.toLowerCase()} as a recurring content pillar.`,
      because: `${bestPillar.label} has the highest measured personal interaction rate across ${bestPillar.comparablePosts} comparable posts.`,
      instructions: [`Reserve at least ${Math.min(2, capacity)} slot${Math.min(2, capacity) === 1 ? '' : 's'} in the next content cycle for this pillar.`, 'Repeat the decision structure, not the exact caption.', 'Keep one consistent call to action.'],
      successMetric: `The next two ${bestPillar.label.toLowerCase()} posts should match or exceed the pillar’s current ${pct(bestPillar.medianRate)} median interaction rate.`,
      dimensions: { strategicRelevance: 88, expectedImpact: 74, evidenceConfidence: bestPillar.comparablePosts >= 4 ? 82 : 62, feasibility: 88, urgency: 48 },
    });
  }

  if (bestFormat && bestFormat.ratedPosts >= 2) {
    const formatShare = bestFormat.share || 0;
    if (formatShare < 0.6) {
      addCandidate(list, {
        category: 'Improve',
        priority: 4,
        action: `Increase the next-cycle share of ${bestFormat.type}s without increasing total workload.`,
        because: `${bestFormat.type}s have the strongest measured personal interaction rate across ${bestFormat.ratedPosts} rated posts but represent only ${Math.round(formatShare * 100)}% of output.`,
        instructions: [`Convert one planned post into a ${bestFormat.type}.`, 'Keep the topic and call to action comparable.', 'Do not change cadence and format simultaneously.'],
        successMetric: `The additional ${bestFormat.type} should match or exceed the format’s current personal median interaction rate.`,
        dimensions: { strategicRelevance: 72, expectedImpact: 66, evidenceConfidence: bestFormat.ratedPosts >= 4 ? 78 : 58, feasibility: 74, urgency: 40 },
      });
    }
  }

  if (diagnosis.key === 'cadence' && isNumber(analytics.postsPerWeek)) {
    const extraFourWeeks = Math.max(1, Math.ceil((strategy.capacityPerWeek - analytics.postsPerWeek) * 4));
    addCandidate(list, {
      category: 'Improve',
      priority: 1,
      action: `Schedule ${extraFourWeeks} additional post${extraFourWeeks === 1 ? '' : 's'} across the next four weeks.`,
      because: `${round(analytics.postsPerWeek, 2)}/week is below the ${round(strategy.capacityPerWeek, 2)}/week strategy capacity.`,
      instructions: ['Set all publishing dates before the week begins.', 'Batch one repeatable content format.', 'Use the strongest current pillar for the added slots.'],
      successMetric: `Reach ${round(strategy.capacityPerWeek, 1)} posts/week in the next complete measurement window.`,
      deadline: 'Begin this week',
      reviewAfter: 'Review at the next 30-day snapshot',
      dimensions: { strategicRelevance: 100, expectedImpact: 88, evidenceConfidence: 95, feasibility: 78, urgency: 88 },
    });
  }

  if (diagnosis.key === 'reach') {
    addCandidate(list, {
      category: 'Experiment',
      priority: 1,
      action: 'Run two discovery-led openings without changing the underlying topic.',
      because: diagnosis.evidence.join(' '),
      instructions: ['State location, price or buyer decision immediately.', 'Remove greetings before the core value.', 'Use the strongest visual or numerical proof in the first three seconds.', 'Keep the call to action unchanged.'],
      successMetric: `At least one test should exceed the current ${round(analytics.viewEfficiency, 2)}× personal view-efficiency baseline.`,
      dimensions: { strategicRelevance: 92, expectedImpact: 88, evidenceConfidence: 78, feasibility: 85, urgency: 72 },
    });
  }

  if (diagnosis.key === 'interaction') {
    addCandidate(list, {
      category: 'Improve',
      priority: 1,
      action: 'Add one defensible point of view and one direct question to the next two high-reach posts.',
      because: diagnosis.evidence.join(' '),
      instructions: ['Choose a buyer decision with a real trade-off.', 'State which option fits and which does not.', 'Ask one specific question instead of a generic engagement prompt.', 'Use the same structure twice.'],
      successMetric: `At least one post should exceed the current ${pct(analytics.interactionRate ?? analytics.observedInteractionRate)} personal interaction-rate baseline.`,
      dimensions: { strategicRelevance: 94, expectedImpact: 86, evidenceConfidence: 78, feasibility: 90, urgency: 70 },
    });
  }

  if (diagnosis.key === 'content-fit') {
    addCandidate(list, {
      category: 'Experiment',
      priority: 1,
      action: 'Run a four-post controlled reset around one buyer problem.',
      because: diagnosis.evidence.join(' '),
      instructions: ['Use one target audience throughout the test.', 'Publish two posts in the strongest current format.', 'Publish two in one adjacent format.', 'Hold the call to action constant.'],
      successMetric: 'Find one topic-format pair that exceeds both the current personal median interaction rate and view efficiency twice.',
      deadline: 'Within 14 days',
      reviewAfter: 'Review 7 days after the fourth post',
      dimensions: { strategicRelevance: 96, expectedImpact: 90, evidenceConfidence: 72, feasibility: 80, urgency: 78 },
    });
  }

  if (diagnosis.key === 'mix-misalignment' && bestPillar) {
    addCandidate(list, {
      category: 'Improve',
      priority: 1,
      action: `Make two of the next four posts ${bestPillar.label.toLowerCase()} content.`,
      because: diagnosis.summary,
      instructions: ['Use two different buyer questions inside the same pillar.', 'Keep the strongest current format.', 'Use one consistent call to action.'],
      successMetric: `Both posts should be compared with the current ${pct(bestPillar.medianRate)} pillar median interaction rate.`,
      dimensions: { strategicRelevance: 98, expectedImpact: 84, evidenceConfidence: 82, feasibility: 88, urgency: 68 },
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of list.sort((a, b) => b.score - a.score || a.priority - b.priority)) {
    const key = canonical(candidate.action).replace(/\d+/g, '#');
    if (!candidate.action || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped.slice(0, 3).map((candidate, index) => Object.assign({}, candidate, { rank: index + 1 }));
}

function dataQuestion(record, context) {
  const days = context.days || R.WINDOW_DAYS;
  const now = context.now === undefined ? R.asOf([record]) : context.now;
  const analytics = context.analytics || {};
  const coverage = R.windowCoverage(record, now, days);
  const observed = analytics.observedMetricCoverage || analytics.metricCoverage || {};
  return {
    status: coverage.complete ? 'complete' : 'held',
    answer: coverage.complete
      ? `Yes. This account has a complete owner-verified ${days}-day public-post window.`
      : `Not yet. The current result is held because ${coverage.reason}.`,
    evidence: unique([
      coverage.complete ? `${analytics.postsInWindow ?? 0} posts measured in the window.` : coverage.reason,
      isNumber(observed.posts) ? `${observed.likes ?? 0}/${observed.posts} posts report likes and ${observed.comments ?? 0}/${observed.posts} report comments.` : null,
      isNumber(observed.videos) ? `${observed.videoViews ?? 0}/${observed.videos} videos report public views.` : null,
      context.capturedAt ? `Snapshot captured ${context.capturedAt}.` : null,
    ]),
  };
}

function performanceQuestion(strategy, diagnosis, context) {
  const analytics = context.analytics || {};
  const percentiles = context.percentiles || {};
  const strengths = [];
  const gaps = [];
  const addPercentile = (key, label) => {
    const value = percentiles[key];
    if (!isNumber(value)) return;
    if (value >= 70) strengths.push(`${label}: ${value}th percentile.`);
    else if (value <= 35) gaps.push(`${label}: ${value}th percentile.`);
  };
  addPercentile('postsPerWeek', 'Publishing cadence');
  addPercentile('interactionRate', 'Engagement efficiency');
  addPercentile('viewEfficiency', 'View efficiency');
  addPercentile('followers', 'Follower context');
  if (!strengths.length && isNumber(analytics.postsPerWeek)) strengths.push(`${round(analytics.postsPerWeek, 2)} measured posts per week.`);
  if (!gaps.length && diagnosis.key !== 'scale-strength') gaps.push(diagnosis.label);
  return {
    status: diagnosis.key === 'data-confidence' ? 'held' : diagnosis.key === 'scale-strength' ? 'healthy' : 'mixed',
    answer: diagnosis.key === 'data-confidence'
      ? 'A fair performance conclusion is withheld until the input window is complete.'
      : `${strategy.label}: ${diagnosis.summary}`,
    strengths,
    gaps,
  };
}

function movementQuestion(context) {
  const score = context.score || null;
  const components = score?.components || {};
  const contributions = score?.pointContributions || {};
  const drivers = Object.keys(COMPONENT_LABELS).map(key => ({
    key,
    label: COMPONENT_LABELS[key],
    value: isNumber(components[key]) ? components[key] : null,
    contributionPoints: isNumber(contributions[key]) ? round(contributions[key], 1) : null,
  })).filter(row => row.value !== null || row.contributionPoints !== null)
    .sort((a, b) => (b.contributionPoints || 0) - (a.contributionPoints || 0));
  const growth = components.followerGrowth;
  let answer = 'A prior comparable score is not yet available; the current score drivers are shown instead.';
  let direction = 'baseline';
  if (score?.rank === null || score?.provisional) {
    answer = 'Score movement is withheld because the comparable momentum sample is incomplete.';
    direction = 'held';
  } else if (isNumber(growth) && growth > 0) {
    answer = `Audience growth is positive at ${pct(growth)} weekly-equivalent; the current score is primarily supported by the drivers below.`;
    direction = 'improving';
  } else if (isNumber(growth) && growth < 0) {
    answer = `Audience growth is negative at ${pct(growth)} weekly-equivalent; the current score drivers show where recovery is possible.`;
    direction = 'declining';
  }
  return { status: direction, answer, drivers };
}

function outcomeQuestion(employee, context) {
  const history = employee?.coachingHistory || employee?.accountStrategy?.actionHistory || [];
  const latest = Array.isArray(history) ? history.slice().sort((a, b) => Date.parse(b.reviewedAt || b.completedAt || '') - Date.parse(a.reviewedAt || a.completedAt || ''))[0] : null;
  if (latest) {
    return {
      status: latest.status || 'recorded',
      answer: latest.summary || 'A previous recommendation result has been recorded for this account.',
      evidence: Array.isArray(latest.evidence) ? latest.evidence : [],
    };
  }
  return {
    status: 'baseline-created',
    answer: 'No completed recommendation has been evaluated yet. This validated snapshot is the baseline for the first action cycle.',
    evidence: [
      'Complete the recommended action before the stated deadline.',
      'The next comparable snapshot will judge the named success metric.',
      'A measured result may be worked, partially worked, did not work or insufficient evidence.',
    ],
  };
}

function buildAccountCoach(record, employee = {}, context = {}) {
  const days = context.days || R.WINDOW_DAYS;
  const now = context.now === undefined ? R.asOf([record]) : context.now;
  const pillars = context.pillars || C.personContentPillars(record, now, days) || [];
  const formats = context.formats || (R.windowCoverage(record, now, days).complete ? C.personFormatMix(record, now, days) : []);
  const strategy = inferAccountStrategy(record, employee, Object.assign({}, context, { now, days, pillars, formats }));
  const diagnosis = buildDiagnosis(record, strategy, Object.assign({}, context, { now, days, pillars, formats }));
  const recommendations = buildRecommendations(record, employee, strategy, diagnosis, Object.assign({}, context, { now, days, pillars, formats }));
  const questions = {
    data: dataQuestion(record, Object.assign({}, context, { now, days })),
    performance: performanceQuestion(strategy, diagnosis, {
      analytics: context.analytics,
      percentiles: context.analytics?.percentiles || context.percentiles,
    }),
    movement: movementQuestion(context),
    next: {
      status: recommendations.length ? 'ready' : 'held',
      answer: recommendations.length
        ? `${recommendations.length} account-specific action${recommendations.length === 1 ? '' : 's'} ranked by strategic relevance, expected impact, evidence, feasibility and urgency.`
        : 'No responsible action can be issued from the current evidence.',
      actions: recommendations,
    },
    outcome: outcomeQuestion(employee, context),
  };
  return {
    version: COACH_VERSION,
    asOf: new Date(now).toISOString(),
    strategy,
    diagnosis,
    recommendations,
    questions,
    processPromise: 'Recommendations are evidence-backed, measurable and reviewed; views, followers, leads and deals are not guaranteed.',
  };
}

module.exports = {
  buildAccountCoach,
  inferAccountStrategy,
  buildDiagnosis,
  buildRecommendations,
  ARCHETYPES,
  COACH_VERSION,
};
