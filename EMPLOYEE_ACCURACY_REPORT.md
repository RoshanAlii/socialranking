# Kirpa Employee Portal Accuracy Report

Generated: **2026-08-24T07:00:37.827063Z**

> This report measures internal identity consistency, route coverage, deterministic snapshot validation and per-account measurement completeness. It is not an independent scrape-by-scrape verification against Instagram's live first-party systems.

## Executive result

| Check | Result | Interpretation |
|---|---:|---|
| Roster-to-portal identity | 100.0% | Name, role, handle, URL slug, first-name password and ranked flag compared for all roster rows. |
| Physical employee routes | 100.0% | A real `accounts/<full-name>/index.html` route is expected for every employee. |
| Snapshot identity consistency | 100.0% | Dashboard-relevant records must match the current roster; excluded roles must not enter the ranked record set. |
| Confirmed accounts resolved | 100.0% | Confirmed public handles successfully resolved in the latest snapshot. |
| Confirmed accounts with complete 30-day windows | 100.0% | Only these profiles support full current comparisons and recommendations. |
| Recommendation-ready coverage | 100.0% | Profiles carrying complete personal analytics/coaching inputs. |
| Deterministic validator passed | Yes | Recomputed roster, records, leaderboards and derived analytics agree internally. |
| Independently checked against live Instagram | No | This audit does not claim external ground-truth verification. |

## Scope and freshness

- Roster: **44 employees** — 38 dashboard-relevant and 6 outside the current ranking scope.
- Confirmed relevant Instagram handles: **31**; awaiting confirmed handle: **7**.
- Snapshot: **2026-08-22T08:19:24.726Z**, age **46.7 hours**, classification **current**.
- Validation: **passed**, measurement version **3**, validator version **2**.
- Snapshot records: **38 / 38 expected relevant rows**; complete windows: **31**.
- Momentum-ranked profiles: **25**; recommendation-ready profiles: **31**.
- Developer intelligence: **partial**, 220/244 Reels processed, generated 2026-08-15T09:47:46Z.

## Portal implementation checks

- Directory rows: **44**; physical routes: **44**.
- Contrast guard installed: **Yes**.
- Personal coach loaded: **Yes**.
- Obsolete CSS-colliding snapshot enhancer loaded: **No**.
- Current isolation model: **same-origin iframe plus visual DOM isolation**.

## Per-account measurement confidence

The grade describes measurement confidence, not the employee's social-media performance.

| Employee | Instagram | Portal | Snapshot status | Grade | Recommendation basis |
|---|---|---|---|---:|---|
| Manpreet Kaur | @manpreet.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Dr. Jai Chatha | @jai.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Kamalpreet Kaur | @kamalpreet.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Saloni Bedi | @saloni.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Lipika Madan | @lipika.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Priyanka Jayanna | @priyanka.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Mohammad Mubeen | @mubeen.iqbal.kirpa | Match | Complete validated account data | B | inferred from role and measured content |
| Preety Vijayvargiya | @preety.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Puja Maheshwari | @dxb.pooja.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Vaishali Arora | @vaishali.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Sukhpreet Kaur | @sukhpreetbal.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Barkha Kalia | @barkha.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Kirti Anil Walke | @kirti.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Sahil Bedi | @sahilbedi.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Riya Bhardwaj | Not confirmed | Match | Confirmed handle required | N/A | inferred from role and measured content |
| Geethika Sri Vyshnavi | @geethika.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Kavita Choudhary | @kavita.kirpa.dxb | Match | Complete validated account data | B | inferred from role and measured content |
| Sarvnihal Singh | @sarvnihal.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Aasfa Wahab Shaikh | @aasfa.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Jagraaj Singh | @jagraaj.kirpa | Match | Complete validated account data | B | inferred from role and measured content |
| Akshay Rajendra | @akshay.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Kirat Singh Sapra | @kirat.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Sara Banu | @sarafaisal.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Ritika Kodwani | @ritika.kirpa | Match | Complete validated account data | B | inferred from role and measured content |
| Jitendra Makhija | @jeet.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Arbaaz Ali Khan | Not confirmed | Match | Confirmed handle required | N/A | inferred from role and measured content |
| Sahil Mendiratta | @sahil.kirpaa | Match | Complete validated account data | A | inferred from role and measured content |
| Nikita Lal Tekwani | @nikitaa.kirpa | Match | Complete validated account data | B | inferred from role and measured content |
| Sleeja Misra | Not confirmed | Match | Confirmed handle required | N/A | inferred from role and measured content |
| Lovepreet Singh | @lovepreet.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Mona Shah | @mona.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Spoorthi Hassan | @spoorthi.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Faiyaz Mohmedfaruk | @faiyaz.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Ameer Agha Shirazi | Not confirmed | Match | Confirmed handle required | N/A | inferred from role and measured content |
| Samaksh Malhotra | @samaksh.kirpa | Match | Complete validated account data | A | inferred from role and measured content |
| Param Singh | Not confirmed | Match | Confirmed handle required | N/A | inferred from role and measured content |
| Anmol Singh | Not confirmed | Match | Confirmed handle required | N/A | inferred from role and measured content |
| Amandeep Singh | Not confirmed | Match | Confirmed handle required | N/A | inferred from role and measured content |
| Janisha Puri | @janisha.kirpa | Match | Role not ranked | N/A | inferred from role and measured content |
| Inderjeet Kaur | Not confirmed | Match | Role not ranked | N/A | inferred from role and measured content |
| Urvashi Karnani | Not confirmed | Match | Role not ranked | N/A | inferred from role and measured content |
| Navjot Kaur | Not confirmed | Match | Role not ranked | N/A | inferred from role and measured content |
| Sukhpreet Singh | Not confirmed | Match | Role not ranked | N/A | inferred from role and measured content |
| Farheen | Not confirmed | Match | Role not ranked | N/A | inferred from role and measured content |

## Open issues and qualifications

- **EXPECTED** — 7 dashboard-relevant employees still have no confirmed Instagram handle.
- **SECURITY** — 2 first-name password groups are shared by multiple employees.
- **SECURITY** — Employee portals currently load the full same-origin dashboard in an iframe and hide non-selected content visually; this is not server-side data isolation.
- **METHOD** — The audit proves repository and snapshot consistency, not independent ground-truth verification against Instagram for every metric.

## What the report does not guarantee

- Public Instagram values are point-in-time observations and may differ from current live counts after capture.
- Public data does not provide first-party reach, saves, shares, watch time, audience quality or all view values consistently.
- Recommendation strategies are inferred unless the employee has a declared accountStrategy in handles.json.
- Recommendations are deterministic and evidence-backed but do not guarantee views, followers, leads or deals.
- Leads, viewings, deals and revenue are not yet connected to these employee portals.
- First-name passwords and client-side checks are not strong authentication.
- The current iframe portal visually isolates one account but still downloads the broader dashboard payload in the browser.
