# Kirpa Social Leaderboard

A weekly leaderboard of the Kirpa team's **public Instagram** performance — profile coverage, audience, posting participation, follower growth, fair engagement and cadence rankings, content records, format performance, and a detailed analytics view for every person.

It runs on a schedule with **no logins and no passwords**. It reads only the public surface a logged-out visitor already sees, via a swappable data provider. The dashboard itself is a static page on GitHub Pages; the weekly pull is a GitHub Action.

---

## What it is — and isn't

- **Public-surface data, not an official API.** Meta's official Instagram API only reads accounts that authorise your app; it cannot read arbitrary public profiles. So this reads the same public profile/post numbers a logged-out visitor sees, through a public-data provider (Apify by default). It is a **snapshot**, not real-time, and it can break if a platform changes its markup.
- **Public accounts only.** A private account shows as `Private` (counts only, no post data) and is **never estimated** into a ranking.
- **No fabricated handles.** Name-to-handle matching is where a tool like this quietly pulls a stranger's stats. So handles are **confirm-gated**: every handle sits `confirmed: false` until a human verifies it. Nothing is pulled until then.
- **One shared measurement window.** Every rate metric is computed over the same trailing **30 days** for everyone. The pipeline fetches a fixed number of posts per person, which silently gave one person a 4-day window and another a 485-day window; those were never comparable and are no longer compared.
- **Engagement rate uses the median post, not the mean.** A reel that escapes the follower base can land more likes than the account has followers — one such post produced a reported engagement rate of *86.87%* before this changed. The median describes the typical post, which is the thing a person can actually act on. Posts that out-reach the whole following are counted and surfaced separately, as the signal they are.
- **The headline post board ranks interactions, not views.** Instagram reports view counts on only ~19% of videos here, and mostly older ones (median 63 days old, versus 3 days for posts without). A view-ranked board therefore crowned year-old content and made anyone posting only recently ineligible to win. Views still appear, on their own card, labelled with how little of the data they cover.
- **Unknown is never scored as zero.** A person with a real profile but no posts yet in the window has no engagement rate — that is missing data, not bad performance. The overall score requires all three inputs; otherwise the person is shown *unranked* with the reason.
- **Engagement uses comparable public inputs.** Instagram share counts are not consistently public, so supported interactions means likes plus comments. A post missing either value is excluded from engagement, never treated as zero.
- **Every profile has its own analytics view.** When the 30-day window is complete, the dashboard exposes posts/week, active days, median post gap, median and total likes/comments, public video views, interaction and comment rates, format mix, best posts, and metric-coverage counts. Legacy snapshots can expose the same fields only as a clearly labelled directional sample.
- **Content records answer separate questions.** Highest likes, highest comments, most public video views, top supported interactions, and top video interactions are not collapsed into one opaque “best post” claim.
- **CSV export is reproducible.** The roster explorer can export all people and all supported analytics, including confidence and metric-coverage columns, for independent checking.
- **TikTok and Facebook are not active yet.** Verified registry entries remain recorded for future adapters, but the production pull and dashboard rankings are Instagram-only.

The product brief and complete scorecard are in [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md).

### Current profile coverage

- **Instagram:** 30 of 38 dashboard-relevant staff have verified Kirpa-facing profiles.
- **Candidate handles:** 4 contextual matches are recorded but excluded from pulls and rankings until a human confirms them — Sara Banu, Nikita Lal Tekwani, Sleeja Misra, and Samaksh Malhotra.
- **TikTok:** 1 of 38 is verified — Manpreet Kaur (`@manpreet.kirpa`). The other 37 remain unconnected until public Kirpa evidence is found or the team confirms their handles.
- **Facebook:** 1 Page is verified — Manpreet Kirpa. Personal Facebook profiles remain out of scope.

For the completed Instagram discovery pass, every accepted match carries an `evidenceClass` recording *why* it was accepted:

