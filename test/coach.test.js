'use strict';

const assert = require('assert');
const R = require('../src/rank');
const C = require('../src/content');
const { buildAccountCoach, inferAccountStrategy } = require('../src/coach');

const CAPTURED_AT = '2026-08-22T08:00:00.000Z';
const NOW = Date.parse(CAPTURED_AT);
const DAY_MS = 86400000;

function post(handle, index, caption, options = {}) {
  return {
    id: `${handle}-${index}`,
    ownerUsername: handle,
    postedAt: new Date(NOW - (index + 1) * 3 * DAY_MS).toISOString(),
    type: options.type || 'reel',
    caption,
    likes: options.likes === undefined ? 45 + index * 4 : options.likes,
    comments: options.comments === undefined ? 6 + index : options.comments,
    views: options.views === undefined ? 900 + index * 80 : options.views,
    url: `https://www.instagram.com/reel/${handle}-${index}/`,
  };
}

function record(handle, captions, options = {}) {
  const posts = captions.map((caption, index) => post(handle, index, caption, options.posts?.[index] || {}));
  return {
    name: options.name || handle,
    role: options.role || 'Consultant – Offplan Sales',
    platform: 'instagram',
    handle,
    capturedAt: CAPTURED_AT,
    resolved: options.resolved === undefined ? true : options.resolved,
    isPrivate: false,
    optOut: false,
    followers: options.followers || 1000,
    following: 300,
    postCount: 80,
    recentPosts: posts,
    fetchMeta: {
      postsQuerySucceeded: options.querySucceeded === undefined ? true : options.querySucceeded,
      postsOwnershipComplete: true,
      postsLookbackDays: 35,
      postsResultLimit: 100,
      authoredPostCount: posts.length,
      postsTruncated: false,
    },
  };
}

function contextFor(item, employee = {}) {
  const analytics = R.profileAnalytics([item], 'instagram', NOW, 30)[0];
  const benchmarks = { engagement: 0.04, cadence: 2 };
  const teamBenchmarks = {
    followers: 1000,
    postsPerWeek: 2,
    interactionRate: 0.04,
    viewEfficiency: 1,
  };
  const content = C.buildContentIntelligence([item], 'instagram', { now: NOW, days: 30 });
  const targets = Object.assign({ postsPerWeek: 2, engagementRate: 0.02 }, employee.targets || {});
  const existingActions = C.nextActions(item, {
    now: NOW,
    days: 30,
    benchmarks,
    timing: content.timing,
    teamMedianRate: content.teamMedianRate,
    engagementRate: analytics?.interactionRate,
    targets,
  });
  return {
    now: NOW,
    days: 30,
    capturedAt: CAPTURED_AT,
    analytics,
    benchmarks,
    teamBenchmarks,
    content,
    targets,
    existingActions,
    score: {
      rank: 3,
      score: 0.67,
      provisional: false,
      components: {
        followers: item.followers,
        engagementRate: analytics?.interactionRate,
        postsPerWeek: analytics?.postsPerWeek,
        followerGrowth: 0.012,
      },
      pointContributions: {
        followers: 6,
        engagementRate: 31,
        postsPerWeek: 18,
        followerGrowth: 12,
      },
    },
  };
}

function assertActionShape(coach) {
  assert.ok(coach.recommendations.length > 0 && coach.recommendations.length <= 3);
  for (const action of coach.recommendations) {
    assert.ok(action.action);
    assert.ok(action.because);
    assert.ok(Array.isArray(action.instructions));
    assert.ok(action.successMetric);
    assert.ok(action.deadline);
    assert.ok(action.reviewAfter);
    assert.ok(['high', 'medium', 'experimental'].includes(action.confidence));
  }
}

