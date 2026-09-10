# Public performance evidence

## Metric contract

Apify public data only; no Buffer ingestion or individual Instagram logins.
Posts are distinct published feed objects, including Reels, images and carousels
(one carousel = one post). Agent totals use owned posts. Company page totals also
include evidenced page collaborations. Drafts and Stories are not feed posts.

All publication filters use Asia/Dubai. Calendar months start on the 1st; weeks
start Monday. Counters are accumulated values on posts published within the
selected dates, not interactions/plays earned during those dates. `videoPlayCount`
is kept distinct from legacy `videoViewCount`. Null is not zero. Shares have their
own source and observation date and are explicitly a reporting subset.

Private profile visits, unique reach, saves, Story views and Instagram Insights
totals cannot be reconstructed. No estimates of these are published.

## Collection and history

The existing 96-hour feed refresh remains unchanged. On each validated refresh,
`src/update-public-evidence.js` merges normalized public counters into a 90-day
archive without another Apify request. Older counters keep their original dates;
they are not represented as fresh. Score formulas and inputs remain unchanged.
Comparisons subtract the same post and same counter in two captures, exclude new
posts, retain negative corrections, and disclose matched-post sample sizes.

Manual `Public performance evidence` workflow modes:

- `pilot`: five confirmed public accounts, 90-day bounded feed.
- `remaining`: accounts not already completed by this one-time backfill.
- `shares`: five recent Reel URLs per pilot account with public share counts.
- `reconcile`: re-read charges for already completed runs; starts no Actors.

The backfill and share pilot share a persistent **$8 total allowance**, reserve
**$0.75 before each paid call**, never retry paid calls automatically, and pause
on ambiguous requests. Completed account results and the allowance are stored in
Apify `kirpa-public-history-v1`, preventing duplicate charges after interruptions.
This is not a recurring monthly allowance. Source files/captions/media are not
included in the published evidence file. The share pilot disables transcription
and video downloads. Additional recurring share collection requires a validated
pilot and a separately scoped budget decision.

Charges reported immediately on completion can be provisional. Before any later
batch, completed-run charges are re-read and the ledger adjusted; the manual
`reconcile` mode performs just this accounting refresh. `costsCheckedAt` records
that check. Final invoiced usage remains authoritative.

Manual evidence writers serialize with the four-day feed workflow and resolve
the current branch when the job starts (not the SHA pinned when it was queued).
This prevents a queued collection from rebasing an old evidence file over a
preceding collection. PR validation uses a separate concurrency group. A saved
collection can be republished using `reconcile` without another paid scrape.

## Initial rollout verification — 10 September 2026

- 32/32 confirmed public accounts passed the bounded history checks.
- Archive contains 2,786 distinct post identities across the account views.
- Share pilot: 25/25 requested Reels returned numeric share counts.
- Reconciled history/share charges: $7.4414 against the $8 allowance.
- Separate due Story check: 32/32 accounts checked, 149 observations, no rejected
  rows or result cap. Story allowance remains $8/month; it was not increased.
- One queued publication conflict was recovered from saved checkpoints without
  paid re-collection; branch checkout and writer serialization were corrected.

Feed checks reject missing identity/owner/date, mismatched profile evidence,
preview omissions and results/charge caps. “Checked” is source validation, not a
guarantee that Instagram exposes every post. Failed backfills do not replace
the last checked record. Deleted posts previously captured remain historical
observations, explicitly dated, not freshly verified publishing.

## Verification

`node --test test/public-evidence.test.js` checks Dubai boundaries, deduplication,
company/team scope, missing vs zero, legacy counter exclusion, retained evidence,
matched-post deltas, negative corrections and live-file reconciliation. Existing
company, view, roster and score tests remain release checks. Build and GitHub
Pages publication are checked before handoff.

Actor contracts inspected 10 September 2026:
- https://apify.com/apify/instagram-post-scraper/input-schema
- https://apify.com/apify/instagram-reel-scraper/input-schema

Public scrape limitations and differing observation times must accompany any
comparison with account-owner Insights.