| class | meaning | count |
|---|---|---|
| `bio` | the profile self-declares Kirpa — an `@kirpa.properties` tag or an `@kirpaproperties.com` address | 29 |
| `company-tag` | the Kirpa company account tagged them, with a matching full name | 1 |
| `posting-context` | circumstantial only (office geotags, colleague tags). Excluded until human confirmation | 4 candidates |

**Handles are never accepted on pattern alone.** The `firstname.kirpa` convention is used only to
*generate* candidates; a live public bio has to confirm them. Two illustrations of why:

- `priyanka.danubeproperties` was supplied as an employee handle. It resolves to a different
  woman — a Senior Sales Manager at Danube Properties. Rejected. The correct account,
  `priyanka.kirpa`, was later found with a Kirpa company email in the bio.
- `nikita.kirpa` resolves to a real account. Blank bio, 2 followers, 1 post, no mention of Kirpa.
  Rejected — a handle matching the pattern is not evidence of employment. A different exact-name
  professional account was later found and recorded separately with a human-confirmation flag.

Both rejections stay recorded in `handles.json` so nobody re-probes and "re-discovers" them.

**4 people still have no verified professional handle:** Arbaaz Ali Khan, Ameer Agha Shirazi,
Param Singh, and Amandeep Singh. Candidate searches found no Kirpa-facing evidence strong enough
to connect an account. That gap closes by asking the team, not by guessing — see `notes` in
`handles.json` for the exact candidates and rejection reasons.

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
- **`src/rank.js`** — pure ranking and analytics engine. Single source of truth for leaderboards, per-person metrics, format analysis, content records, and coverage. Used by both ingest and the tests. No I/O.
- **`src/normalize.js`** — maps any provider's payload into one record shape. Missing fields become `null`, never invented.
- **`src/provider.js`** — the adapter. `MockProvider` (offline/tests/sample) and `ApifyProvider` (live). The live provider batches confirmed Instagram profiles and performs one date-bounded post query per handle.
- **`src/resolver.js`** — proposes candidate handles from a name + brand search. Always returns `verified: false`.
- **`src/ingest.js`** — the run: read registry → pull confirmed handles → normalize → build leaderboards → write `data/latest.json` + a dated history snapshot.
- **`index.html`** — the Kirpa-branded dashboard. Reads `data/latest.json` for measured performance and `handles.json` for the current verified roster. Newly connected profiles display as `Awaiting pull`, never as zero or missing.
- **`.github/workflows/weekly.yml`** — weekly cron (Mondays 06:00 UTC) plus a manual trigger. Unit-test gate → Instagram pull → full answer recomputation and validation stamp → tests → commit. Needs `APIFY_TOKEN` as a repo secret; without it the job stops rather than inventing numbers.

---

## Setup

1. **Add handles.** Fill `handles.json`: add the Instagram handle and set `confirmed: true` only after Kirpa-owned evidence or direct human confirmation. Leave back-office `dashboardRelevant: false`.
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
node test/test.js                              # formula, provider, UI and release guards
node src/validate-snapshot.js --stamp          # full live post-pull integrity gate
export APIFY_TOKEN=...  && node src/ingest.js  # real pull
python3 -m http.server                         # then open http://localhost:8000
```

---

## Cost

The profile-details pull is batched. Complete cadence requires one date-bounded Instagram post
query per verified profile, run with bounded concurrency. The provider charges according to actor
result volume, so check the selected Apify actors' current pricing before increasing coverage or
the weekly cadence.

## Swapping the provider

`ApifyProvider` is the default. To move to EnsembleData (one key for IG + TikTok) or HikerAPI (cheapest, IG-only), implement `fetchProfile(platform, handle)` returning the same shape and change one line in `src/ingest.js`. `normalize.js` already tolerates varied field names.

---

*Built for the Kirpa Properties AI Officer application. Honesty rules are enforced in code and covered by the test suite, not just documented here.*
