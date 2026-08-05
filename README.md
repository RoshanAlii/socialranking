# Kirpa Social Leaderboard

A daily leaderboard of the Kirpa team's **public Instagram** performance — profile coverage, audience, posting participation, follower growth, fair engagement and cadence rankings, content records, format performance, trend charts, hashtag and posting-time analysis, per-person goals and streaks, a searchable table of every measured post, and a detailed analytics view for every person.

It runs on a schedule with **no logins and no passwords**. It reads only the public surface a logged-out visitor already sees, via a swappable data provider. The dashboard itself is a static page on GitHub Pages; the daily pull is a GitHub Action.

---

## What it is — and isn't

- **Public-surface data, not an official API.** Meta's official Instagram API only reads accounts that authorise your app; it cannot read arbitrary public profiles. So this reads the same public profile/post numbers a logged-out visitor sees, through a public-data provider (Apify by default). It is a **snapshot**, not real-time, and it can break if a platform changes its markup.
- **Public accounts only.** A private account shows as `Private` (counts only, no post data) and is **never estimated** into a ranking.
- **No fabricated handles.** Name-to-handle matching is where a tool like this quietly pulls a stranger's stats. So handles are **confirm-gated**: every handle sits `confirmed: false` until a human verifies it. Nothing is pulled until then.
- **Roster-locked, and dated rather than blanked.** A validator stamp is valid only for the exact roster version it measured. Two failures used to share one response, and they have now been separated:
  - **Wrong data is still withheld outright.** A snapshot measured against a roster that has since changed, or one that never passed the validator, shows no rankings and no individual metrics. Publishing it would mislead.
  - **Old data is shown under its own date.** A snapshot that passed every check but is more than 36 hours old is published as an *as of 27 Jul 2026* board: the headline, the alert, the freshness tile and the momentum leader all name the date and shift to the past tense, and nothing on the page claims to be current. A blank page tells nobody anything; a dated board tells the truth.
- **Stored captures can be replayed.** `node src/ingest.js --captured --as-of <iso>` recomputes a full snapshot from the raw provider payloads in `data/raw`, and `node src/validate-snapshot.js --replay --stamp` validates it. A replay waives exactly two things — the `live` source label and the age gate — and nothing else: the raw payloads are re-normalized, every leaderboard, content figure, coaching line and trend point is recomputed, and the roster still has to match. It wears the timestamp of the capture it replays, because stamping stored captures with today's date would slide the 30-day window over days nobody measured and turn "we have no data for last week" into "nobody posted last week".
- **One shared measurement window.** Every rate metric is computed over the same trailing **30 days** for everyone. The pipeline fetches a fixed number of posts per person, which silently gave one person a 4-day window and another a 485-day window; those were never comparable and are no longer compared.
- **Engagement rate uses the median post, not the mean.** A reel that escapes the follower base can land more likes than the account has followers — one such post produced a reported engagement rate of *86.87%* before this changed. The median describes the typical post, which is the thing a person can actually act on. Posts that out-reach the whole following are counted and surfaced separately, as the signal they are.
- **The headline post board ranks interactions, not views.** Instagram reports view counts on only ~19% of videos here, and mostly older ones (median 63 days old, versus 3 days for posts without). A view-ranked board therefore crowned year-old content and made anyone posting only recently ineligible to win. Views still appear, on their own card, labelled with how little of the data they cover.
- **Unknown is never scored as zero.** A person with a real profile but no posts yet in the window has no engagement rate — that is missing data, not bad performance. The overall score requires all three inputs; otherwise the person is shown *unranked* with the reason.
- **Engagement uses comparable public inputs.** Instagram share counts are not consistently public, so supported interactions means likes plus comments. A post missing either value is excluded from engagement, never treated as zero.
- **Every profile has its own analytics view.** When the 30-day window is complete, the dashboard exposes posts/week, active days, median post gap, median and total likes/comments, public video views, interaction and comment rates, format mix, best posts, and metric-coverage counts. Legacy snapshots can expose the same fields only as a clearly labelled directional sample.
- **Content records answer separate questions.** Highest likes, highest comments, most public video views, top supported interactions, and top video interactions are not collapsed into one opaque “best post” claim.
- **CSV export is reproducible.** The roster explorer can export all people and all supported analytics, including confidence and metric-coverage columns, for independent checking.
- **Trends are drawn from a separate, tiny history file.** Every capture appends one small numeric point per profile to `data/series.json` — no captions, no post bodies. A year of daily pulls stays in the low hundreds of kilobytes, where a year of full snapshots would be roughly a third of a gigabyte. The file is derived state and can be rebuilt from history at any time with `node src/backfill-series.js`.
- **A chart clears the same bar as a ranking.** Each trend point records the roster version it was measured against and whether the validator accepted it. Points from a superseded roster, or from a capture that never passed validation, are counted and reported as *set aside* rather than plotted. A line that kept moving while the rankings were paused would quietly undo the pause.
- **Improvement is inside the score.** When a valid 5–9 day baseline exists, follower growth becomes a weighted component of the momentum score (10% followers / 40% engagement / 30% cadence / 20% growth). Without a baseline the score falls back to the reviewed 15/45/40 set, and the composition in force is published beside the board. A profile with no baseline is held, not scored as flat.
- **Content analysis is judged against each poster's own baseline.** Rate alone still carries the account inside it: a hashtag used mainly by two small, highly engaged profiles looks like a brilliant hashtag when it is really just those two profiles. So a tag, time slot or caption length is scored by how far its typical post beat *that post's own author's* typical post. A hashtag needs 5+ posts across 3+ profiles, a time slot needs 3+ posts, or it is withheld. Times are stated in Asia/Dubai (UTC+4).
- **There is no hashtag recommendation.** The panel publishes what the data says; it does not turn it into advice. On the first real run the tags that cleared every sample bar were the generic ones everybody already uses, and the engine cheerfully recommended `#insta` to 22 of 31 people. That is a statistic pretending to be a suggestion, and it was removed rather than tuned.
- **Advice carries the number that produced it.** Each person gets up to three next actions derived from their own format mix, cadence, quiet time and the team's timing data — "reels earn 2.3× the typical rate of your images but are 20% of your posts" rather than "repeat what works". Profiles without a provable window get no advice at all.
- **Opting out is honoured at the network boundary.** `optOut: true` in the registry means no fetch, no stored posts, no leaderboard row, no analytics, no export line — the person keeps a roster row reading *Opted out of measurement*. `node src/roster.js opt-out "Name"` also removes their handle from the published registry, and the validator fails the snapshot if an opted-out account appears anywhere in it.
- **The company account is measured but never ranked.** `@kirpa.properties` is pulled for context and charted beside the team total; the validator rejects any snapshot where a brand account has leaked into the ranked record set.
- **Two windows, both server-side.** Boards can be switched between 30 and 7 days. Both are computed by the pipeline and recomputed by the validator; the browser never derives a metric of its own.
- **TikTok and Facebook are not active yet.** The TikTok adapter exists, is tested, and returns the same record shape through one date-bounded query — but production stays Instagram-only until `activePlatforms` in the registry says otherwise, which takes confirmed handles rather than a code change.