const analyst = record('analyst.kirpa', [
  'ROI and rental yield: how to compare two Dubai investments',
  'Investment return, future supply and exit risk explained',
  'Payment plan versus cash flow for an off-plan investor',
  'Market transaction trend and price growth report',
  'How to calculate yield before you invest',
  'Portfolio risk: three things an investor should know',
], { name: 'Analyst', followers: 1300 });
const analystCoach = buildAccountCoach(analyst, { name: 'Analyst', role: analyst.role, targets: { postsPerWeek: 2 } }, contextFor(analyst));
assert.strictEqual(analystCoach.strategy.archetype, 'investment-analyst');
assert.ok(analystCoach.recommendations.some(action => /decision|investment|compare/i.test(action.action + ' ' + action.because)));
assertActionShape(analystCoach);

const walkthrough = record('walkthrough.kirpa', [
  'Tour this three bedroom villa with pool and amenities',
  'Walkthrough of a new apartment unit ready for handover',
  'Penthouse showcase with marina views',
  'Townhouse tour: four bedrooms and community amenities',
  'Inside this waterfront apartment',
  'Villa walkthrough in Dubai',
], { name: 'Walkthrough', followers: 1300 });
const walkthroughCoach = buildAccountCoach(walkthrough, { name: 'Walkthrough', role: walkthrough.role, targets: { postsPerWeek: 2 } }, contextFor(walkthrough));
assert.strictEqual(walkthroughCoach.strategy.archetype, 'property-walkthrough');
assert.ok(walkthroughCoach.recommendations.some(action => /walkthrough|first three seconds|visual/i.test(action.action + ' ' + action.because + ' ' + action.instructions.join(' '))));
assert.notStrictEqual(analystCoach.recommendations[0].action, walkthroughCoach.recommendations[0].action);
assertActionShape(walkthroughCoach);

const areaDeclared = record('area.kirpa', [
  'Dubai property guide for buyers',
  'Three things to know before buying',
  'A new project launch explained',
  'Apartment tour and payment plan',
], { name: 'Area Specialist' });
const declaredEmployee = {
  name: 'Area Specialist',
  role: areaDeclared.role,
  accountStrategy: {
    primaryArchetype: 'area-specialist',
    primaryObjective: 'Become the most trusted JVC advisor.',
    contentCapacityPerWeek: 2,
    targetAudience: 'JVC investors and end users',
  },
};
const declared = inferAccountStrategy(areaDeclared, declaredEmployee, contextFor(areaDeclared, declaredEmployee));
assert.strictEqual(declared.source, 'declared');
assert.strictEqual(declared.archetype, 'area-specialist');
assert.strictEqual(declared.capacityPerWeek, 2);
assert.strictEqual(declared.confirmationRequired, false);

const inactive = record('inactive.kirpa', [], { name: 'Inactive' });
const inactiveCoach = buildAccountCoach(inactive, { name: 'Inactive', role: inactive.role }, contextFor(inactive));
assert.strictEqual(inactiveCoach.diagnosis.key, 'inactivity');
assert.strictEqual(inactiveCoach.recommendations[0].category, 'Recover');
assert.ok(/48 hours/i.test(inactiveCoach.recommendations[0].deadline));

const incomplete = record('incomplete.kirpa', ['One observed post'], { name: 'Incomplete', querySucceeded: false });
const incompleteCoach = buildAccountCoach(incomplete, { name: 'Incomplete', role: incomplete.role }, contextFor(incomplete));
assert.strictEqual(incompleteCoach.diagnosis.key, 'data-confidence');
assert.strictEqual(incompleteCoach.questions.data.status, 'held');
assert.strictEqual(incompleteCoach.recommendations[0].category, 'Recover');
assert.ok(/verified account pull/i.test(incompleteCoach.recommendations[0].action));

for (const coach of [analystCoach, walkthroughCoach, inactiveCoach, incompleteCoach]) {
  assert.strictEqual(coach.version, 1);
  assert.ok(coach.questions.data);
  assert.ok(coach.questions.performance);
  assert.ok(coach.questions.movement);
  assert.ok(coach.questions.next);
  assert.ok(coach.questions.outcome);
  assert.ok(/not guaranteed/i.test(coach.processPromise));
}

console.log('[coach.test] personal strategy, diagnosis and action paths passed');
