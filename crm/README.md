# Kirpa Social Results — private CRM view

Status: implementation staged; live installation and reconciliation are required before release.

This is a **Bitrix24-hosted static local application**, not a public CRM export. Package with `node scripts/package-crm.js`, then install the resulting ZIP in **Kirpa Bitrix24 → Developer resources → Other → Local application → Static**, with the CRM scope. Installation needs the workspace owner's approval. Source code calls only four allowlisted read methods; CRM records are never modified. The CRM scope itself is broader than read-only, so code changes require review.

## Release gates

1. Obtain approval to add the application and its CRM permission.
2. Install ZIP as “Kirpa Social Results”. Do not replace existing integrations.
3. Verify session initialization, all pagination, source directory, lead and deal permissions using the actual workspace. Verify as a non-admin too.
4. Record the resulting application path in `config.json`. Only then add the launch panel immediately before Momentum Leader and a link from individual accounts. Never publish raw CRM totals or records to bypass authentication.
5. Compare at least one confirmed creator, one unassigned social lead, one note candidate and one linked won deal to their CRM records. Approve exact source IDs and qualified stage IDs before adding them to config.
6. Run `node test/crm.test.js`, `node test/test.js`, and the existing portal tests. Deploy the board link with the existing GitHub Pages flow. Re-package/re-upload when private application code changes; GitHub deployment does not update the Bitrix-hosted ZIP.

## Definitions and limitations

Calendar months use Asia/Dubai, start-inclusive/end-exclusive. Cohort leads are created in that month. Conversion is unique cohort leads with a currently won linked deal / confirmed cohort leads. Deal closures are separately filtered by CRM CLOSEDATE. Lead conversion to a CRM contact is not closed-won revenue. No estimated conversations, attended meetings, commission, or paid revenue are shown.

Only exact `Instagram @handle` source declarations or approved source/originator mappings confirm the originating creator. Social mentions in free text enter review. Responsible user is displayed separately, never inferred as originator. Current implementation recognizes the existing `instagram-ai-guy-kirpa` capture integration only when that handle is also in the confirmed roster. Additional mappings require evidence.

Timeline comments are read only on explicit request. Review is performed in CRM by an authorized person; the application has no local override masquerading as a permanent decision. Incomplete or conflicting attribution stays visible and is excluded from confirmed results. Generic social leads with no creator remain separate from confirmed-account totals. Names, phones and assignment do not establish identity merges. Only stable lead IDs and repeated known immutable capture IDs are deduplicated. Other CRM duplicate/merge corrections must be made in CRM.

All figures are limited to readable records. Current-state reads are not transactional/frozen history. Deleted leads, missing lead-deal relationships, records outside current permissions and missing outcome fields create explicitly reported limits. A failed retrieval keeps the previous completed report and original month in memory. Reloading clears it. No persistent CRM snapshots have been introduced.

## Privacy review

Flow: authenticated Bitrix24 session → Bitrix REST → application memory/DOM → links back to the same CRM. There is no CRM-data upload to GitHub, Apify, AI services or another backend. The public source package contains the existing confirmed social roster and rules only, never a webhook or OAuth token.

Data read: lead IDs, dates, source fields, origin identifiers, current assigned user IDs and stage; deal IDs, linked lead IDs, stage and closing date. Source prose and explicitly requested timeline comments can contain personal information; they stay in the active session and are rendered as text. Customer identity/contact fields and monetary values are deliberately excluded. Data retention is the browser tab lifetime; the underlying CRM keeps its own retention and access controls. The app does not add analytics, exports, logging of payloads or new databases.

Technical checks: allowlisted reads; no browser storage; safe output encoding; validated numeric record IDs; TLS SDK/API; no-referrer links; no CRM data in public HTML; fail-closed totals on failed pages. Outstanding before go-live: real restricted-user permission test and workspace-owner confirmation that this internal reporting use is approved under Kirpa's existing data policy. This is a technical review, not a legal compliance certification.

Official implementation references: [Bitrix local applications](https://apidocs.bitrix24.com/local-integrations/local-apps.html), [paginated SDK calls](https://apidocs.bitrix24.com/sdk/bx24-js-sdk/how-to-call-rest-methods/bx24-call-method.html), [lead list](https://apidocs.bitrix24.com/api-reference/crm/leads/crm-lead-list.html), [deal list](https://apidocs.bitrix24.com/api-reference/crm/deals/crm-deal-list.html).