The product brief and complete scorecard are in [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md).

### What the board currently shows

The published `data/latest.json` is a **replay of the 27 July 2026 Apify capture**, recomputed against the current roster and validator-stamped. It renders as a dated board:

| | |
|---|---|
| Profiles resolved | 31 of 31 confirmed handles |
| Complete 30-day windows | 27 |
| Posts measured in the window | 822 |
| Ranked on momentum | 23 |
| Held — fewer than 3 comparable posts | 4 |
| Held — window could not be proved in that capture | 4 |
| No confirmed handle in the workbook | 7 |

Follower growth stays unavailable: the two older captures are 3.5 and 4.9 days
before this one, and the baseline rule requires 5–9 days. It fills in on its own
once the daily pull has run for a week.

To replace this with live data, add `APIFY_TOKEN` and run the workflow — the
board switches from *as of 27 Jul* to current automatically.

### Current profile coverage

- **Full roster:** 44 employees from the Kirpa workbook are visible in the roster explorer; six back-office roles are clearly labelled as excluded from rankings.
- **Instagram:** 31 of 38 dashboard-relevant staff have workbook-confirmed Kirpa-facing profiles.
- **Not found:** 7 dashboard-relevant staff have no confirmed Instagram handle — Riya Bhardwaj, Arbaaz Ali Khan, Sleeja Misra, Ameer Agha Shirazi, Param Singh, Anmol Singh, and Amandeep Singh.
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
handles.json ──► src/ingest.js ──► src/provider.js  (Apify | TikTok | Mock)  ← the swap point
    ▲                 │                    │
    │                 │            src/resolver.js   (proposes handles, never confirms)
