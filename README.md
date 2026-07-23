# Kirpa Social Leaderboard

A weekly leaderboard of the Kirpa team's **public** social performance across Instagram, TikTok, and Facebook — most followers, top-performing video, most-commented post, highest engagement, most active, and follower growth — ranked and drilled down per person.

It runs on a schedule with **no logins and no passwords**. It reads only the public surface a logged-out visitor already sees, via a swappable data provider. The dashboard itself is a static page on GitHub Pages; the weekly pull is a GitHub Action.

---

## What it is — and isn't

- **Public-surface data, not an official API.** Meta's official Instagram API only reads accounts that authorise your app; it cannot read arbitrary public profiles. So this reads the same public profile/post numbers a logged-out visitor sees, through a public-data provider (Apify by default). It is a **snapshot**, not real-time, and it can break if a platform changes its markup.
- **Public accounts only.** A private account shows as `Private` (counts only, no post data) and is **never estimated** into a ranking.
- **No fabricated handles.** Name-to-handle matching is where a tool like this quietly pulls a stranger's stats. So handles are **confirm-gated**: every handle sits `confirmed: false` until a human verifies it. Nothing is pulled until then.
- **One shared measurement window.** Every rate metric is computed over the same trailing **30 days** for everyone. The pipeline fetches a fixed number of posts per person, which silently gave one person a 4-day window and another a 485-day window; those were never comparable and are no longer compared.
- **Engagement rate uses the median post, not the mean.** A reel that escapes the follower base can land more likes than the account has followers — one such post produced a reported engagement rate of *86.87%* before this changed. The median describes the typical post, which is the thing a person can actually act on. Posts that out-reach the whole following are counted and surfaced separately, as the signal they are.
- **The headline post board ranks interactions, not views.** Instagram reports view counts on only ~19% of videos here, and mostly older ones (median 63 days old, versus 3 days for posts without). A view-ranked board therefore crowned year-old content and made anyone posting only recently ineligible to win. Views still appear, on their own card, labelled with how little of the data they cover.
- **Unknown is never scored as zero.** A person with a real profile but no posts yet in the window has no engagement rate — that is missing data, not bad performance. Their remaining metrics are reweighted, and if too few can be measured they are shown *unranked* with the reason, rather than placed last.
- **Engagement rate is a within-platform proxy.** A TikTok view is not an Instagram reach, so platforms are ranked separately and the combined score is explicitly normalised, never raw-summed.
- **TikTok is paused.** Switched off by product decision, not by capability: `TIKTOK_ENABLED = false` in `index.html` and TikTok dropped from the default `--platforms`. The tab, the roster column and the aggregates all respect the flag, and the UI reads "available soon" rather than showing a zero. The adapter, normalizer and their tests are untouched — flip the flag and pass `--platforms instagram,tiktok,facebook` to bring it back in one run.
- **Facebook is Pages-only.** Personal FB profiles expose no usable public data; only business Pages do. A `facebook` value in the registry must be a Page id/slug.

### Confirmed so far — 24 of 38 dashboard-relevant staff

Every confirmed handle carries an `evidenceClass` recording *why* it was accepted:

| class | meaning | count |
|---|---|---|
| `bio` | the profile self-declares Kirpa — an `@kirpa.properties` tag or an `@kirpaproperties.com` address | 22 |
| `company-tag` | the Kirpa company account tagged them, with a matching full name | 1 |
| `posting-context` | circumstantial only (office geotags, colleague tags). Carries `needsHumanConfirmation: true` | 1 |

**Handles are never accepted on pattern alone.** The `firstname.kirpa` convention is used only to
*generate* candidates; a live public bio has to confirm them. Two illustrations of why:

- `priyanka.danubeproperties` was supplied as an employee handle. It resolves to a different
  woman — a Senior Sales Manager at Danube Properties. Rejected. The correct account,
  `priyanka.kirpa`, was later found with a Kirpa company email in the bio.
- `nikita.kirpa` resolves to a real account. Blank bio, 2 followers, 1 post, no mention of Kirpa.
  Rejected — a handle matching the pattern is not evidence of employment.

Both rejections stay recorded in `handles.json` so nobody re-probes and "re-discovers" them.

