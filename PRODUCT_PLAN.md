# Kirpa Social Leaderboard — Product Plan

## Goal

Create healthy, evidence-based competition across Kirpa Properties' public
social profiles. The board must reward recent, controllable behaviour—not only
audience size—and give every team member a practical next step.

## Questions the board must answer

1. Who improved fastest since the previous snapshot?
2. Who earns the strongest typical engagement?
3. Who publishes consistently in the same rolling window?
4. Which recent posts create the most conversation and interaction?
5. Who is inactive, missing data, private, or awaiting a verified handle?
6. What should each person do next to improve?

## Dashboard structure

### 1. Executive summary

- Snapshot freshness and data source
- Verified-profile coverage
- Active profiles and posts in the trailing 30 days
- Team audience and weekly follower change
- Profiles needing attention

### 2. Healthy-competition leaderboards

- Overall momentum score
- Fastest follower growth (percentage and absolute)
- Highest typical engagement
- Most consistent posting
- Most conversations generated
- Best recent post by interactions
- Rising stars

### 3. Team insights

- Participation rate
- Profiles with no recent posts
- Profiles whose cadence declined
- Median team benchmarks
- Data-quality and profile-verification queue

### 4. Member profiles

- Current public handles and direct profile links
- Followers and follower growth
- Typical engagement and team benchmark
- Posts per week
- Recent top posts
- Current rank by metric
- A rule-based next action

### 5. Controls

- Platform filter
- Time-window label
- Search by name or role
- Sortable roster
- Clear metric definitions

## Fairness rules

- Use one trailing 30-day window for all recent-performance metrics.
- Use median interactions per post for typical engagement.
- Exclude pinned posts from recent activity and current-performance rankings.
- Keep platforms separate unless metrics are normalized.
- Treat missing and private data as unknown, never zero.
- Require enough measured inputs before assigning an overall rank.
- Keep follower count visible but low-weighted because it reflects accumulated
  history more than current effort.
- Show freshness, coverage, sample size, and provider limitations.
- Verify handles using Kirpa-owned evidence; never accept a guessed pattern.

## Definition of done

- Every current Kirpa team member is represented.
- Every confirmed public handle has recorded evidence.
- The scheduled pipeline refreshes the board and preserves prior snapshots.
- Published metrics use one definition everywhere on the page.
- Missing data is clearly labelled and never silently scored.
- Tests cover scoring, ingestion, refresh configuration, and rendering guards.
- The deployed GitHub Pages board loads without console errors and works on
  desktop and mobile.
