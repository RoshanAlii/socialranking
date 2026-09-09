# Apify-only public Story activity

This surface reports public marketing publishing observations, not private Instagram Insights. Buffer is not an ingestion source. Feed totals, feed cadence, momentum and team rankings remain unchanged.

## Sources and collection

- `intropix/instagram-stories-scraper`, public active Stories, no agent login.
- Confirmed resolved public Instagram roster from the validated snapshot, plus the company account. Never expand targets using Story mentions or co-authors.
- Scheduled checks at 08:20 and 20:20 Dubai, separate from the four-day feed collector. GitHub schedules can be delayed.
- Pilot: three confirmed marketing accounts; initial 30-result limit correctly marked partial. Follow-up returned 41 validated records with all three target checks confirmed and no truncation.
- Maximum $0.50 per production run; $8 monthly Story allowance, configured in `config/stories.json`. Budget is reserved before each paid start. No automatic paid retries. Unknown outcomes retain the reservation and require review before another run.
- Costs shown are Apify run-reported charges/reservations, not the account's invoice or a guarantee against other platform storage/compute charges. Existing feed and developer-analysis budgets remain separate.

## Definitions

Each stable Story ID is counted once for its author and Dubai publication date. Image/video Stories are separate from feed images/videos. Counts are observed minimums, not a complete lifetime or monthly Instagram archive. A shared Story and its original feed post are different publishing events, never merged into a reach metric.

An empty dataset proves no active Stories only if the run succeeded, the actor's OUTPUT confirms outcome/target coverage, the delivered count matches, no targets failed and no result cap was reached. Bad timestamps, private accounts, foreign authors and lossy numeric IDs are rejected. Any such validation issue prevents claims of a complete check. Check success measures collection execution, not absolute completeness against Instagram.

Month starts at Dubai midnight on the first. Week starts on Monday. The 30-day Story view is 30 Dubai calendar dates including today, explicitly distinct from the feed's rolling 30×24-hour window. Historical or early-deleted Stories may be missed even during successful monitoring. A stale last successful check must not display as fresh merely because the page reloaded.

## Storage and privacy

The dedicated Apify key-value store retains minimal deduplication IDs for up to 30 days. No downloaded Story media, captions, contacts, or mention lists are persisted by this collector. GitHub Pages receives derived daily image/video counts and collection metadata only—not a republished raw Story dataset. Source datasets created by the Actor remain in Apify; set their retention in the Apify console according to the business retention policy.

Partial or failed collections preserve previous observations and the last successful timestamp. Pilot state is isolated from production. Failed workflow summaries are published when possible so a failed refresh cannot silently appear current. In-flight/ambiguous requests remain locked to prevent duplicate paid starts; inspect the named Apify run and reconcile the STATE record before clearing the lock.

## Validation

`node --test test/stories.test.js` verifies deduplication, source-field validation, failed-versus-empty semantics, retained snapshots, cap handling, public-output minimization, Dubai date boundaries, company/team separation and freshness expiry. Normal feed validation and employee portal checks must continue to pass.