**14 people still have no handle.** Probing found no account at their pattern. That gap closes by
asking HR, not by guessing — see `notes` in `handles.json` for the exact list probed.

> Adding a handle does **not** backfill data. A pipeline run has to happen before anyone appears
> on the board; until then they are absent, never shown as zero.

---

## How it fits together

```
handles.json ──► src/ingest.js ──► src/provider.js  (Apify | Mock)   ← the swap point
                      │                    │
                      │            src/resolver.js   (proposes handles, never confirms)
                      ▼
               src/normalize.js  ──►  src/rank.js  ──►  data/latest.json  ──►  index.html
                                       (leaderboards)     data/history/*      (GitHub Pages)
```

- **`handles.json`** — the roster (seeded from kirpaproperties.com). Names + roles + per-platform handles + a `confirmed` flag. Back-office roles are `dashboardRelevant: false`.
- **`src/rank.js`** — pure ranking engine. Single source of truth, used by both ingest and the tests. No I/O.
- **`src/normalize.js`** — maps any provider's payload into one record shape. Missing fields become `null`, never invented.
- **`src/provider.js`** — the adapter. `MockProvider` (offline/tests/sample) and `ApifyProvider` (live). Swap to EnsembleData/HikerAPI by implementing one method: `fetchProfile(platform, handle)`.
- **`src/resolver.js`** — proposes candidate handles from a name + brand search. Always returns `verified: false`.
- **`src/ingest.js`** — the run: read registry → pull confirmed handles → normalize → build leaderboards → write `data/latest.json` + a dated history snapshot.
- **`index.html`** — the Kirpa-branded dashboard. Reads `data/latest.json`; falls back to an inlined sample so it also opens straight from disk.
- **`.github/workflows/weekly.yml`** — weekly cron (Mondays 06:00 UTC) plus a manual trigger. Test gate → pull → commit the JSON back. Needs `APIFY_TOKEN` as a repo secret; without it the job stops rather than inventing numbers.

---

## Setup

1. **Add handles.** Fill `handles.json`: each person's `instagram` / `tiktok` handle, then set `confirmed: true`. Leave back-office `dashboardRelevant: false`.
2. **Add the provider key.** Create an [Apify](https://apify.com) account, copy your API token, and add it as a repo secret named `APIFY_TOKEN` (Settings → Secrets → Actions).
3. **Enable Pages.** Settings → Pages → deploy from `main`. The dashboard is `index.html`.
4. **Run it.** Actions → *Weekly social snapshot* → *Run workflow*. It writes `data/latest.json` and the page goes live. After that it runs every Monday.

### Live-only policy

This build shows real public data or nothing. There is no placeholder mode in the shipped path:

- **No `APIFY_TOKEN` → the job stops** (`exit 2`). It does not invent numbers to fill the page.
- **A run that resolves zero profiles → the job fails** (`exit 3`) and leaves the previous `data/latest.json` untouched, so a broken provider can never wipe a good snapshot.
- **The dashboard ships with no bundled data.** Before the first pull it renders a setup screen stating that nothing has been pulled yet — not an empty chart that looks like poor performance.
- Sample generation still exists for layout work only, behind an explicit `--allow-sample` flag, and anything it produces is badged `sample`.

All four rules are enforced by the test suite.

## Local preview

```bash
node test/test.js                              # 26 assertions, the deploy gate
export APIFY_TOKEN=...  && node src/ingest.js  # real pull
python3 -m http.server                         # then open http://localhost:8000
```

---

## Cost

At ~40 people across Instagram + TikTok, one run fetches roughly 160–180 results. At Apify's ~$2.30–2.50 per 1,000 results that's about **$0.40 a run** — a weekly cadence sits inside Apify's free monthly credit, so effectively free at this scale. Daily would be a few dollars a month.

## Swapping the provider

`ApifyProvider` is the default. To move to EnsembleData (one key for IG + TikTok) or HikerAPI (cheapest, IG-only), implement `fetchProfile(platform, handle)` returning the same shape and change one line in `src/ingest.js`. `normalize.js` already tolerates varied field names.

---

*Built for the Kirpa Properties AI Officer application. Honesty rules are enforced in code and covered by the test suite, not just documented here.*
