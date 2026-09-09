# Company-page counting contract

The company account must not use the 12-post profile preview as evidence of a complete reporting period. Pinned posts, collaborations and missed refreshes can create gaps. Legacy company snapshots are observed samples, even if an old metadata flag says otherwise.

Each social refresh now reconciles the company account using `apify/instagram-post-scraper`, a full 31-day absolute-UTC date boundary and a 200-result safety limit. This covers Dubai calendar-month-to-date, Monday-start week-to-date and rolling 30-day reporting. The existing account spend cap remains in effect. Full company reconciliation intentionally re-observes metrics rather than presenting old cached values as newly measured. Historical snapshots remain immutable.

## Counting rules

- Original company-owned posts remain in `recentPosts`, used for owner-only analytics. Company accounts never enter employee rankings.
- `companyPage.posts` additionally contains posts with explicit coauthor evidence or evidence that they appeared in the requested profile feed. Mentions and tags alone do not qualify.
- The actual owner is retained. Other-author page posts are labelled shared/collaborative, not falsely attributed as company-created content.
- Deduplicate by immutable post identity. A carousel is one post. Pinned posts retain their original publication date. Stories are not counted.
- The company and team cards are separate scopes and overlap; never add them to calculate unique company-wide output or attention.
- Views, likes and comments are their observed totals on posts published in the selected period. They are not period-earned reach or views. Missing metrics stay missing.

## Quality checks

A complete company window requires a successful uncapped collection, valid IDs/dates/owners/page evidence, no unexplained row rejection, and no in-window profile-preview post omitted from the full feed. An empty feed for an active company is not certified as an exact zero. Counts are lower bounds when coverage cannot be established. A failed pull retains previous evidence with its original observation time.

The company audit on the dashboard lists each day, post URL, owner, type and observed metrics. Dates use Asia/Dubai. The validator and browser share the company-page evidence checks; tests cover truncation, pinned posts, missing preview IDs, duplicates, tags, shared posts, legacy false-complete flags and failure retention.

This verifies consistency and completeness against the public provider response, not an absolute guarantee against upstream Instagram omissions or later deletion. Meta Business Suite or an account-connected media export remains the independent source for reconciling the complete account inventory and non-public Insights.

Sources: [post scraper input](https://apify.com/apify/instagram-post-scraper/input-schema), [profile preview limit](https://apify.com/apify/instagram-profile-scraper).