src/roster.js         ▼
 (maintenance)  src/normalize.js ──► src/rank.js ─────► data/latest.json ──► index.html
                                     src/content.js     data/history/*       (GitHub Pages)
                                     src/series.js ────► data/series.json
                                          │                    ▲
                                          └─ src/validate-snapshot.js ─┘  (stamps both)
                                                      │
                                                 src/digest.js  (Slack, opt-in)
```

- **`handles.json`** — the authoritative 44-person roster imported from `kirpa_team_instagram_handles.xlsx`, with a source hash and roster version. Names + roles + per-platform handles + a `confirmed` flag. Back-office roles remain visible in the full roster but are `dashboardRelevant: false`.
- **`src/rank.js`** — pure ranking and analytics engine. Single source of truth for leaderboards, per-person metrics, format analysis, content records, and coverage. Used by both ingest and the tests. No I/O.
- **`src/normalize.js`** — maps any provider's payload into one record shape. Missing fields become `null`, never invented.
- **`src/provider.js`** — the adapter. `MockProvider` (offline/tests/sample) and `ApifyProvider` (live). The live provider batches confirmed Instagram profiles and performs one date-bounded post query per handle.
- **`src/resolver.js`** — proposes candidate handles from a name + brand search. Always returns `verified: false`.
- **`src/content.js`** — content intelligence: hashtag, posting-time and caption-length performance, weekly streaks, goal progress and the rule-based next actions. Same coverage gate as `rank.js`; every threshold is exported so the page can state it.
- **`src/series.js`** — the compact trend history, plus the validator's `stampValidated` marker. Points are derived with the same gated functions as the live board.
- **`src/roster.js`** — roster maintenance as a command: `status`, `pending`, `set-handle`, `confirm --evidence`, `unconfirm`, `opt-out`, `opt-in`, `target`, `verify`. Refuses duplicate handles, clears confirmation whenever a handle changes, and bumps the roster version so no snapshot measured against the old roster keeps ranking.
- **`src/digest.js`** — the weekly Slack digest. Refuses to summarise a snapshot the validator has not passed, and posts nothing unless `SLACK_WEBHOOK_URL` is configured.
- **`src/backfill-series.js`** — rebuilds `data/series.json` from every stored snapshot, without laundering an unvalidated capture into a validated one.
- **`src/ingest.js`** — the run: read registry → pull confirmed handles → normalize → build leaderboards, content intelligence and per-person coaching → write `data/latest.json`, a dated history snapshot, and the appended trend series.
- **`index.html`** — the Kirpa-branded dashboard. Reads `data/latest.json` for measured performance and `handles.json` for the current verified roster. Newly connected profiles display as `Awaiting pull`, never as zero or missing.
- **`.github/workflows/weekly.yml`** — cron at 04:00 and 16:00 UTC plus a manual trigger. Unit-test gate → roster integrity → Instagram pull → full answer recomputation and roster-bound validation stamp → tests → commit → Monday digest. Needs `APIFY_TOKEN` as a repo secret; without it the job stops rather than inventing numbers. A failed run announces itself: silence is the one failure this board cannot notice on its own. Raw captures are uploaded as an artifact and are no longer committed.

---

## Setup

1. **Add handles.** Fill `handles.json`: add the Instagram handle and set `confirmed: true` only after Kirpa-owned evidence or direct human confirmation. Leave back-office `dashboardRelevant: false`.
2. **Add the provider key.** Create an [Apify](https://apify.com) account, copy your API token, and add it as a repo secret named `APIFY_TOKEN` (Settings → Secrets → Actions).
3. **Enable Pages.** Settings → Pages → deploy from `main`. The dashboard is `index.html`.
4. **Run it.** Actions → *Daily social snapshot* → *Run workflow*. It writes `data/latest.json` and the page goes live. After that it runs every day.

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
node src/roster.js status                      # roster integrity and what is still pending
node src/backfill-series.js                    # rebuild data/series.json from stored history
node src/validate-snapshot.js --stamp          # full live post-pull integrity gate
export APIFY_TOKEN=...  && node src/ingest.js  # real pull
node src/digest.js                             # print the weekly digest (posts nothing)
python3 -m http.server                         # then open http://localhost:8000
```

Rebuilding the published board from the stored captures, without a token:

```bash
node src/ingest.js --captured --as-of 2026-07-27T05:30:07.626Z && node src/validate-snapshot.js --replay --stamp
```

### Roster maintenance

Connecting the four unconnected people, or honouring an opt-out, is a command
rather than a hand-edit of JSON:

```bash
node src/roster.js pending
```

```bash
node src/roster.js set-handle "Param Singh" instagram param.kirpa
```

```bash
node src/roster.js confirm "Param Singh" --evidence "bio tags @kirpa.properties"
```

Setting a handle always clears its confirmation, and every roster change bumps
`rosterVersion` — which is exactly what stops the previous snapshot from
continuing to rank people against a roster that no longer exists.

---

## Cost

The profile-details pull is batched. Complete cadence requires one date-bounded Instagram post
query per verified profile, run with bounded concurrency. The provider charges according to actor
result volume, so check the selected Apify actors' current pricing before increasing coverage or
the daily cadence.

## Swapping the provider

`ApifyProvider` is the default. To move to EnsembleData (one key for IG + TikTok) or HikerAPI (cheapest, IG-only), implement `fetchProfile(platform, handle)` returning the same shape and change one line in `src/ingest.js`. `normalize.js` already tolerates varied field names.

---

*Built for the Kirpa Properties AI Officer application. Honesty rules are enforced in code and covered by the test suite, not just documented here.*
