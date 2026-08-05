# Kirpa Social Performance release

The dashboard is now version 3 and Instagram-only.

## What the release changes

1. Pulls profile details in one batch and a date-bounded 31-day post feed for each confirmed Instagram handle.
2. Excludes contextual candidate handles until a human confirms them.
3. Requires verifiable post ownership, complete window coverage, and comparable public likes plus comments.
4. Normalizes follower growth to a seven-day equivalent from a baseline 5–9 days old.
5. Recomputes every leaderboard, growth row and content winner before stamping a snapshot as validated.
6. Keeps the previous snapshot live when a pull or validation step fails.
7. Shows old or unstamped snapshots as follower context only.
8. Writes a compact `data/series.json` trend file per capture, so charts never
   need the megabyte-per-day snapshots and raw captures stay out of git.
9. Publishes content intelligence (hashtags, posting times, caption lengths),
   per-person goals, streaks and evidence-backed next actions — all recomputed
   by the validator before the snapshot is stamped.
10. Runs the pull twice a day and alerts on failure, so a single bad run cannot
    silently take the board past its 36-hour freshness gate.

## Release steps

1. Copy this package into the repository root.
2. Confirm the GitHub secret `APIFY_TOKEN` exists.
3. Optional: add `SLACK_WEBHOOK_URL` (weekly digest and failure alerts) and the
   `BOARD_URL` repository variable.
4. Run `node src/backfill-series.js` once to build the trend file from history.
5. Commit the source and workflow to `main`.
6. Run **Daily social snapshot** manually once.
7. Confirm the workflow reaches “Validate and stamp every published answer.”

The first successful run writes a validated version-3 `data/latest.json`. Until
then, the bundled legacy snapshot remains intentionally unranked.
