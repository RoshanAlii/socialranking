# Verified Instagram cadence fix

## Formula

`posts per week = N × 7 ÷ 30`

`N` is the number of **unique posts authored by the Instagram profile** whose publication timestamp falls between the snapshot time minus 30 days and the snapshot time.

## Inputs used

1. A single `capturedAt` timestamp shared by every profile.
2. Public follower/profile details from `apify/instagram-profile-scraper`.
3. Public posts from `apify/instagram-scraper`, requested separately for each profile with:
   - `resultsType: posts`
   - `onlyPostsNewerThan: 31 days`
   - `resultsLimit: 200`
4. Post owner username, post ID/permalink and publication timestamp.

## Counting rules

- Recent pinned posts count because they were genuinely published in the window.
- Old pinned posts do not count because their timestamp is outside the window.
- Duplicate results count once.
- Posts owned by another profile are excluded.
- The dashboard never extrapolates from 12 posts.
- If the post query fails or reaches 200 results before reaching the 30-day cutoff, the cadence is withheld as `—`.

## Why the previous output was wrong

The profile actor returns only the latest 12 posts in its profile payload. `resultsLimit: 100` did not expand that nested `latestPosts` array. Active profiles were therefore undercounted.

## Validation

- 17 JavaScript tests passed.
- Independent Python recomputation matched 5/5 test rows exactly.
- The post-ingestion validator independently recomputes every stored cadence row and rejects altered values.

## Installation

Copy these paths into the repository root and commit to `main`:

- `src/provider.js`
- `src/normalize.js`
- `src/rank.js`
- `src/ingest.js`
- `src/validate-snapshot.js`
- `test/test.js`
- `.github/workflows/weekly.yml`
- `index.html`

The workflow runs automatically when the source files reach `main`, using the existing `APIFY_TOKEN`. It writes a new version-3 `data/latest.json` after validation.
