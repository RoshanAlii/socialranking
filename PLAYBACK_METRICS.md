# Playback metric correction · version 2

The dashboard previously normalized Apify `videoViewCount` but ignored
`videoPlayCount`. These counters are not equivalent. The September 9, 2026
07:25:41 UTC company capture contained 298,128 legacy views and 647,825 plays
across the same 17 September Reels. Only the explicit playback counter now
feeds video totals, efficiency, post comparisons and personal analytics.

## Contract

- Instagram `views` is the compatibility key for **video plays** only, sourced
  from valid `videoPlayCount` or `playCount`. Zero is valid. Missing or invalid
  playback values stay null, never a legacy-view fallback.
- Every normalized Instagram post preserves `videoPlayCount`,
  `legacyVideoViewCount`, `viewMetric`, `viewMetricVersion` and `viewSource`.
- Old normalized `views` cannot be reinterpreted as plays. Reused counters keep
  their original observation time. Each four-day refresh re-observes the bounded
  31-day reporting window: merely discovering new posts cannot refresh the
  engagement counters on older posts. IDs remain deduplicated; older historical
  evidence and transcripts are retained, not re-fetched or re-transcribed.
- Month and week select **publication cohorts** in Asia/Dubai: calendar month
  starts on the 1st and week on Monday. Metrics are accumulated counters on
  those published posts, not events earned within the selected date range.
- Likes + comments excludes saves, shares and other private Insights metrics.
- Video plays exclude photo/carousel views and Stories; they are neither
  unique accounts reached nor an official account-level Insights total.
- Incomplete observed totals are minimums, with reporting coverage. Incomplete
  totals cannot enter the explorer's exact-value rankings.
- Company collaborations retain owner/page evidence and are deduplicated by ID;
  company and team aggregates may overlap and must not be added together.

## Evidence and history

The current snapshot can be corrected from its matching retained raw artifact
with `src/rebuild-derived.js --raw-dir PATH`, then source-checked using
`src/validate-snapshot.js --stamp --raw-dir PATH`. This does not advance capture
time or consume Apify credit. Corrections append a `-plays-v2` history revision;
original historical snapshots remain unchanged. Do not backfill old captures
with today's counters or interpret the metric switch as audience growth.

New refreshes record metric definitions/version and validate the company raw
counter mapping as well as individual accounts. Regression checks are in
`test/view-metrics.test.js` and run in snapshot and company-feed workflows.

The combined `instagram-scraper` run returned only 326 rows on September 9,
leaving most previous rows cached. Collection now uses the detailed
`instagram-post-scraper` in separate per-account requests (three concurrent),
while still batching the inexpensive profile lookup. Each request is limited
to 200 posts and $0.75; total refresh reservations cannot exceed $5, and unknown
charges conservatively consume their reservation. There are no automatic paid
retries. Capped, invalid or preview-omitting feeds are marked incomplete; a
preview cannot manufacture a complete window. Current-period deleted/omitted
historical posts are not silently reintroduced as fresh. Publication still
requires the existing coverage and source-validation gates.

## Remaining reconciliation boundary

No claim is made that scraped playback counters exactly equal Meta Insights.
To reconcile account Insights, use an authorized account report with the same
metric, date interval, timezone, content scope and Instagram/Facebook/paid
breakdown. An account-level month-to-date total needs the official Insights
source; it cannot be reconstructed from current-month publication counters.
