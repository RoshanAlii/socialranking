(() => {
  'use strict';

  const ARCHETYPES = {
    'baseline-building': {
      label: 'Baseline-building account',
      objective: 'Establish a reliable personal content baseline before optimising.',
    },
    'investment-analyst': {
      label: 'Investment analyst',
      objective: 'Build decision-making authority and qualified investor conversations.',
    },
    'property-walkthrough': {
      label: 'Property walkthrough creator',
      objective: 'Turn property access and visual inventory into relevant property interest.',
    },
    'area-specialist': {
      label: 'Area specialist',
      objective: 'Own a recognisable community or micro-market in the audience’s mind.',
    },
    'developer-specialist': {
      label: 'Developer and project specialist',
      objective: 'Build useful authority around launches, developers and project selection.',
    },
    'buyer-educator': {
      label: 'Buyer educator',
      objective: 'Build trust by answering practical buyer questions clearly.',
    },
    'relationship-builder': {
      label: 'Trust and relationship builder',
      objective: 'Turn personal familiarity into relevant property conversations.',
    },
    'balanced-advisor': {
      label: 'Balanced property advisor',
      objective: 'Build consistent visibility while discovering the strongest repeatable lane.',
    },
  };

  const PILLAR_ARCHETYPE = {
    'investment-advice': 'investment-analyst',
    'market-update': 'investment-analyst',
    'property-showcase': 'property-walkthrough',
    'area-guide': 'area-specialist',
    'developer-news': 'developer-specialist',
    educational: 'buyer-educator',
    lifestyle: 'relationship-builder',
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const format = value => number(value)
    ? Intl.NumberFormat('en', { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
    : '—';
  const percent = value => number(value)
    ? `${(value * 100).toFixed(Math.abs(value * 100) >= 10 ? 1 : 2)}%`
    : '—';
  const canonical = value => String(value || '').replace(/^@/, '').trim().toLowerCase();
  const unique = values => [...new Set((values || []).filter(Boolean))];
  const best = (rows, key, minimum = -Infinity) => (rows || [])
    .filter(row => number(row?.[key]) && row[key] >= minimum)
    .slice()
    .sort((a, b) => b[key] - a[key])[0] || null;

  function installStyles() {
    if (document.getElementById('account-coach-styles')) return;
    const style = document.createElement('style');
    style.id = 'account-coach-styles';
    style.textContent = `
      .account-coach {
        margin: 28px 0 8px;
        border: 1px solid #e8ddd2;
        border-radius: 22px;
        overflow: hidden;
        background: #fff;
        box-shadow: 0 14px 42px rgba(52,35,25,.07);
      }
      .account-coach-head {
        position: relative;
        padding: 25px 27px 23px;
        color: #171717;
        background:
          radial-gradient(circle at 92% 8%, rgba(255,255,255,.28), transparent 15rem),
          linear-gradient(135deg, #f15a29, #ef744c);
      }
      .account-coach-head::after {
        content: "";
        position: absolute;
        inset: auto 0 0;
        height: 4px;
        background: #171717;
      }
      .account-coach-kicker {
        margin-bottom: 5px;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: .14em;
        text-transform: uppercase;
      }
      .account-coach-head h3 {
        margin: 0;
        font: 400 clamp(25px,3vw,35px)/1.05 "DM Serif Display", Georgia, serif;
        letter-spacing: -.025em;
      }
      .account-coach-head p {
        max-width: 760px;
        margin: 8px 0 0;
        color: rgba(23,23,23,.78);
        font-size: 13px;
      }
      .coach-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 15px;
      }
      .coach-pill {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 5px 10px;
        border: 1px solid rgba(23,23,23,.19);
        border-radius: 999px;
        background: rgba(255,255,255,.2);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .coach-body { padding: 22px; background: #fbf7f2; }
      .coach-diagnosis {
        display: grid;
        grid-template-columns: minmax(145px,.36fr) 1fr;
        gap: 18px;
        align-items: center;
        padding: 19px 20px;
        border: 1px solid #e7d8ca;
        border-radius: 16px;
        background: #fff;
      }
      .coach-diagnosis-label {
        color: #796f68;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .12em;
        text-transform: uppercase;
      }
      .coach-diagnosis b {
        display: block;
        margin-top: 4px;
        font-size: 16px;
      }
      .coach-diagnosis p { margin: 0; color: #625852; font-size: 12px; line-height: 1.6; }
      .coach-question-grid {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 12px;
        margin-top: 13px;
      }
      .coach-question {
        padding: 18px;
        border: 1px solid #e8ddd2;
        border-radius: 15px;
        background: #fff;
      }
      .coach-question-number {
        display: inline-grid;
        width: 26px;
        height: 26px;
        place-items: center;
        margin-bottom: 10px;
        border-radius: 50%;
        background: #171717;
        color: #fff;
        font-size: 10px;
        font-weight: 800;
      }
      .coach-question h4 {
        margin: 0;
        font-size: 13px;
        line-height: 1.3;
      }
      .coach-answer {
        margin: 8px 0 0;
        color: #625852;
        font-size: 11px;
        line-height: 1.55;
      }
      .coach-evidence {
        display: grid;
        gap: 5px;
        margin: 11px 0 0;
        padding: 0;
        list-style: none;
      }
      .coach-evidence li {
        position: relative;
        padding-left: 13px;
        color: #796f68;
        font-size: 10px;
        line-height: 1.45;
      }
      .coach-evidence li::before {
        content: "";
        position: absolute;
        left: 0;
        top: .55em;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #f15a29;
      }
      .coach-wide {
        margin-top: 13px;
        padding: 20px;
        border: 1px solid #e8ddd2;
        border-radius: 16px;
        background: #fff;
      }
      .coach-wide-head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      .coach-wide-head .coach-question-number { flex: 0 0 auto; margin: 0; }
      .coach-wide h4 { margin: 2px 0 0; font-size: 15px; }
      .coach-wide .coach-answer { margin-top: 5px; }
      .coach-actions {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 11px;
        margin-top: 16px;
      }
      .coach-action {
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding: 17px;
        border: 1px solid #e6d9ce;
        border-radius: 15px;
        background: #fffaf6;
      }
      .coach-action:first-child { border-color: rgba(241,90,41,.48); box-shadow: inset 0 3px 0 #f15a29; }
      .coach-action-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 10px;
      }
      .coach-action-tag {
        padding: 4px 7px;
        border-radius: 999px;
        background: #f1e8e0;
        color: #554c46;
        font-size: 8px;
        font-weight: 800;
        letter-spacing: .07em;
        text-transform: uppercase;
      }
      .coach-action-tag.confidence { background: rgba(45,128,98,.11); color: #256b52; }
      .coach-action h5 { margin: 0; font-size: 13px; line-height: 1.35; }
      .coach-action > p { margin: 8px 0 0; color: #6c625c; font-size: 10px; line-height: 1.55; }
      .coach-steps {
        display: grid;
        gap: 5px;
        margin: 12px 0 0;
        padding-left: 18px;
        color: #4e4742;
        font-size: 10px;
        line-height: 1.45;
      }
      .coach-measure {
        margin-top: auto;
        padding-top: 13px;
      }
      .coach-measure b {
        display: block;
        color: #796f68;
        font-size: 8px;
        letter-spacing: .09em;
        text-transform: uppercase;
      }
      .coach-measure span {
        display: block;
        margin-top: 3px;
        color: #3f3935;
        font-size: 9px;
        line-height: 1.5;
      }
      .coach-deadline {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #eadfd6;
        color: #796f68;
        font-size: 8px;
      }
      .coach-outcome {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 13px;
        align-items: start;
        margin-top: 13px;
        padding: 18px 20px;
        border: 1px dashed #d9c8bb;
        border-radius: 15px;
        background: rgba(255,255,255,.64);
      }
      .coach-outcome .coach-question-number { margin: 0; background: #796f68; }
      .coach-outcome h4 { margin: 1px 0 0; font-size: 13px; }
      .coach-outcome p { margin: 5px 0 0; color: #6c625c; font-size: 10px; line-height: 1.55; }
      .coach-process-note {
        margin: 12px 3px 0;
        color: #796f68;
        font-size: 9px;
        line-height: 1.5;
      }
      @media (max-width: 900px) {
        .coach-question-grid, .coach-actions { grid-template-columns: 1fr; }
      }
      @media (max-width: 620px) {
        .account-coach-head, .coach-body { padding: 20px 17px; }
        .coach-diagnosis { grid-template-columns: 1fr; gap: 8px; }
      }
    `;
    document.head.appendChild(style);
  }

  function registryEmployee(name) {
    if (typeof REGISTRY === 'undefined') return null;
    return (REGISTRY?.employees || []).find(employee => employee.name === name) || null;
  }

  function accountPerson() {
    const title = document.querySelector('#analytics-content #analytics-title');
    if (!title || typeof rosterPeople !== 'function') return null;
    return rosterPeople().find(person => person.name === title.textContent.trim()) || null;
  }

  function inferredStrategy(person, analytics, block) {
    const employee = registryEmployee(person.name) || {};
    const declared = employee.accountStrategy || employee.strategy || null;
    const pillars = (block?.contentPillars || []).slice().sort((a, b) => (b.posts || 0) - (a.posts || 0));
    const formats = (analytics?.formatPerformance || []).slice().sort((a, b) => (b.posts || 0) - (a.posts || 0));
    const dominantPillar = pillars[0] || null;
    const dominantFormat = formats[0] || null;
    const observedPosts = analytics?.postsInWindow ?? analytics?.observedPostsInWindow ?? 0;
    let archetype = observedPosts < 4 || !analytics?.windowComplete
      ? 'baseline-building'
      : PILLAR_ARCHETYPE[dominantPillar?.key] || (dominantFormat && ['reel', 'video'].includes(dominantFormat.type) ? 'property-walkthrough' : 'balanced-advisor');
    const declaredKey = String(declared?.primaryArchetype || declared?.archetype || '').trim().toLowerCase().replace(/[ _]+/g, '-');
    if (ARCHETYPES[declaredKey]) archetype = declaredKey;
    const meta = ARCHETYPES[archetype] || ARCHETYPES['balanced-advisor'];
    const capacity = declared?.contentCapacityPerWeek || declared?.postsPerWeek || employee?.targets?.postsPerWeek || REGISTRY?.targets?.postsPerWeek || 3;
    const evidence = [];
    if (dominantPillar) evidence.push(`${dominantPillar.label} is ${Math.round((dominantPillar.share || 0) * 100)}% of measured output.`);
    if (dominantFormat) evidence.push(`${dominantFormat.type} is the most-used current format.`);
    if (employee.role) evidence.push(`Role context: ${employee.role}.`);
    return {
      source: declared ? 'declared' : 'inferred',
      confirmationRequired: !declared,
      archetype,
      label: meta.label,
      objective: declared?.primaryObjective || declared?.objective || meta.objective,
      positioning: declared?.positioning || `${employee.role || person.role || 'Kirpa property advisor'} · ${meta.label}`,
      capacityPerWeek: Number(capacity) || 3,
      confidence: declared ? 'declared' : observedPosts >= 8 ? 'high' : observedPosts >= 4 ? 'medium' : 'experimental',
      evidence,
    };
  }

  function inferredDiagnosis(person, analytics, block, strategy) {
    const benchmarks = block?.teamBenchmarks || {};
    const posts = analytics?.postsInWindow ?? analytics?.observedPostsInWindow ?? 0;
    const rate = analytics?.interactionRate ?? analytics?.observedInteractionRate;
    const views = analytics?.viewEfficiency;
    const gap = block?.daysSinceLastPost;
    const result = (key, label, summary, evidence, confidence = 'medium') => ({ key, label, summary, evidence: unique(evidence), confidence });
    if (!analytics?.windowComplete) return result('data-confidence', 'Data confidence is the first constraint', 'A complete current window is required before content advice can be treated as reliable.', [analytics?.coverageReason || 'Complete 30-day coverage is unavailable.'], 'high');
    if (!posts) return result('inactivity', 'Activity is the first constraint', 'The account needs a fresh measured post before a winning pattern can be identified.', ['0 posts in the verified window.'], 'high');
    if (posts < 3) return result('measurement-base', 'The sample is too small to optimise confidently', 'Build a structured baseline before making a major strategic change.', [`${posts} measured post${posts === 1 ? '' : 's'}.`], 'high');
    if (number(gap) && gap >= 10) return result('recency-gap', 'A long publishing gap is interrupting momentum', 'Restart the account using its strongest current content lane.', [`Last post was ${gap} days before the snapshot.`], 'high');
    if (number(analytics?.postsPerWeek) && analytics.postsPerWeek < strategy.capacityPerWeek * .75) return result('cadence', 'Consistency is the primary constraint', 'Measured output is below the account’s declared or assigned capacity.', [`${analytics.postsPerWeek.toFixed(2)}/week now.`, `${strategy.capacityPerWeek}/week strategy capacity.`], 'high');
    if (number(views) && number(benchmarks.viewEfficiency) && views < benchmarks.viewEfficiency * .8 && number(rate) && number(benchmarks.interactionRate) && rate >= benchmarks.interactionRate) return result('reach', 'Content quality is stronger than content discovery', 'People who see the content respond, but the typical video is not travelling far enough.', [`${views.toFixed(2)}× view efficiency versus ${benchmarks.viewEfficiency.toFixed(2)}× team median.`, `${percent(rate)} interaction rate.`]);
    if (number(rate) && number(benchmarks.interactionRate) && rate < benchmarks.interactionRate * .8 && number(views) && number(benchmarks.viewEfficiency) && views >= benchmarks.viewEfficiency) return result('interaction', 'Reach is not converting into enough public response', 'The opening, point of view or call to action needs to create a stronger audience decision.', [`${views.toFixed(2)}× view efficiency.`, `${percent(rate)} interaction rate versus ${percent(benchmarks.interactionRate)} team median.`]);
    return result('scale-strength', 'No critical performance failure is visible', 'Protect the strongest proven pattern and test one change at a time.', [number(analytics?.postsPerWeek) ? `${analytics.postsPerWeek.toFixed(2)} posts/week.` : null, number(rate) ? `${percent(rate)} personal interaction rate.` : null], posts >= 6 ? 'high' : 'medium');
  }

  function actionDefaults(action, analytics, strategy) {
    const text = String(action?.action || '').toLowerCase();
    let instructions = ['Keep the test to one deliberate change.', 'Use the same personal baseline.', 'Record what was published for the next review.'];
    if (text.includes('hook') || text.includes('question')) instructions = ['State the buyer decision immediately.', 'Make one clear defensible point.', 'End with one direct question or trackable DM prompt.'];
    else if (text.includes('developer')) instructions = ['Choose one relevant developer.', 'Explain buyer fit and one material limitation.', 'Use one consistent call to action.'];
    else if (text.includes('post') || text.includes('rhythm')) instructions = ['Schedule the publishing date before the week starts.', 'Use the strongest current pillar.', 'Keep production simple enough to publish on time.'];
    return {
      category: /re-enter|restart|next 48 hours/i.test(action?.action || '') ? 'Recover' : /protect|hold|repeat/i.test(action?.action || '') ? 'Maintain' : /try|test/i.test(action?.action || '') ? 'Experiment' : 'Improve',
      confidence: 'medium',
      action: action?.action || 'Run one measurable content test.',
      because: action?.because || 'The current account evidence supports a controlled next step.',
      instructions,
      successMetric: number(analytics?.interactionRate ?? analytics?.observedInteractionRate)
        ? `The completed post should match or exceed the current ${percent(analytics.interactionRate ?? analytics.observedInteractionRate)} personal interaction-rate baseline.`
        : 'Compare the completed post with the current personal median.',
      deadline: action?.priority <= 1 ? 'Within 48 hours' : 'Within 7 days',
      reviewAfter: 'Review 7 days after the final recommended post',
    };
  }

  function strategyAction(strategy, analytics, block) {
    const medianViews = number(analytics?.viewEfficiency) ? `${analytics.viewEfficiency.toFixed(2)}×` : 'current';
    const pillar = best((block?.contentPillars || []).filter(row => row.comparablePosts >= 2), 'medianRate');
    const base = { category: strategy.archetype === 'baseline-building' ? 'Experiment' : 'Improve', confidence: strategy.confidence === 'high' || strategy.confidence === 'declared' ? 'high' : strategy.confidence === 'medium' ? 'medium' : 'experimental', deadline: 'Within 14 days', reviewAfter: 'Review 7 days after the final recommended post' };
    switch (strategy.archetype) {
      case 'baseline-building': return { ...base, action: 'Run a six-post baseline experiment before optimising the account.', because: 'The current sample cannot distinguish a repeatable strength from a one-post result.', instructions: ['Publish two buyer-education posts.', 'Publish two property or project explainers.', 'Publish two posts in the easiest sustainable format.', 'Use the same call to action across all six.'], successMetric: 'Complete six measured posts and identify one format or pillar with two comparable results.', deadline: strategy.capacityPerWeek >= 3 ? 'Within 14 days' : 'Within 21 days' };
      case 'investment-analyst': return { ...base, action: 'Turn the next content cycle into a repeatable property-decision series.', because: pillar ? `${pillar.label} is the strongest measured account pillar.` : 'The account’s observed positioning is analytical and should reinforce decision authority.', instructions: ['Frame each post around one investment decision.', 'Compare price, yield, supply, risk and exit.', 'State one clear conclusion.', 'Use one consistent DM prompt.'], successMetric: `Publish two decision-led posts; at least one should exceed the ${medianViews} personal view-efficiency baseline.` };
      case 'property-walkthrough': return { ...base, action: 'Test two walkthroughs with the buyer decision stated in the first three seconds.', because: 'The account is visually led; the highest-leverage change is making the property, price and buyer fit clear sooner.', instructions: ['Open with location and price.', 'Show the strongest visual proof first.', 'State who the property fits.', 'End with one property-specific DM prompt.'], successMetric: `At least one walkthrough should exceed the ${medianViews} personal view-efficiency baseline.` };
      case 'area-specialist': return { ...base, action: 'Publish a four-part series on one priority community.', because: 'Area authority is built through repeated useful coverage rather than isolated location mentions.', instructions: ['Cover entry prices.', 'Cover rental demand and yield.', 'Cover future supply and risk.', 'Explain the buyer profile that fits.'], successMetric: 'Complete all four posts and compare the series median with the rest of the account.' };
      case 'developer-specialist': return { ...base, action: 'Build the next two developer posts around selection criteria, not promotion alone.', because: 'Developer authority is useful when the audience understands buyer fit, delivery evidence and trade-offs.', instructions: ['Explain one reason to consider the developer.', 'Explain one material limitation.', 'Compare one credible alternative.', 'Use one consistent inquiry CTA.'], successMetric: 'At least one post should exceed the account’s current personal interaction median.' };
      case 'buyer-educator': return { ...base, action: 'Create a three-post buyer-question series using questions heard in sales conversations.', because: 'The account’s observed strength is clarity and buyer education.', instructions: ['Use one real buyer question per post.', 'Answer without jargon.', 'Include one mistake to avoid.', 'Ask which decision the viewer is facing.'], successMetric: 'The three-post series should match or exceed the current personal interaction baseline.' };
      case 'relationship-builder': return { ...base, action: 'Connect personal trust content to one practical property decision in the next three posts.', because: 'Personal familiarity is strongest when viewers also understand the advisor’s expertise and next step.', instructions: ['Keep personal context brief.', 'Link it to one property decision.', 'Include one proof point.', 'Use one clear conversation prompt.'], successMetric: 'At least two of the three posts should exceed the current personal interaction median.' };
      default: return { ...base, category: 'Experiment', action: pillar ? `Make two of the next four posts ${pillar.label.toLowerCase()} content.` : 'Run a controlled four-post cycle around one buyer problem.', because: pillar ? `${pillar.label} is the strongest measured pillar, but the account strategy is not yet confirmed.` : 'A controlled cycle will reveal a stronger repeatable lane.', instructions: ['Keep one audience and one property problem.', 'Use the strongest current format twice.', 'Test one adjacent format.', 'Keep the CTA consistent.'], successMetric: 'Identify one topic-format combination that beats the personal median twice.' };
    }
  }

  function fallbackCoach(person, analytics, block) {
    const strategy = inferredStrategy(person, analytics, block);
    const diagnosis = inferredDiagnosis(person, analytics, block, strategy);
    const rawActions = (block?.nextActions || []).map(action => actionDefaults(action, analytics, strategy));
    rawActions.push(strategyAction(strategy, analytics, block));

    const developer = typeof MENTIONS !== 'undefined' && MENTIONS
      ? (MENTIONS.creators || []).find(row => canonical(row.handle) === canonical(person.handle))
      : null;
    if (developer?.processedReels >= 2 && developer.developerShare === 0) {
      rawActions.push({
        category: 'Experiment', confidence: 'medium',
        action: 'Test one evidence-led developer Reel in the next four posts.',
        because: `0 of ${developer.processedReels} processed Reels names a configured developer.`,
        instructions: ['Choose one developer relevant to current inventory.', 'Explain buyer fit and one material risk.', 'Use one consistent call to action.'],
        successMetric: 'Compare the test with the account’s current median view and interaction efficiency.',
        deadline: 'Within 14 days', reviewAfter: 'Review 7 days after publication',
      });
    }

    const actions = [];
    const seen = new Set();
    for (const action of rawActions) {
      const key = String(action.action || '').toLowerCase().replace(/\d+/g, '#').replace(/[^a-z]+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      actions.push({ ...action, rank: actions.length + 1 });
      if (actions.length === 3) break;
    }

    const points = typeof profilePoints === 'function' ? profilePoints(person.handle) : [];
    const metricChange = key => {
      const usable = points.filter(point => number(point[key])).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      if (usable.length < 2) return null;
      const prior = usable[usable.length - 2];
      const current = usable[usable.length - 1];
      return { key, from: prior[key], to: current[key], delta: current[key] - prior[key], fromAt: prior.at, toAt: current.at };
    };
    const changes = [metricChange('followers'), metricChange('postsPerWeek'), metricChange('engagementRate')].filter(Boolean);
    const movementEvidence = changes.map(change => {
      const label = change.key === 'followers' ? 'Followers' : change.key === 'postsPerWeek' ? 'Cadence' : 'Interaction rate';
      const rendered = change.key === 'engagementRate'
        ? `${change.delta >= 0 ? '+' : ''}${(change.delta * 100).toFixed(2)} percentage points`
        : change.key === 'postsPerWeek'
          ? `${change.delta >= 0 ? '+' : ''}${change.delta.toFixed(2)}/week`
          : `${change.delta >= 0 ? '+' : ''}${format(change.delta)}`;
      return `${label}: ${rendered} from the previous validated capture.`;
    });

    const percentiles = block?.teamPercentiles || {};
    const strengths = [];
    const gaps = [];
    [['postsPerWeek','Cadence'],['interactionRate','Engagement efficiency'],['viewEfficiency','View efficiency'],['followers','Follower context']].forEach(([key,label]) => {
      const value = percentiles[key];
      if (!number(value)) return;
      if (value >= 70) strengths.push(`${label}: ${value}th percentile.`);
      else if (value <= 35) gaps.push(`${label}: ${value}th percentile.`);
    });

    return {
      version: 0,
      strategy,
      diagnosis,
      recommendations: actions,
      questions: {
        data: {
          status: analytics?.windowComplete ? 'complete' : 'held',
          answer: analytics?.windowComplete ? 'Yes. This account has a complete verified 30-day public-post window.' : `Not yet. ${analytics?.coverageReason || 'The complete input window is unavailable.'}`,
          evidence: [analytics?.windowComplete ? `${analytics.postsInWindow || 0} posts measured.` : analytics?.coverageReason, analytics?.metricCoverage ? `${analytics.metricCoverage.likes}/${analytics.metricCoverage.posts} posts report likes and ${analytics.metricCoverage.comments}/${analytics.metricCoverage.posts} report comments.` : null].filter(Boolean),
        },
        performance: {
          status: diagnosis.key === 'data-confidence' ? 'held' : diagnosis.key === 'scale-strength' ? 'healthy' : 'mixed',
          answer: diagnosis.key === 'data-confidence' ? 'A fair conclusion is held until the input window is complete.' : `${strategy.label}: ${diagnosis.summary}`,
          strengths: strengths.length ? strengths : [number(analytics?.postsPerWeek) ? `${analytics.postsPerWeek.toFixed(2)} measured posts per week.` : 'A personal baseline is being established.'],
          gaps: gaps.length ? gaps : diagnosis.key === 'scale-strength' ? [] : [diagnosis.label],
        },
        movement: {
          status: changes.length ? 'measured' : 'baseline',
          answer: changes.length ? 'The latest validated capture changed in the following measurable ways.' : 'A previous comparable capture is not yet available; the current snapshot establishes the baseline.',
          drivers: movementEvidence.map((label, index) => ({ label, contributionPoints: null, key: String(index) })),
        },
        next: { status: actions.length ? 'ready' : 'held', answer: `${actions.length} account-specific actions are ready.`, actions },
        outcome: { status: 'baseline-created', answer: 'No completed recommendation has been evaluated yet. This snapshot is the baseline for the first action cycle.', evidence: ['Complete the action before its deadline.', 'The next comparable snapshot will judge the stated success metric.', 'The result will be labelled worked, partially worked, did not work or insufficient evidence.'] },
      },
      processPromise: 'Recommendations are evidence-backed and measurable; views, followers, leads and deals are not guaranteed.',
    };
  }

  function coachFor(person, analytics, block) {
    if (block?.coach?.questions && block?.coach?.strategy) return block.coach;
    return fallbackCoach(person, analytics, block);
  }

  function evidenceList(items) {
    const values = unique(items || []);
    return values.length ? `<ul class="coach-evidence">${values.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  }

  function performanceEvidence(question) {
    return evidenceList([...(question?.strengths || []), ...(question?.gaps || [])]);
  }

  function movementEvidence(question) {
    const rows = question?.drivers || [];
    return evidenceList(rows.map(row => {
      if (row.contributionPoints !== null && row.contributionPoints !== undefined) return `${row.label}: ${row.contributionPoints} of the current 100-point score.`;
      return row.label;
    }));
  }

  function actionMarkup(action, index) {
    const confidence = String(action.confidence || 'experimental').replace(/^./, character => character.toUpperCase());
    return `<article class="coach-action">
      <div class="coach-action-meta">
        <span class="coach-action-tag">Priority ${index + 1}</span>
        <span class="coach-action-tag">${escapeHtml(action.category || 'Improve')}</span>
        <span class="coach-action-tag confidence">${escapeHtml(confidence)} confidence</span>
      </div>
      <h5>${escapeHtml(action.action)}</h5>
      <p>${escapeHtml(action.because)}</p>
      ${(action.instructions || []).length ? `<ol class="coach-steps">${action.instructions.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}
      <div class="coach-measure"><b>Success measurement</b><span>${escapeHtml(action.successMetric || 'Compare with the account’s current personal baseline.')}</span></div>
      <div class="coach-deadline"><span>${escapeHtml(action.deadline || 'Within 7 days')}</span><span>${escapeHtml(action.reviewAfter || 'Review after the next comparable snapshot')}</span></div>
    </article>`;
  }

  function renderCoach(coach) {
    const strategy = coach.strategy || {};
    const diagnosis = coach.diagnosis || {};
    const questions = coach.questions || {};
    const actions = questions.next?.actions || coach.recommendations || [];
    const source = strategy.source === 'declared' ? 'Employee-declared strategy' : 'Inferred strategy · confirmation needed';
    const capacity = number(strategy.capacityPerWeek) ? `${strategy.capacityPerWeek}/week capacity` : null;
    return `<section class="account-coach" id="personal-account-coach" aria-labelledby="personal-account-coach-title">
      <header class="account-coach-head">
        <div class="account-coach-kicker">Personal account coach</div>
        <h3 id="personal-account-coach-title">${escapeHtml(strategy.label || 'Account strategy')}</h3>
        <p>${escapeHtml(strategy.positioning || strategy.objective || 'Personalised from this account’s own verified evidence.')}</p>
        <div class="coach-pills">
          <span class="coach-pill">${escapeHtml(source)}</span>
          ${capacity ? `<span class="coach-pill">${escapeHtml(capacity)}</span>` : ''}
          ${strategy.confidence ? `<span class="coach-pill">${escapeHtml(String(strategy.confidence).replace(/^./, character => character.toUpperCase()))} evidence</span>` : ''}
        </div>
      </header>
      <div class="coach-body">
        <div class="coach-diagnosis">
          <div><span class="coach-diagnosis-label">Current account constraint</span><b>${escapeHtml(diagnosis.label || 'Building the first diagnosis')}</b></div>
          <p>${escapeHtml(diagnosis.summary || 'The next complete snapshot will establish the strongest measurable constraint.')}</p>
        </div>

        <div class="coach-question-grid">
          <article class="coach-question">
            <span class="coach-question-number">1</span>
            <h4>Is my data complete and current?</h4>
            <p class="coach-answer">${escapeHtml(questions.data?.answer || 'Data status unavailable.')}</p>
            ${evidenceList(questions.data?.evidence)}
          </article>
          <article class="coach-question">
            <span class="coach-question-number">2</span>
            <h4>How am I performing?</h4>
            <p class="coach-answer">${escapeHtml(questions.performance?.answer || diagnosis.summary || 'Performance interpretation is building.')}</p>
            ${performanceEvidence(questions.performance)}
          </article>
          <article class="coach-question">
            <span class="coach-question-number">3</span>
            <h4>Why did my result improve or decline?</h4>
            <p class="coach-answer">${escapeHtml(questions.movement?.answer || 'A comparable prior result is required to explain movement.')}</p>
            ${movementEvidence(questions.movement)}
          </article>
        </div>

        <article class="coach-wide">
          <div class="coach-wide-head">
            <span class="coach-question-number">4</span>
            <div><h4>What exactly should I do next?</h4><p class="coach-answer">${escapeHtml(questions.next?.answer || 'The strongest responsible actions are ranked below.')}</p></div>
          </div>
          <div class="coach-actions">${actions.length ? actions.slice(0, 3).map(actionMarkup).join('') : '<p class="coach-answer">No responsible recommendation can be issued until the data gap is repaired.</p>'}</div>
        </article>

        <article class="coach-outcome">
          <span class="coach-question-number">5</span>
          <div><h4>Did the recommended action actually work?</h4><p>${escapeHtml(questions.outcome?.answer || 'The first action cycle has not yet been evaluated.')}</p>${evidenceList(questions.outcome?.evidence)}</div>
        </article>
        <p class="coach-process-note">${escapeHtml(coach.processPromise || 'The system guarantees a measurable review process, not a guaranteed social-media outcome.')}</p>
      </div>
    </section>`;
  }

  function hideDuplicateSimpleActions(container) {
    container.querySelectorAll('.analytics-subhead').forEach(heading => {
      if (heading.textContent.trim().toLowerCase() !== 'what to do next') return;
      const next = heading.nextElementSibling;
      heading.hidden = true;
      if (next?.classList.contains('action-list')) next.hidden = true;
    });
  }

  function enhance() {
    if (typeof DATA === 'undefined' || !DATA) return;
    const container = document.getElementById('analytics-content');
    const snapshot = container?.querySelector('.person-kpis');
    if (!container || !snapshot) return;
    const person = accountPerson();
    if (!person?.handle || typeof analyticsForPerson !== 'function' || typeof personBlock !== 'function') return;
    if (container.querySelector('#personal-account-coach')) return;
    const analytics = analyticsForPerson(person);
    const block = personBlock(person.handle);
    if (!analytics) return;
    installStyles();
    snapshot.insertAdjacentHTML('afterend', renderCoach(coachFor(person, analytics, block)));
    hideDuplicateSimpleActions(container);
  }

  function start() {
    const container = document.getElementById('analytics-content');
    if (!container) return;
    installStyles();
    const observer = new MutationObserver(() => queueMicrotask(enhance));
    observer.observe(container, { childList: true, subtree: true });
    document.getElementById('analytics-dialog')?.addEventListener('toggle', enhance);
    document.getElementById('analytics-dialog')?.addEventListener('close', () => {});
    enhance();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
