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

## Release steps

1. Copy this package into the repository root.
2. Confirm the GitHub secret `APIFY_TOKEN` exists.
3. Commit the source and workflow to `main`.
4. Run **Weekly social snapshot** manually once.
5. Confirm the workflow reaches “Validate and stamp every published answer.”

The first successful run writes a validated version-3 `data/latest.json`. Until
then, the bundled legacy snapshot remains intentionally unranked.
