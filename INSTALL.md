# Manpreet cadence correction

Upload these files to the matching repository paths and commit them to `main`.

Correct result for the existing snapshot:

- The snapshot captured only 8 eligible recent posts from an account with 2,105 total posts.
- The captured feed did not reach the start of the 30-day window.
- Therefore the valid 30-day publishing cadence is **unavailable**, not 1.9 posts/week.

What this package changes:

1. Adds `meta.measurementVersion: 2` to refreshed snapshots.
2. Hides engagement, cadence, momentum, top-post and weekly-growth values from older snapshots.
3. Keeps point-in-time follower counts visible.
4. Adds a regression test specifically preventing the 8 / 2,105 case from producing 1.9/week.
5. Makes changes to `index.html` and tests trigger the Instagram workflow.
6. The workflow verifies measurement schema v2 before committing refreshed data.

After the commit reaches `main`, the existing `APIFY_TOKEN` workflow should pull up to 100 Instagram posts per profile and write a new `data/latest.json`.
