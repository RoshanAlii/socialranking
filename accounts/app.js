(() => {
  'use strict';

  const CONFIG = window.KIRPA_EMPLOYEE_PORTAL;
  const ROOT = document.getElementById('employee-portal');
  const ACTION_STORAGE_KEY = CONFIG ? `kirpa-action-state:${CONFIG.slug}:v1` : 'kirpa-action-state:unknown';

  const isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const fmt = value => isNumber(value)
    ? Intl.NumberFormat('en', { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
    : '—';
  const pct = value => isNumber(value)
    ? `${(value * 100).toFixed(Math.abs(value * 100) >= 10 ? 1 : 2)}%`
    : '—';
  const dateTime = value => {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'Unavailable';
  };
  const dateOnly = value => {
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleDateString([], { dateStyle: 'medium' })
      : 'Date unavailable';
  };
  const canonical = value => String(value || '').replace(/^@/, '').trim().toLowerCase();
  const safeUrl = value => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch (_) {
      return '';
    }
  };
  const median = values => {
    const numbers = values.filter(isNumber).sort((a, b) => a - b);
    if (!numbers.length) return null;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  };

  function fatal(message) {
    ROOT.innerHTML = `<section class="portal-fatal"><b>Personal portal unavailable</b><p>${esc(message)}</p></section>`;
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function mountLogin() {
    document.body.classList.add('portal-locked');
    ROOT.innerHTML = `
      <section class="employee-login" aria-labelledby="employee-login-title">
        <div class="employee-login-card">
          <div class="login-brand"><span></span>Kirpa Properties</div>
          <p class="eyebrow">Personal performance portal</p>
          <h1 id="employee-login-title">${esc(CONFIG.name)}</h1>
          <p class="login-role">${esc(CONFIG.role || 'Kirpa employee')}</p>
          <p>Enter your first-name password to open your personal analytics and recommended next steps.</p>
          <form id="employee-login-form" autocomplete="off">
            <label for="employee-password">Password</label>
            <div class="login-field">
              <input id="employee-password" type="password" required autofocus autocomplete="current-password">
              <button type="submit">Open portal</button>
            </div>
            <p class="login-error" id="employee-login-error" aria-live="polite"></p>
          </form>
          <small>Passwords are checked without case sensitivity.</small>
        </div>
      </section>`;

    const form = document.getElementById('employee-login-form');
    const input = document.getElementById('employee-password');
    const button = form.querySelector('button');
    const error = document.getElementById('employee-login-error');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.textContent = '';
      button.disabled = true;
      button.textContent = 'Checking…';
      try {
        const candidate = await sha256(input.value.trim().toLowerCase());
        if (candidate !== CONFIG.passwordHash) {
          input.value = '';
          error.textContent = 'Incorrect password. Use the employee’s first name.';
          input.focus();
          return;
        }
        sessionStorage.setItem(CONFIG.sessionKey, CONFIG.passwordHash);
        document.body.classList.remove('portal-locked');
        await loadPortal();
      } catch (_) {
        error.textContent = 'This browser could not verify the password.';
      } finally {
        button.disabled = false;
        button.textContent = 'Open portal';
      }
    });
  }

  function metricCard(label, value, note, tone = '') {
    return `<div class="metric-card ${esc(tone)}"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(note || '')}</small></div>`;
  }

  function seriesChange(points, key) {
    const usable = (points || []).filter(point => point?.validated === true && isNumber(point[key]))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (usable.length < 2) return null;
    const from = usable[usable.length - 2];
    const to = usable[usable.length - 1];
    return {
      from: from[key],
      to: to[key],
      delta: to[key] - from[key],
      fromAt: from.at,
      toAt: to.at,
      days: (Date.parse(to.at) - Date.parse(from.at)) / 86400000,
    };
  }

  function changeText(change, format = fmt) {
    if (!change) return 'Next validated capture will establish movement';
    if (!change.delta) return `Unchanged over ${change.days.toFixed(1)} days`;
    return `${change.delta > 0 ? '+' : ''}${format(change.delta)} over ${change.days.toFixed(1)} days`;
  }

  function coachBlock(data) {
    const person = data.person || {};
    return person.coach || person.accountCoach || person.personalCoach || person.coaching || {};
  }

  function strategyOf(data) {
    const coach = coachBlock(data);
    const declared = data.employee?.strategy;
    const raw = coach.strategy || coach.strategyProfile || coach.accountStrategy || declared || {};
    if (typeof raw === 'string') {
      return { label: raw, statement: raw, source: declared ? 'Declared strategy' : 'Inferred strategy · confirmation needed' };
    }
    return {
      label: raw.label || raw.archetype || raw.primary || raw.positioning || 'Balanced property advisor',
      statement: raw.statement || raw.summary || raw.description || 'Build a consistent, evidence-backed property presence while the system learns which formats and topics produce the strongest response.',
      source: raw.sourceLabel || raw.source || (declared ? 'Declared strategy' : 'Inferred strategy · confirmation needed'),
      objective: raw.objective || raw.primaryObjective || null,
      audience: raw.audience || raw.targetAudience || null,
      capacity: raw.capacity || raw.postsPerWeek || null,
      formats: raw.formats || raw.preferredFormats || null,
    };
  }

  function diagnosisOf(data) {
    const coach = coachBlock(data);
    const raw = coach.diagnosis || coach.constraint || coach.currentConstraint || coach.bottleneck || null;
    if (typeof raw === 'string') return { title: raw, detail: '' };
    if (raw && typeof raw === 'object') {
      return {
        title: raw.title || raw.label || raw.name || 'Current account diagnosis',
        detail: raw.detail || raw.because || raw.explanation || raw.summary || '',
      };
    }
    const analytics = data.analytics || {};
    const benchmarks = data.team?.benchmarks || {};
    if (data.status?.key !== 'complete') return { title: 'Data confidence is the current constraint', detail: data.status?.detail || '' };
    if ((analytics.postsInWindow || 0) < 3) return { title: 'The current sample is too small to optimise confidently', detail: 'Publish enough comparable posts to establish a reliable personal pattern.' };
    if (isNumber(analytics.postsPerWeek) && isNumber(benchmarks.postsPerWeek) && analytics.postsPerWeek < benchmarks.postsPerWeek) {
      return { title: 'Consistency is the primary constraint', detail: `${analytics.postsPerWeek.toFixed(1)} posts/week versus a ${benchmarks.postsPerWeek.toFixed(1)} team median.` };
    }
    if (isNumber(analytics.viewEfficiency) && analytics.viewEfficiency < 1 && isNumber(analytics.interactionRate) && isNumber(benchmarks.interactionRate) && analytics.interactionRate >= benchmarks.interactionRate) {
      return { title: 'Content quality is stronger than content discovery', detail: 'People who see the content respond, but typical video reach remains below the follower base.' };
    }
    if (isNumber(analytics.viewEfficiency) && analytics.viewEfficiency >= 1 && isNumber(analytics.interactionRate) && isNumber(benchmarks.interactionRate) && analytics.interactionRate < benchmarks.interactionRate) {
      return { title: 'Reach is not converting into enough public response', detail: 'Video distribution is healthy, while interaction efficiency remains below the team benchmark.' };
    }
    return { title: 'Protect the current rhythm and deepen the strongest pattern', detail: 'No single critical constraint is stronger than the available positive signals.' };
  }

  function actionsOf(data) {
    const coach = coachBlock(data);
    const raw = coach.actions || coach.recommendations || coach.nextActions || data.person?.nextActions || [];
    return (Array.isArray(raw) ? raw : []).slice(0, 3).map((action, index) => {
      if (typeof action === 'string') return { title: action, priority: index + 1 };
      return {
        title: action.action || action.title || action.recommendation || 'Complete the recommended action',
        because: action.because || action.reason || action.evidence || action.why || '',
        category: action.category || action.type || 'Improve',
        confidence: action.confidence?.label || action.confidence || 'Evidence-backed',
        steps: action.steps || action.execution || action.how || action.instructions || [],
        deadline: action.deadline || action.due || action.reviewAfter || 'Review after the next comparable snapshot',
        success: action.successMeasurement || action.successMetric || action.success || action.measure || 'Compare the next validated result with the current personal baseline.',
        priority: action.priority || index + 1,
      };
    });
  }

  function actionState() {
    try { return JSON.parse(localStorage.getItem(ACTION_STORAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function saveActionState(value) {
    localStorage.setItem(ACTION_STORAGE_KEY, JSON.stringify(value));
  }

  function renderActionCards(actions) {
    const state = actionState();
    if (!actions.length) {
      return '<div class="empty-card"><b>No recommendation yet</b><p>A complete verified measurement window is required before the system issues account-specific advice.</p></div>';
    }
    return actions.map((action, index) => {
      const itemState = state[index] || {};
      const steps = Array.isArray(action.steps) ? action.steps : [action.steps].filter(Boolean);
      return `<article class="action-card" data-action-card="${index}">
        <div class="action-head">
          <span>Priority ${esc(action.priority)}</span>
          <span>${esc(action.category)} · ${esc(action.confidence)}</span>
        </div>
        <h3>${esc(action.title)}</h3>
        ${action.because ? `<p><b>Why:</b> ${esc(action.because)}</p>` : ''}
        ${steps.length ? `<ol>${steps.map(step => `<li>${esc(typeof step === 'string' ? step : step.label || step.text || JSON.stringify(step))}</li>`).join('')}</ol>` : ''}
        <div class="action-measure"><b>Success measurement</b><span>${esc(action.success)}</span></div>
        <div class="action-measure"><b>Review point</b><span>${esc(action.deadline)}</span></div>
        <div class="action-controls">
          <button type="button" data-action-state="planned" data-action-index="${index}" aria-pressed="${itemState.status === 'planned'}">Planned</button>
          <button type="button" data-action-state="completed" data-action-index="${index}" aria-pressed="${itemState.status === 'completed'}">Completed</button>
          ${itemState.status ? `<button class="quiet" type="button" data-action-state="clear" data-action-index="${index}">Reset</button>` : ''}
        </div>
        ${itemState.status ? `<small class="action-status">${esc(itemState.status === 'completed' ? `Completed ${dateTime(itemState.at)} · awaiting a later comparable snapshot` : `Marked planned ${dateTime(itemState.at)}`)}</small>` : ''}
      </article>`;
    }).join('');
  }

  function evaluationMarkup(data, actions) {
    const coach = coachBlock(data);
    const evaluations = coach.evaluations || coach.actionResults || coach.reviews || [];
    if (Array.isArray(evaluations) && evaluations.length) {
      return evaluations.map(result => `<article class="evaluation-card"><span>${esc(result.verdict || result.status || 'Reviewed')}</span><h3>${esc(result.action || result.title || 'Recommendation review')}</h3><p>${esc(result.result || result.summary || result.detail || '')}</p></article>`).join('');
    }
    const states = actionState();
    const tracked = actions.map((action, index) => ({ action, state: states[index] })).filter(item => item.state?.status);
    if (!tracked.length) {
      return '<div class="empty-card"><b>No completed recommendation has been evaluated yet.</b><p>This validated snapshot is the baseline for the first action cycle. Mark an action as completed after executing it.</p></div>';
    }
    return tracked.map(item => `<article class="evaluation-card pending"><span>${esc(item.state.status === 'completed' ? 'Measurement pending' : 'Action planned')}</span><h3>${esc(item.action.title)}</h3><p>${esc(item.state.status === 'completed' ? 'The action is recorded. A later validated snapshot is required before the portal can determine whether the measured result improved.' : 'Complete the action before its result can be evaluated.')}</p></article>`).join('');
  }

  function postInteractions(post) {
    return isNumber(post?.likes) && isNumber(post?.comments) ? post.likes + post.comments : null;
  }

  function postCard(post) {
    const url = safeUrl(post?.url);
    return `<article class="post-card">
      <time>${esc(dateOnly(post?.postedAt))} · ${esc(post?.type || 'post')}</time>
      <p>${esc(post?.caption || 'Instagram post')}</p>
      <div><span>${fmt(post?.likes)} likes</span><span>${fmt(post?.comments)} comments</span><span>${fmt(post?.views)} views</span></div>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Open post ↗</a>` : ''}
    </article>`;
  }

  function componentMarkup(data) {
    const score = data.score || data.person?.score || {};
    const points = score.pointContributions || {};
    const components = score.components || data.person?.score?.components || {};
    const labels = {
      followers: 'Follower context', engagementRate: 'Engagement efficiency',
      postsPerWeek: 'Publishing cadence', followerGrowth: 'Follower growth',
    };
    const rows = Object.keys(labels).map(key => {
      const contribution = points[key];
      const value = components[key];
      if (!isNumber(contribution) && !isNumber(value)) return '';
      const displayed = isNumber(contribution)
        ? `${contribution.toFixed(1)} score points`
        : key === 'engagementRate' || key === 'followerGrowth' ? pct(value) : key === 'postsPerWeek' ? `${value.toFixed(1)}/wk` : fmt(value);
      return `<div class="driver-row"><span>${labels[key]}</span><b>${esc(displayed)}</b></div>`;
    }).join('');
    return rows || '<p class="muted">Score contribution details will appear when all required comparison inputs are available.</p>';
  }

  function renderPortal(data) {
    const analytics = data.analytics || {};
    const person = data.person || {};
    const score = data.score || person.score || {};
    const strategy = strategyOf(data);
    const diagnosis = diagnosisOf(data);
    const actions = actionsOf(data);
    const points = data.series?.points || [];
    const followerChange = seriesChange(points, 'followers');
    const cadenceChange = seriesChange(points, 'postsPerWeek');
    const engagementChange = seriesChange(points, 'engagementRate');
    const rank = score.rank || person.score?.rank || null;
    const scoreValue = isNumber(score.score) ? score.score : person.score?.value;
    const handle = data.employee?.handles?.instagram || data.record?.handle || null;
    const profileUrl = handle ? `https://www.instagram.com/${encodeURIComponent(canonical(handle))}/` : '';
    const posts = (data.record?.recentPosts || []).slice().sort((a, b) => Date.parse(b.postedAt || '') - Date.parse(a.postedAt || ''));
    const reels = posts.filter(post => post.type === 'reel' || post.type === 'video');
    const rankedReels = reels.map(post => ({ post, interactions: postInteractions(post) })).filter(row => isNumber(row.interactions)).sort((a, b) => b.interactions - a.interactions);
    const percentiles = person.teamPercentiles || analytics.percentiles || {};
    const benchmarks = data.team?.benchmarks || person.teamBenchmarks || {};
    const pillars = person.contentPillars || [];
    const formats = analytics.formatPerformance || [];
    const goals = person.goals?.goals || [];
    const achievements = person.achievements || [];
    const timing = person.postingTime || {};
    const developer = data.developer || null;
    const metricCoverage = analytics.metricCoverage || analytics.observedMetricCoverage || {};

    ROOT.innerHTML = `
      <header class="account-hero">
        <div class="account-nav">
          <a class="brand-link" href="../../"><span></span>Kirpa Properties</a>
          <button id="employee-logout" type="button">Lock portal</button>
        </div>
        <div class="hero-copy">
          <div>
            <span class="status-pill ${esc(data.status?.key || 'unknown')}">${esc(data.status?.label || 'Status unavailable')}</span>
            <p class="eyebrow">Your social performance snapshot</p>
            <h1>${esc(data.employee?.name || CONFIG.name)}</h1>
            <p>${esc(data.employee?.role || CONFIG.role || 'Kirpa employee')} ${handle ? `· <a href="${esc(profileUrl)}" target="_blank" rel="noopener">@${esc(handle)}</a>` : '· Instagram handle pending'}</p>
          </div>
          <div class="hero-time"><span>Latest snapshot</span><b>${esc(dateTime(data.snapshot?.capturedAt))}</b><small>${esc(data.snapshot?.timezone || 'Asia/Dubai')}</small></div>
        </div>
        <div class="hero-diagnosis"><span>Current diagnosis</span><b>${esc(diagnosis.title)}</b><p>${esc(diagnosis.detail)}</p></div>
      </header>

      <main class="portal-main">
        <section class="portal-section snapshot-section" aria-labelledby="snapshot-title">
          <div class="section-head"><div><span class="eyebrow">Complete personal snapshot</span><h2 id="snapshot-title">Everything currently measured for this account</h2></div><span>${esc(data.status?.label || '')}</span></div>
          <div class="metric-grid">
            ${metricCard('Momentum score', isNumber(scoreValue) ? `${Math.round(scoreValue * 100)}/100` : 'Held', rank ? `Team rank #${rank} of ${data.team?.eligibleMomentumProfiles || 'eligible profiles'}` : (person.score?.eligibilityReasons || []).join(' · ') || 'Building a comparable sample')}
            ${metricCard('Followers', fmt(analytics.followers ?? data.record?.followers), changeText(followerChange, fmt), followerChange?.delta > 0 ? 'positive' : followerChange?.delta < 0 ? 'negative' : '')}
            ${metricCard('30-day posts', fmt(analytics.postsInWindow), analytics.windowComplete ? 'Complete verified window' : analytics.coverageReason || 'Withheld')}
            ${metricCard('Publishing cadence', isNumber(analytics.postsPerWeek) ? `${analytics.postsPerWeek.toFixed(1)}/wk` : '—', changeText(cadenceChange, value => `${value.toFixed(1)}/wk`))}
            ${metricCard('Interaction rate', isNumber(analytics.interactionRate ?? analytics.observedInteractionRate) ? pct(analytics.interactionRate ?? analytics.observedInteractionRate) : '—', changeText(engagementChange, value => `${(value * 100).toFixed(2)} pp`))}
            ${metricCard('Median video views', fmt(analytics.medianViews), `${fmt(analytics.viewsReporting)}/${fmt(metricCoverage.videos)} videos reporting`)}
            ${metricCard('View efficiency', isNumber(analytics.viewEfficiency) ? `${analytics.viewEfficiency.toFixed(2)}×` : '—', 'Median video views ÷ followers')}
            ${metricCard('Median interactions', fmt(analytics.medianInteractions), `${fmt(analytics.comparablePosts)} supported posts`)}
            ${metricCard('Median likes', fmt(analytics.medianLikes), `${fmt(analytics.likesReporting)}/${fmt(metricCoverage.posts)} posts reporting`)}
            ${metricCard('Median comments', fmt(analytics.medianComments), `${fmt(analytics.commentsReporting)}/${fmt(metricCoverage.posts)} posts reporting`)}
            ${metricCard('Active publishing days', fmt(analytics.activeDays), 'Distinct publishing dates in the window')}
            ${metricCard('Latest post', analytics.latestPostAt ? dateOnly(analytics.latestPostAt) : '—', isNumber(person.daysSinceLastPost) ? `${person.daysSinceLastPost} days before capture` : 'Recency unavailable')}
          </div>

          <div class="snapshot-columns">
            <article class="panel-block"><span class="eyebrow">Team position</span><h3>Anonymous benchmark comparison</h3><div class="comparison-grid">
              ${metricCard('Cadence percentile', isNumber(percentiles.postsPerWeek) ? `${percentiles.postsPerWeek}th` : '—', isNumber(benchmarks.postsPerWeek) ? `Team median ${benchmarks.postsPerWeek.toFixed(1)}/wk` : 'Benchmark unavailable')}
              ${metricCard('Engagement percentile', isNumber(percentiles.interactionRate) ? `${percentiles.interactionRate}th` : '—', isNumber(benchmarks.interactionRate) ? `Team median ${pct(benchmarks.interactionRate)}` : 'Benchmark unavailable')}
              ${metricCard('View-efficiency percentile', isNumber(percentiles.viewEfficiency) ? `${percentiles.viewEfficiency}th` : '—', isNumber(benchmarks.viewEfficiency) ? `Team median ${benchmarks.viewEfficiency.toFixed(2)}×` : 'Benchmark unavailable')}
              ${metricCard('Follower percentile', isNumber(percentiles.followers) ? `${percentiles.followers}th` : '—', isNumber(benchmarks.followers) ? `Team median ${fmt(benchmarks.followers)}` : 'Benchmark unavailable')}
            </div></article>
            <article class="panel-block strategy-panel"><span class="eyebrow">My account strategy</span><h3>${esc(strategy.label)}</h3><p>${esc(strategy.statement)}</p><div class="strategy-tags">
              <span>${esc(strategy.source)}</span>
              ${strategy.objective ? `<span>Objective: ${esc(strategy.objective)}</span>` : ''}
              ${strategy.audience ? `<span>Audience: ${esc(Array.isArray(strategy.audience) ? strategy.audience.join(', ') : strategy.audience)}</span>` : ''}
              ${strategy.capacity ? `<span>Capacity: ${esc(strategy.capacity)}</span>` : ''}
            </div></article>
          </div>

          <div class="snapshot-columns">
            <article class="panel-block"><span class="eyebrow">Direction of travel</span><h3>Latest validated movement</h3>
              <div class="driver-row"><span>Followers</span><b>${esc(changeText(followerChange, fmt))}</b></div>
              <div class="driver-row"><span>Posting cadence</span><b>${esc(changeText(cadenceChange, value => `${value.toFixed(1)}/wk`))}</b></div>
              <div class="driver-row"><span>Engagement rate</span><b>${esc(changeText(engagementChange, value => `${(value * 100).toFixed(2)} pp`))}</b></div>
            </article>
            <article class="panel-block"><span class="eyebrow">Score drivers</span><h3>What currently contributes to Momentum</h3>${componentMarkup(data)}</article>
          </div>

          ${(achievements.length || goals.length) ? `<div class="snapshot-columns">
            <article class="panel-block"><span class="eyebrow">Achievements</span><h3>Current recognised strengths</h3>${achievements.length ? `<div class="chip-list">${achievements.map(item => `<span title="${esc(item.evidence || '')}">${esc(item.label || item.key)}</span>`).join('')}</div>` : '<p class="muted">Achievements appear after repeatable strengths clear their evidence thresholds.</p>'}</article>
            <article class="panel-block"><span class="eyebrow">Targets</span><h3>Progress against personal goals</h3>${goals.length ? goals.map(goal => `<div class="goal-row"><span>${esc(goal.metric)}</span><b>${isNumber(goal.value) ? (goal.metric === 'engagementRate' ? pct(goal.value) : goal.value.toFixed(1)) : '—'} / ${goal.metric === 'engagementRate' ? pct(goal.target) : goal.target}</b><i><em style="width:${isNumber(goal.progress) ? Math.min(100, Math.max(0, goal.progress * 100)) : 0}%"></em></i></div>`).join('') : '<p class="muted">No personal targets are configured.</p>'}</article>
          </div>` : ''}
        </section>

        <section class="portal-section questions-section" aria-labelledby="questions-title">
          <div class="section-head"><div><span class="eyebrow">Personal coaching</span><h2 id="questions-title">Five questions this portal must answer</h2></div></div>

          <article class="question-card" id="data-confidence">
            <div class="question-number">1</div><div><h2>Is my data complete and current?</h2><div class="answer-banner ${esc(data.status?.key || '')}"><b>${esc(data.status?.label || 'Status unavailable')}</b><span>${esc(data.status?.detail || '')}</span></div>
            <div class="answer-details"><span>Snapshot: <b>${esc(dateTime(data.snapshot?.capturedAt))}</b></span><span>30-day posts: <b>${fmt(analytics.postsInWindow)}</b></span><span>Likes coverage: <b>${fmt(metricCoverage.likes)}/${fmt(metricCoverage.posts)}</b></span><span>View coverage: <b>${fmt(metricCoverage.videoViews)}/${fmt(metricCoverage.videos)}</b></span></div></div>
          </article>

          <article class="question-card">
            <div class="question-number">2</div><div><h2>How am I performing?</h2><p class="lead-answer">${esc(diagnosis.title)}</p><p>${esc(diagnosis.detail || 'Use the personal snapshot and anonymous team benchmarks above to understand the current result.')}</p>
            <div class="answer-details"><span>Momentum: <b>${isNumber(scoreValue) ? `${Math.round(scoreValue * 100)}/100` : 'Held'}</b></span><span>Rank: <b>${rank ? `#${rank}` : 'Held'}</b></span><span>Cadence: <b>${isNumber(analytics.postsPerWeek) ? `${analytics.postsPerWeek.toFixed(1)}/wk` : '—'}</b></span><span>Interaction rate: <b>${pct(analytics.interactionRate ?? analytics.observedInteractionRate)}</b></span></div></div>
          </article>

          <article class="question-card">
            <div class="question-number">3</div><div><h2>Why did my result improve or decline?</h2><p>The movement below uses this account’s own validated captures. It does not infer a trend from an incomplete pull.</p><div class="driver-panel">${componentMarkup(data)}</div>
            <div class="answer-details"><span>Followers: <b>${esc(changeText(followerChange, fmt))}</b></span><span>Cadence: <b>${esc(changeText(cadenceChange, value => `${value.toFixed(1)}/wk`))}</b></span><span>Engagement: <b>${esc(changeText(engagementChange, value => `${(value * 100).toFixed(2)} pp`))}</b></span></div></div>
          </article>

          <article class="question-card actions-question">
            <div class="question-number">4</div><div><h2>What exactly should I do next?</h2><p>Only the three highest-priority actions are shown. Each must fit the account strategy, evidence and practical publishing capacity.</p><div class="action-grid" id="employee-actions">${renderActionCards(actions)}</div></div>
          </article>

          <article class="question-card">
            <div class="question-number">5</div><div><h2>Did the recommended action actually work?</h2><p>The portal records completion separately from success. It will not label an action successful until a later comparable measurement exists.</p><div class="evaluation-grid" id="employee-evaluations">${evaluationMarkup(data, actions)}</div></div>
          </article>
        </section>

        <section class="portal-section evidence-section" aria-labelledby="evidence-title">
          <div class="section-head"><div><span class="eyebrow">Evidence layer</span><h2 id="evidence-title">What this account publishes and what performs</h2></div></div>
          <div class="snapshot-columns">
            <article class="panel-block"><span class="eyebrow">Content pillars</span><h3>Current topic mix</h3>${pillars.length ? `<div class="content-list">${pillars.map(row => `<div><b>${esc(row.label)}</b><span>${fmt(row.posts)} posts · ${Math.round((row.share || 0) * 100)}% of output · median ${fmt(row.medianInteractions)} interactions</span></div>`).join('')}</div>` : '<p class="muted">No content-pillar pattern is available.</p>'}</article>
            <article class="panel-block"><span class="eyebrow">Formats</span><h3>Current content mix</h3>${formats.length ? `<div class="content-list">${formats.map(row => `<div><b>${esc(row.type)}</b><span>${fmt(row.posts)} posts · median ${fmt(row.medianInteractions)} interactions</span></div>`).join('')}</div>` : '<p class="muted">No format pattern is available.</p>'}</article>
          </div>
          <div class="snapshot-columns">
            <article class="panel-block"><span class="eyebrow">Posting-time pattern</span><h3>Best measured timing</h3><div class="content-list">
              ${timing.bestDay ? `<div><b>${esc(timing.bestDay.dayName)}</b><span>${fmt(timing.bestDay.posts)} posts · median rate ${pct(timing.bestDay.medianRate)}</span></div>` : '<div><b>Day pattern building</b><span>At least two rated posts on a day are required.</span></div>'}
              ${timing.bestBlock ? `<div><b>${esc(timing.bestBlock.blockLabel)}</b><span>Dubai time · ${fmt(timing.bestBlock.posts)} posts · median rate ${pct(timing.bestBlock.medianRate)}</span></div>` : '<div><b>Time-block pattern building</b><span>At least two rated posts in a block are required.</span></div>'}
            </div></article>
            <article class="panel-block"><span class="eyebrow">Developer coverage</span><h3>Developer intelligence</h3>${developer ? `<div class="comparison-grid">
              ${metricCard('Developer share', pct(developer.developerShare), `${fmt(developer.reelsWithDeveloperMention)}/${fmt(developer.processedReels)} processed Reels`)}
              ${metricCard('Developer diversity', fmt(developer.developerDiversity), 'Unique configured developers')}
              ${metricCard('Spoken mentions', fmt(developer.totalDeveloperMentions), 'Matched developer words')}
              ${metricCard('Audio coverage', pct(developer.processingCoverage), `${fmt(developer.processedReels)}/${fmt(developer.totalReels)} Reels processed`)}
            </div>` : '<p class="muted">Developer-level audio intelligence has not yet been connected to this personal payload.</p>'}</article>
          </div>

          ${rankedReels.length ? `<h3 class="evidence-subhead">Top Reels by supported interactions</h3><div class="post-grid">${rankedReels.slice(0, 3).map(row => postCard(row.post)).join('')}</div>
          <h3 class="evidence-subhead">Lowest Reels by supported interactions</h3><div class="post-grid">${rankedReels.slice().reverse().slice(0, 3).map(row => postCard(row.post)).join('')}</div>` : ''}
          <h3 class="evidence-subhead">Posts available in this personal payload</h3>
          <div class="post-grid">${posts.length ? posts.slice(0, 12).map(postCard).join('') : '<div class="empty-card"><b>No public posts available</b><p>The current snapshot contains no post rows for this account.</p></div>'}</div>
        </section>
      </main>
      <footer class="portal-footer"><span><b>${esc(data.snapshot?.company || 'Kirpa Properties L.L.C')}</b>${data.snapshot?.orn ? ` · ORN ${esc(data.snapshot.orn)}` : ''}</span><span>Personal payload · snapshot, not real-time</span></footer>`;

    document.getElementById('employee-logout').addEventListener('click', () => {
      sessionStorage.removeItem(CONFIG.sessionKey);
      location.reload();
    });
    document.getElementById('employee-actions')?.addEventListener('click', event => {
      const button = event.target.closest('[data-action-state]');
      if (!button) return;
      const index = Number(button.dataset.actionIndex);
      const state = actionState();
      if (button.dataset.actionState === 'clear') delete state[index];
      else state[index] = { status: button.dataset.actionState, at: new Date().toISOString(), snapshotAt: data.snapshot?.capturedAt || null };
      saveActionState(state);
      document.getElementById('employee-actions').innerHTML = renderActionCards(actions);
      document.getElementById('employee-evaluations').innerHTML = evaluationMarkup(data, actions);
    });
  }

  async function loadPortal() {
    ROOT.innerHTML = '<div class="portal-loading">Loading your employee-specific analytics…</div>';
    try {
      const response = await fetch(CONFIG.dataUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Personal data returned HTTP ${response.status}`);
      const data = await response.json();
      if (canonical(data.employee?.name) !== canonical(CONFIG.name)) throw new Error('The personal payload does not match this account link.');
      renderPortal(data);
    } catch (error) {
      fatal(error.message || error);
    }
  }

  if (!CONFIG || !ROOT) {
    if (ROOT) fatal('Portal configuration is missing.');
    return;
  }
  if (sessionStorage.getItem(CONFIG.sessionKey) === CONFIG.passwordHash) {
    loadPortal();
  } else {
    mountLogin();
  }
})();
