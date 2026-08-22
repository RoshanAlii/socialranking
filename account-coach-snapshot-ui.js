(() => {
  'use strict';

  const isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const canonical = value => String(value || '').replace(/^@/, '').trim().toLowerCase();
  const fmt = value => isNumber(value)
    ? Intl.NumberFormat('en', { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
    : '—';
  const pct = value => isNumber(value)
    ? `${(value * 100).toFixed(Math.abs(value * 100) >= 10 ? 1 : 2)}%`
    : '—';
  const signed = (value, formatter = fmt) => isNumber(value) ? `${value > 0 ? '+' : ''}${formatter(value)}` : '—';
  const best = (rows, key) => (rows || []).filter(row => isNumber(row?.[key])).slice().sort((a, b) => b[key] - a[key])[0] || null;

  function installStyles() {
    if (document.getElementById('account-coach-snapshot-styles')) return;
    const style = document.createElement('style');
    style.id = 'account-coach-snapshot-styles';
    style.textContent = `
      .coach-full-snapshot {
        margin-bottom: 14px;
        padding: 20px;
        border: 1px solid #e3d4c7;
        border-radius: 17px;
        background: #fff;
      }
      .coach-snapshot-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 15px;
      }
      .coach-snapshot-eyebrow {
        color: #f15a29;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .13em;
        text-transform: uppercase;
      }
      .coach-full-snapshot h4 {
        margin: 3px 0 0;
        font-size: 16px;
        letter-spacing: -.015em;
      }
      .coach-snapshot-title-row p {
        max-width: 490px;
        margin: 2px 0 0;
        color: #796f68;
        font-size: 10px;
        line-height: 1.5;
        text-align: right;
      }
      .coach-snapshot-grid {
        display: grid;
        grid-template-columns: repeat(2,minmax(0,1fr));
        gap: 10px;
      }
      .coach-snapshot-card {
        min-width: 0;
        padding: 15px;
        border: 1px solid #eadfd6;
        border-radius: 13px;
        background: #fffaf6;
      }
      .coach-snapshot-card.wide { grid-column: 1 / -1; }
      .coach-snapshot-card h5 {
        margin: 0 0 11px;
        color: #4e4641;
        font-size: 10px;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .coach-snapshot-metrics {
        display: grid;
        grid-template-columns: repeat(2,minmax(0,1fr));
        gap: 8px;
      }
      .coach-snapshot-metric {
        min-width: 0;
        padding: 9px 10px;
        border-radius: 10px;
        background: rgba(255,255,255,.84);
      }
      .coach-snapshot-metric span {
        display: block;
        overflow: hidden;
        color: #796f68;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: .05em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .coach-snapshot-metric b {
        display: block;
        margin-top: 3px;
        font-size: 13px;
        line-height: 1.2;
      }
      .coach-snapshot-metric small {
        display: block;
        margin-top: 3px;
        color: #796f68;
        font-size: 8px;
        line-height: 1.35;
      }
      .coach-snapshot-lines {
        display: grid;
        gap: 7px;
      }
      .coach-snapshot-line {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 7px;
        border-bottom: 1px solid #eee3da;
        color: #655c56;
        font-size: 9px;
      }
      .coach-snapshot-line:last-child { padding-bottom: 0; border-bottom: 0; }
      .coach-snapshot-line b { color: #282421; text-align: right; }
      .coach-snapshot-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .coach-snapshot-chip {
        padding: 5px 8px;
        border: 1px solid #e4d5c9;
        border-radius: 999px;
        background: #fff;
        color: #5f5650;
        font-size: 8px;
        line-height: 1.3;
      }
      .coach-snapshot-empty {
        margin: 0;
        color: #796f68;
        font-size: 9px;
        line-height: 1.5;
      }
      @media (max-width: 720px) {
        .coach-snapshot-title-row { display: block; }
        .coach-snapshot-title-row p { margin-top: 6px; text-align: left; }
        .coach-snapshot-grid { grid-template-columns: 1fr; }
        .coach-snapshot-card.wide { grid-column: auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function currentPerson() {
    const title = document.querySelector('#analytics-content #analytics-title');
    if (!title || typeof rosterPeople !== 'function') return null;
    return rosterPeople().find(person => person.name === title.textContent.trim()) || null;
  }

  function metric(label, value, note = '') {
    return `<div class="coach-snapshot-metric"><span>${esc(label)}</span><b>${esc(value)}</b>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  }

  function line(label, value) {
    return `<div class="coach-snapshot-line"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }

  function pointsFor(handle) {
    if (typeof profilePoints !== 'function') return [];
    return profilePoints(handle).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  function latestChange(points, key) {
    const rows = points.filter(point => isNumber(point[key]));
    if (rows.length < 2) return null;
    const from = rows[rows.length - 2];
    const to = rows[rows.length - 1];
    return { delta: to[key] - from[key], from: from[key], to: to[key], fromAt: from.at, toAt: to.at };
  }

  function personalBest(points, key) {
    const values = points.map(point => point[key]).filter(isNumber);
    return values.length ? Math.max(...values) : null;
  }

  function developerFor(handle) {
    if (typeof MENTIONS === 'undefined' || !MENTIONS) return null;
    return (MENTIONS.creators || []).find(row => canonical(row.handle) === canonical(handle)) || null;
  }

  function snapshotMarkup(person, analytics, block) {
    const points = pointsFor(person.handle);
    const followerChange = latestChange(points, 'followers');
    const cadenceChange = latestChange(points, 'postsPerWeek');
    const engagementChange = latestChange(points, 'engagementRate');
    const percentiles = block?.teamPercentiles || {};
    const score = block?.score || {};
    const pillars = (block?.contentPillars || []).slice();
    const formats = (analytics?.formatPerformance || []).slice();
    const strongestPillar = best(pillars.filter(row => (row.comparablePosts || 0) >= 2), 'medianRate') || best(pillars, 'posts');
    const strongestFormat = best(formats.filter(row => (row.ratedPosts || 0) >= 2), 'medianRate') || best(formats, 'posts');
    const timing = block?.postingTime || {};
    const developer = developerFor(person.handle);
    const goals = block?.goals?.goals || [];
    const achievements = block?.achievements || [];

    const performance = `
      ${metric('Followers', fmt(analytics?.followers), followerChange ? `${signed(followerChange.delta)} since prior capture` : `${points.length} validated capture${points.length === 1 ? '' : 's'}`)}
      ${metric('Posts measured', fmt(analytics?.postsInWindow ?? analytics?.observedPostsInWindow), 'Complete 30-day window where available')}
      ${metric('Posting cadence', isNumber(analytics?.postsPerWeek) ? `${analytics.postsPerWeek.toFixed(2)}/wk` : '—', cadenceChange ? `${signed(cadenceChange.delta, value => value.toFixed(2))}/wk since prior capture` : '')}
      ${metric('Personal interaction', pct(analytics?.interactionRate ?? analytics?.observedInteractionRate), engagementChange ? `${signed(engagementChange.delta, value => `${(value * 100).toFixed(2)} pts`)}` : '')}
      ${metric('Median video views', fmt(analytics?.medianViews), `${analytics?.viewCoverage || 0} videos with public views`)}
      ${metric('View efficiency', isNumber(analytics?.viewEfficiency) ? `${analytics.viewEfficiency.toFixed(2)}×` : '—', 'Median views ÷ followers')}
      ${metric('Momentum score', isNumber(score.value) ? `${Math.round(score.value * 100)}/100` : 'Held', score.rank ? `Rank #${score.rank}` : 'Eligibility incomplete')}
      ${metric('Current rank', score.rank ? `#${score.rank}` : 'Held', score.rank ? 'Among eligible measured accounts' : 'Not enough comparable evidence')}
    `;

    const teamLines = [
      isNumber(percentiles.postsPerWeek) ? line('Cadence percentile', `${percentiles.postsPerWeek}th`) : '',
      isNumber(percentiles.interactionRate) ? line('Engagement percentile', `${percentiles.interactionRate}th`) : '',
      isNumber(percentiles.viewEfficiency) ? line('View-efficiency percentile', `${percentiles.viewEfficiency}th`) : '',
      isNumber(percentiles.followers) ? line('Follower percentile', `${percentiles.followers}th`) : '',
      block?.teamBenchmarks && isNumber(block.teamBenchmarks.postsPerWeek) ? line('Team median cadence', `${block.teamBenchmarks.postsPerWeek.toFixed(2)}/wk`) : '',
      block?.teamBenchmarks && isNumber(block.teamBenchmarks.interactionRate) ? line('Team median interaction', pct(block.teamBenchmarks.interactionRate)) : '',
    ].join('');

    const directionLines = [
      followerChange ? line('Followers', `${signed(followerChange.delta)} since prior capture`) : line('Followers', 'Second comparable capture pending'),
      cadenceChange ? line('Cadence', `${signed(cadenceChange.delta, value => value.toFixed(2))}/week`) : line('Cadence', 'Trend building'),
      engagementChange ? line('Interaction rate', signed(engagementChange.delta, value => `${(value * 100).toFixed(2)} pts`)) : line('Interaction rate', 'Trend building'),
      line('Highest stored followers', fmt(personalBest(points, 'followers'))),
      line('Best stored cadence', isNumber(personalBest(points, 'postsPerWeek')) ? `${personalBest(points, 'postsPerWeek').toFixed(2)}/wk` : '—'),
      line('Best stored engagement', pct(personalBest(points, 'engagementRate'))),
    ].join('');

    const contentLines = [
      strongestPillar ? line('Strongest content pillar', `${strongestPillar.label} · ${strongestPillar.posts} posts`) : line('Strongest content pillar', 'Not enough comparable posts'),
      strongestFormat ? line('Strongest measured format', `${strongestFormat.type} · ${strongestFormat.posts} posts`) : line('Strongest measured format', 'Not enough comparable posts'),
      timing.bestDay ? line('Best measured day', `${timing.bestDay.dayName} · ${timing.bestDay.posts} posts`) : line('Best measured day', 'Not established'),
      timing.bestBlock ? line('Best Dubai-time block', timing.bestBlock.blockLabel) : line('Best Dubai-time block', 'Not established'),
      developer ? line('Developer coverage', `${fmt(developer.reelsWithDeveloperMention)}/${fmt(developer.processedReels)} processed Reels`) : line('Developer coverage', 'Audio intelligence pending'),
      developer ? line('Developer diversity', `${fmt(developer.developerDiversity)} configured developers`) : '',
    ].join('');

    const goalChips = goals.map(goal => {
      const label = goal.metric === 'postsPerWeek' ? 'Cadence' : goal.metric === 'engagementRate' ? 'Engagement' : goal.metric;
      const result = goal.met === null ? 'Not measurable' : goal.met ? 'Target met' : `${Math.round((goal.progress || 0) * 100)}% of target`;
      return `<span class="coach-snapshot-chip"><b>${esc(label)}</b> · ${esc(result)}</span>`;
    });
    const achievementChips = achievements.map(item => `<span class="coach-snapshot-chip"><b>${esc(item.label)}</b> · ${esc(item.evidence)}</span>`);
    const developerChips = (developer?.developerMix || []).slice(0, 5).map(item => `<span class="coach-snapshot-chip">${esc(item.name)} · ${fmt(item.reels)} Reels</span>`);

    return `<section class="coach-full-snapshot" aria-labelledby="coach-full-snapshot-title">
      <div class="coach-snapshot-title-row">
        <div><span class="coach-snapshot-eyebrow">Complete personal snapshot</span><h4 id="coach-full-snapshot-title">Everything currently measured for @${esc(person.handle)}</h4></div>
        <p>This summary consolidates the full Roster Explorer analytics before the five coaching questions. Detailed evidence remains available below.</p>
      </div>
      <div class="coach-snapshot-grid">
        <article class="coach-snapshot-card"><h5>Current performance</h5><div class="coach-snapshot-metrics">${performance}</div></article>
        <article class="coach-snapshot-card"><h5>Team position</h5><div class="coach-snapshot-lines">${teamLines || '<p class="coach-snapshot-empty">Team comparison is held until the account is eligible.</p>'}</div></article>
        <article class="coach-snapshot-card"><h5>Direction and personal records</h5><div class="coach-snapshot-lines">${directionLines}</div></article>
        <article class="coach-snapshot-card"><h5>Content, timing and developers</h5><div class="coach-snapshot-lines">${contentLines}</div>${developerChips.length ? `<div class="coach-snapshot-chips" style="margin-top:10px">${developerChips.join('')}</div>` : ''}</article>
        <article class="coach-snapshot-card wide"><h5>Goals and achievements</h5><div class="coach-snapshot-chips">${[...goalChips, ...achievementChips].join('') || '<p class="coach-snapshot-empty">Goals or achievements will appear when the complete inputs support them.</p>'}</div></article>
      </div>
    </section>`;
  }

  function enhance() {
    const coach = document.querySelector('#analytics-content #personal-account-coach');
    const body = coach?.querySelector('.coach-body');
    if (!coach || !body || body.querySelector('.coach-full-snapshot')) return;
    if (typeof analyticsForPerson !== 'function' || typeof personBlock !== 'function') return;
    const person = currentPerson();
    if (!person) return;
    const analytics = analyticsForPerson(person);
    const block = personBlock(person.handle);
    if (!analytics) return;
    installStyles();
    body.insertAdjacentHTML('afterbegin', snapshotMarkup(person, analytics, block));
  }

  function start() {
    installStyles();
    const container = document.getElementById('analytics-content');
    if (!container) return;
    new MutationObserver(() => queueMicrotask(enhance)).observe(container, { childList: true, subtree: true });
    enhance();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
