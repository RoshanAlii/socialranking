'use strict';

const assert = require('assert');
const coach = require('../personal-coach.js');

const now = new Date().toISOString();
const earlier = new Date(Date.now() - 7 * 86400000).toISOString();

function base() {
  return {
    person: { name: 'Test Agent', role: 'Consultant – Offplan Sales', handle: 'test.kirpa' },
    employee: { name: 'Test Agent', role: 'Consultant – Offplan Sales', targets: { postsPerWeek: 2 } },
    analytics: {
      windowComplete: true,
      coverageReason: 'date-bounded posts query completed without truncation',
      followers: 2000,
      postsInWindow: 8,
      comparablePosts: 8,
      postsPerWeek: 1.9,
      interactionRate: 0.035,
      medianInteractions: 70,
      medianViews: 3100,
      viewEfficiency: 1.55,
      viewsReporting: 6,
      metricCoverage: { posts: 8, likes: 8, comments: 8, videos: 6, videoViews: 6 },
      formatPerformance: [
        { type: 'reel', posts: 6, comparablePosts: 6, medianInteractions: 80 },
        { type: 'carousel', posts: 2, comparablePosts: 2, medianInteractions: 48 }
      ]
    },
    block: {
      windowComplete: true,
      daysSinceLastPost: 3,
      score: { rank: 5, value: 0.72, held: false, eligibilityReasons: [] },
      teamPercentiles: { postsPerWeek: 42, interactionRate: 78, viewEfficiency: 70, followers: 55 },
      teamBenchmarks: { postsPerWeek: 2.5, interactionRate: 0.025, viewEfficiency: 1.2 },
      contentPillars: [
        { key: 'investment-advice', label: 'Investment advice', posts: 4, share: 0.5, comparablePosts: 4, medianRate: 0.042, medianInteractions: 84 },
        { key: 'property-showcase', label: 'Property showcase', posts: 4, share: 0.5, comparablePosts: 4, medianRate: 0.025, medianInteractions: 50 }
      ],
      postingTime: { bestDay: { dayName: 'Tuesday', posts: 3, medianRate: 0.04 }, bestBlock: { blockLabel: '19:00–22:00', posts: 3, medianRate: 0.04 } },
      cadence: { currentStreakWeeks: 3 },
      goals: { goals: [{ metric: 'postsPerWeek', met: false }, { metric: 'engagementRate', met: true }] },
      achievements: [{ key: 'growing', label: 'Audience growing', evidence: 'positive growth' }],
      nextActions: []
    },
    mentions: { processedReels: 6, totalReels: 6, developerShare: 0.33, developerDiversity: 2, processingCoverage: 1 },
    points: [
      { at: earlier, validated: true, followers: 1900, postsPerWeek: 1.2, engagementRate: 0.03, medianInteractions: 57 },
      { at: now, validated: true, followers: 2000, postsPerWeek: 1.9, engagementRate: 0.035, medianInteractions: 70 }
    ],
    meta: { capturedAt: now },
    team: { engagement: 0.025, viewEfficiency: 1.2, developerShare: 0.4, developerDiversity: 3 }
  };
}

{
  const result = coach.buildCoach(base());
  assert.equal(result.strategy.positioning, 'Investment analyst');
  assert.equal(result.strategy.source, 'observed');
  assert.ok(result.recommendations.length > 0 && result.recommendations.length <= 3);
  for (const action of result.recommendations) {
    assert.ok(action.evidence.length, 'action must carry evidence');
    assert.ok(action.steps.length, 'action must carry execution steps');
    assert.ok(action.successMetric, 'action must carry success metric');
    assert.ok(['High', 'Medium', 'Experimental'].includes(action.confidence));
  }
}

{
  const input = base();
  input.person.role = 'Consultant – Secondary Sales';
  input.employee.role = input.person.role;
  input.analytics.postsPerWeek = 3.5;
  input.analytics.interactionRate = 0.008;
  input.block.teamPercentiles = { postsPerWeek: 82, interactionRate: 18, viewEfficiency: 66, followers: 45 };
  input.block.contentPillars = [
    { key: 'property-showcase', label: 'Property showcase', posts: 7, share: 0.875, comparablePosts: 7, medianRate: 0.008, medianInteractions: 16 },
    { key: 'educational', label: 'Educational', posts: 1, share: 0.125, comparablePosts: 1, medianRate: 0.02, medianInteractions: 40 }
  ];
  const result = coach.buildCoach(input);
  assert.equal(result.strategy.positioning, 'Property showcase advisor');
  assert.equal(result.performance.primaryConstraint, 'Content response');
  assert.ok(result.recommendations.some(action => /opening|interaction|response/i.test(`${action.action} ${action.category}`)));
}

{
  const input = base();
  input.analytics.postsInWindow = 0;
  input.analytics.comparablePosts = 0;
  input.analytics.postsPerWeek = 0;
  input.analytics.metricCoverage = { posts: 0, videos: 0, videoViews: 0 };
  input.block.daysSinceLastPost = null;
  input.block.score = { rank: null, value: null, held: true, eligibilityReasons: ['0/5 comparable posts'] };
  input.block.contentPillars = [];
  const result = coach.buildCoach(input);
  assert.equal(result.recommendations.length, 1);
  assert.match(result.recommendations[0].action, /three measurable/i);
  assert.equal(result.recommendations[0].primaryMetric, 'postsInWindow');
}

{
  const input = base();
  input.employee.accountStrategy = {
    key: 'custom-analyst',
    positioning: 'Luxury investment advisor',
    objective: 'Qualified luxury investor enquiries',
    audience: 'HNW overseas investors',
    approach: 'evidence-led luxury property comparisons',
    conversionRoute: 'Book a private portfolio review',
    weeklyCapacity: 1.5
  };
  const result = coach.buildCoach(input);
  assert.equal(result.strategy.source, 'declared');
  assert.equal(result.strategy.positioning, 'Luxury investment advisor');
  assert.equal(result.strategy.weeklyCapacity, 1.5);
  assert.equal(result.strategy.conversionRoute, 'Book a private portfolio review');
}

{
  const result = coach.movementAnalysis(base().points);
  assert.equal(result.overall, 'Improving');
  assert.ok(result.drivers.some(driver => driver.key === 'followers' && driver.delta === 100));
  assert.ok(result.drivers.some(driver => driver.key === 'postsPerWeek' && driver.delta > 0));
}

{
  const input = base();
  input.analytics.windowComplete = false;
  input.analytics.coverageReason = 'posts query hit its limit before reaching the 30-day cutoff';
  input.block.windowComplete = false;
  const result = coach.buildCoach(input);
  assert.equal(result.data.complete, false);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].category, 'Data recovery');
  assert.match(result.recommendations[0].action, /do not change strategy/i);
}

{
  const record = {
    status: 'completed',
    completedAtSnapshot: now,
    primaryMetric: 'interactionRate',
    expectedDirection: 'up',
    targetValue: 0.04,
    baseline: { interactionRate: 0.03 }
  };
  const waiting = coach.evaluateAction(record, { interactionRate: 0.041 }, now);
  assert.equal(waiting.verdict, 'Measurement in progress');
  const worked = coach.evaluateAction(record, { interactionRate: 0.041 }, new Date(Date.now() + 86400000).toISOString());
  assert.equal(worked.verdict, 'Worked');
}

console.log('personal coach tests passed');
