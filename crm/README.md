# CRM results inside the existing social dashboard

The reporting UI is part of `index.html`, immediately before Momentum Leader. There is no separate Bitrix application. `crm/index.html` redirects to the same main-dashboard section.

## Architecture

- GitHub Pages continues serving the existing social board and public Instagram data.
- The Sites Worker built from `server/worker.mjs` authenticates the shared password on the server. Sessions are random, hashed in D1, revocable and expire after one hour.
- Every CRM report, source-directory and note-review endpoint requires a valid session. Browser-only unlock flags do not authorize CRM access.
- D1 retains only minimized completed reports and session/rate-limit state. Customer names, phones, emails, deal values and free-text notes are excluded from report responses and report storage.
- Bitrix connection 75 has the CRM scope. The API implementation allowlists reads only; the upstream CRM scope itself is broader, so any code changes must be reviewed.
- The connection is encrypted with AES-GCM in the backend database. Its encryption key is held separately as a hosting environment secret. The owner-only `/setup` form verifies Kirpa's portal before saving; the credential is never returned to the browser. Setup uses the platform's ChatGPT identity, an owner-email allowlist and an expiring CSRF token. Report viewers need only the chosen shared password.
- The original static social data remains publicly downloadable; server protection applies to the new CRM data, not retrospectively to GitHub repository history.

## Definitions

Months use Asia/Dubai, start-inclusive and next-month-start-exclusive. Confirmed leads are unique CRM leads created in that month with evidenced creator attribution. Lead-to-sale conversion is unique confirmed cohort leads linked to at least one currently won deal divided by that same cohort. Multiple deals from one lead do not inflate the numerator. A converted lead/contact alone is not a won sale.

Closed-deal counts separately use the CRM closing date of currently won deals, including older originating leads. They do not certify payment or contract completion. Reopened/lost deals are excluded. Missing lead-to-deal links are counted as a coverage gap, never inferred from assigned agents.

Only exact `Instagram @handle` source declarations and evidence-backed configured source/originator IDs confirm a creator. Social references in free text are candidates requiring human review. Assignment and names alone do not prove origin. Generic social sources without a creator stay separate. Known immutable capture origins deduplicate repeated imports; other distinct CRM IDs are not merged by guessed customer identity.

Records are limited to those readable by the dedicated connection. Past-month reports are cohorts evaluated using current CRM states, not historical stage snapshots. Deleted records cannot be reconstructed. Conversations and attended meetings are not inferred from activities.

## Refresh and recovery

A requested month is cached for up to six hours. Refresh CRM asks for a new read, subject to a 15-minute successful-refresh cooldown. A failed page, missing permission or incomplete read preserves the previous complete report and its original capture time. This uses Bitrix, not Apify, and does not change the four-day Instagram schedule. Notes are checked on demand and only attribution suggestions are returned; corrections must be reviewed and made in Bitrix.

Report holders share the same access; the chosen short shared password is not equivalent to individual accounts or MFA. Do not distribute it beyond authorized viewers.

## Verification and deployment

Run `npm ci`, `npm run build`, `npm run test:crm`, `node test/test.js`, `node test/personal-coach.test.js` and the existing employee portal quality checks.

GitHub Pages publishes the UI through its existing workflow. Backend deployment is separate: push the exact validated source to the Sites source repository, package the Worker using the Sites hosting helper, save a version and deploy it. The exact backend ID is in `.openai/hosting.json`. Never put runtime secrets there or in Git.

Keep applied Drizzle migrations immutable; append future schema changes. Setup identity headers must be validated through the production dispatcher: external requests with forged owner headers must still redirect to sign-in. Test absent, incorrect, expired and revoked CRM sessions, CORS, brute-force limits, output minimization, failed refresh retention and sample record reconciliation before release.

## Privacy review

Data flow: Bitrix REST → server memory → minimized encrypted-at-rest backend storage → authenticated dashboard response. Raw CRM descriptions are processed only server-side for attribution; timeline notes are fetched only on explicit review requests and not retained in reports. Record links still require the viewer's Bitrix access.

No CRM credentials or records go to GitHub, Apify or an AI service. Connection secret storage uses a separate encryption key, setup is owner-only, and the report API never accepts an arbitrary CRM method or destination. Shared-password access is the explicitly chosen access model, with its limitations stated in the dashboard. This is a technical review, not a legal compliance certification.

Official references: [Bitrix local integrations](https://apidocs.bitrix24.com/local-integrations/index.html), [lead list](https://apidocs.bitrix24.com/api-reference/crm/leads/crm-lead-list.html), [deal list](https://apidocs.bitrix24.com/api-reference/crm/deals/crm-deal-list.html).
