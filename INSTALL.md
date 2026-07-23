# Instagram-first dashboard fix

Replace the matching files in the repository root with the files in this package, then commit/push to `main`.

The included workflow runs automatically after the source/workflow files reach `main`. It will use the existing `APIFY_TOKEN`, pull Instagram only, validate the new 30-day fairness rules, and commit a refreshed `data/latest.json` snapshot.

## What changes

- Instagram is the only active platform.
- TikTok and Facebook are displayed as **Available soon** and do not affect any total or ranking.
- Up to 100 recent Instagram posts are pulled per profile.
- Engagement, cadence, participation, top-post and momentum rankings require a complete common 30-day feed.
- Engagement requires at least three posts.
- Pinned posts are excluded.
- Growth is shown only against a baseline 5–9 days old, nearest to seven days.
- The audience KPI is labelled specifically as Instagram followers.
- Automated tests cover partial feeds, small samples, pinned posts and weekly-baseline selection.
