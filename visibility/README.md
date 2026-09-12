# Visibility OS — standalone product interface

Visibility OS is a visibility-to-revenue intelligence product for distributed sales organisations. Kirpa Properties is the first design-partner workspace, and the existing Kirpa Social Ranking is integrated as its first live module.

## What this release contains

- Executive command centre built around four questions: what changed, why it matters, what business impact exists, and what to do next.
- Opportunity inbox with filtering, ownership, status changes and locally persisted workflow state.
- Search and AI visibility module.
- Live embedded Kirpa Social Ranking module without modifying its existing code, data, calculations, filters or workflows.
- Agent contribution, project coverage, competitor intelligence, attribution, reputation, source health and integration modules.
- Evidence labels that separate Verified, Derived, Public, Estimated, Modelled, Experimental, Sample and Not connected data.
- Exportable executive snapshot.
- “Ask Visibility” evidence-linked prototype analyst.
- Responsive desktop, tablet and mobile layouts.
- Zero runtime dependencies: HTML, CSS and JavaScript only.

## Implementation audit

- GitHub Pages serves the repository root from `main`; `/visibility/` is therefore a standalone sub-application while the root Social Ranking remains unchanged.
- The original prototype fetched three base64 gzip fragments, decompressed them with `DecompressionStream`, injected CSS and executed JavaScript from a blob URL. This introduced unnecessary asset requests, browser compatibility risk, opaque source and CSP fragility.
- The product now loads ordinary `styles.css`, `data.js` and `app.js` files directly. There is no browser-side decompression or generated blob script.
- The Social Ranking integration remains a relative `../index.html` iframe plus a direct-link fallback, so Pages project-path deployment and local HTTP preview both work.
- No Pages deployment workflow exists in the repository; the existing scheduled workflows update Social Ranking data only and were not changed.
- The public live URLs and dependent assets returned successfully during the audit, and the existing live build produced no browser console warnings or errors.

## Critical data boundary

Only **Kirpa Social Ranking** is live in this release. All Search, CRM, revenue, competitor, project-enrichment and reputation figures are visibly labelled as prototype/sample data until the relevant source is connected.

The public GitHub Pages layer must never contain:

- CRM lead or contact details
- phone numbers or email addresses
- Bitrix24 credentials or webhook secrets
- private Meta access tokens
- commission or confidential revenue data
- management-only performance comments

## Local preview

From the repository root:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/visibility/
```

The live Social Ranking iframe resolves to `../index.html`, so preview from the repository root rather than opening the file directly.

## Validation

```bash
node visibility/validate.mjs
node --check visibility/app.js
node --check visibility/data.js
```

## Deployment

After merge to the GitHub Pages branch, the MVP is available at:

```text
https://roshanalii.github.io/socialranking/visibility/
```

The existing ranking remains at:

```text
https://roshanalii.github.io/socialranking/
```

## Production extraction

This MVP deliberately lives in a separate `/visibility` application boundary while reusing the current Pages deployment. The production product should later be extracted into an independent private repository and deployed with:

1. Authenticated multi-tenant web application
2. Secure backend/API
3. PostgreSQL data warehouse
4. Connector workers and webhook receivers
5. Server-side secrets management
6. Role-based access and audit logs
7. Public/social reporting separated from private CRM and revenue reporting

## Recommended connection order

1. Tracking identity: canonical agent, project and campaign IDs; short links; QR codes; WhatsApp deep links.
2. Website measurement: GA4 and Search Console.
3. CRM truth: Bitrix24 source, qualification, viewing, deal and revenue mapping.
4. Owned-media depth: Meta insights, Meta Ads, Google Business Profile and reviews.
5. Competitive and AI-answer intelligence.

This order prevents the platform from becoming a larger reporting system before it can prove commercial impact.
