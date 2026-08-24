#!/usr/bin/env python3
"""Fix employee-portal contrast and produce an auditable accuracy report.

The report measures repository identity consistency, route coverage, snapshot
validation, per-account collection completeness and recommendation evidence.
It deliberately separates internal consistency from independent Instagram
source verification.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONTRAST_MARKER = "KIRPA_EMPLOYEE_CONTRAST_GUARD_V1"
OBSOLETE_SNAPSHOT_TAG = '<script src="./account-coach-snapshot-ui.js"></script>'
PERSONAL_COACH_TAG = '<script src="./personal-coach.js"></script>'
MAX_CURRENT_AGE_HOURS = 108

ROW_PATTERN = re.compile(
    r"\['(?P<slug>[^']+)','(?P<name>[^']+)','(?P<first>[^']+)',"
    r"'(?P<role>[^']*)',(?P<handle>null|'[^']*'),(?P<ranked>[01])\]"
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(read_text(path))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def canonical_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@").lower()


def strip_honorific(name: str) -> str:
    return re.sub(r"^((dr|mr|mrs|ms|miss)\.?\s+)+", "", str(name).strip(), flags=re.I).strip()


def first_name(name: str) -> str:
    cleaned = strip_honorific(name)
    return cleaned.split()[0] if cleaned else "Kirpa"


def slugify(name: str) -> str:
    value = unicodedata.normalize("NFKD", strip_honorific(name))
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"[^A-Za-z0-9]+", "-", value.lower()).strip("-")
    return value or "employee"


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def percentage(numerator: int | float, denominator: int | float) -> float | None:
    if not denominator:
        return None
    return round(float(numerator) * 100 / float(denominator), 1)


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def parse_directory_rows(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for match in ROW_PATTERN.finditer(text):
        handle_token = match.group("handle")
        rows.append(
            {
                "slug": match.group("slug"),
                "name": match.group("name"),
                "firstName": match.group("first"),
                "role": match.group("role"),
                "handle": None if handle_token == "null" else handle_token[1:-1],
                "ranked": match.group("ranked") == "1",
            }
        )
    return rows


def apply_visibility_fix() -> list[str]:
    changes: list[str] = []
    coach_path = ROOT / "personal-coach.js"
    coach = read_text(coach_path)
    if CONTRAST_MARKER not in coach:
        anchor = "\n  `;\n\n  let activeHandle"
        position = coach.find(anchor)
        if position < 0:
            raise RuntimeError("personal-coach.js STYLE closing marker was not found")
        override = f"""

    /* {CONTRAST_MARKER}
     * The coach hero is injected inside the dark analytics header. Every light
     * surface therefore needs its own foreground colour rather than inheriting
     * white text from .analytics-hero.
     */
    #kirpa-coach-hero,
    #kirpa-coach-hero .coach-hero,
    #kirpa-coach-hero .coach-metric,
    #kirpa-coach-hero .coach-strategy-card > div,
    #kirpa-coach-hero .coach-data-badge,
    #kirpa-coach-hero .coach-confirmation,
    #kirpa-coach-journey,
    #kirpa-coach-journey .coach-question,
    #kirpa-coach-journey .coach-action,
    #kirpa-coach-journey .coach-action-detail > div,
    #kirpa-coach-journey .coach-success,
    #kirpa-coach-journey .coach-columns > div,
    #kirpa-coach-journey .coach-drivers li,
    #kirpa-coach-journey .coach-review,
    #kirpa-coach-journey .coach-empty-review {{
      color: var(--ink, #171717);
    }}
    #kirpa-coach-hero h3,
    #kirpa-coach-hero h4,
    #kirpa-coach-hero b,
    #kirpa-coach-hero strong,
    #kirpa-coach-hero summary,
    #kirpa-coach-hero p,
    #kirpa-coach-journey h3,
    #kirpa-coach-journey h4,
    #kirpa-coach-journey b,
    #kirpa-coach-journey strong,
    #kirpa-coach-journey summary {{
      color: var(--ink, #171717);
    }}
    #kirpa-coach-hero .coach-data-badge span,
    #kirpa-coach-hero .coach-metric span,
    #kirpa-coach-hero .coach-metric small,
    #kirpa-coach-hero .coach-strategy-card span {{
      color: var(--dust, #796f68);
    }}
    #kirpa-coach-journey .coach-question-number,
    #kirpa-coach-journey .coach-action-head .coach-priority {{
      color: #fff;
    }}
"""
        coach = coach[:position] + override + coach[position:]
        write_text(coach_path, coach)
        changes.append("personal-coach.js: added scoped foreground colours for every light coach surface")

    index_path = ROOT / "index.html"
    index = read_text(index_path)
    cleaned = re.sub(
        r"\s*<script\s+src=[\"']\./account-coach-snapshot-ui\.js[\"']\s*></script>\s*",
        "\n",
        index,
    )
    if cleaned != index:
        write_text(index_path, cleaned)
        changes.append("index.html: removed obsolete snapshot enhancer that collided with coach CSS")

    return changes


def find_row(rows: list[dict[str, Any]], *, name: str, handle: str | None = None) -> dict[str, Any] | None:
    target = canonical_handle(handle)
    for row in rows:
        if target and canonical_handle(row.get("handle")) == target:
            return row
    for row in rows:
        if row.get("name") == name:
            return row
    return None


def metric_coverage(analytics: dict[str, Any]) -> dict[str, Any]:
    coverage = analytics.get("metricCoverage") or analytics.get("observedMetricCoverage") or {}
    posts = coverage.get("posts") if is_number(coverage.get("posts")) else analytics.get("postsInWindow")
    videos = coverage.get("videos") if is_number(coverage.get("videos")) else analytics.get("videoCount")
    likes = coverage.get("likes") if is_number(coverage.get("likes")) else analytics.get("likesReporting")
    comments = coverage.get("comments") if is_number(coverage.get("comments")) else analytics.get("commentsReporting")
    views = coverage.get("videoViews") if is_number(coverage.get("videoViews")) else analytics.get("viewsReporting")
    return {
        "posts": int(posts) if is_number(posts) else None,
        "likes": int(likes) if is_number(likes) else None,
        "comments": int(comments) if is_number(comments) else None,
        "videos": int(videos) if is_number(videos) else None,
        "videoViews": int(views) if is_number(views) else None,
    }


def confidence_grade(
    *,
    relevant: bool,
    confirmed: bool,
    identity_ok: bool,
    resolved: bool,
    private: bool,
    complete: bool,
    comparable_posts: int | None,
    coverage: dict[str, Any],
) -> tuple[str, str]:
    if not relevant:
        return "N/A", "Role is intentionally outside the current ranking scope."
    if not confirmed:
        return "N/A", "No confirmed Instagram handle; personal measurement is correctly withheld."
    if not identity_ok:
        return "F", "Roster, portal or snapshot identity does not match."
    if private:
        return "D", "The account is private; public performance measurement is unavailable."
    if not resolved:
        return "D", "The latest collection did not resolve the confirmed profile."
    if not complete:
        return "C", "The 30-day post window is incomplete, so comparisons are held."
    views_complete = (
        coverage.get("videos") is not None
        and coverage.get("videoViews") is not None
        and coverage.get("videos") == coverage.get("videoViews")
    )
    if (comparable_posts or 0) >= 3 and views_complete:
        return "A", "Complete validated window, sufficient engagement sample and complete public view reporting."
    if (comparable_posts or 0) >= 3:
        return "A-", "Complete validated window and sufficient engagement sample; some public view values are unavailable."
    return "B", "Complete validated window, but the account has fewer than three comparable posts."


def build_report() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    registry = read_json(ROOT / "handles.json", {"employees": []})
    snapshot = read_json(ROOT / "data" / "latest.json", {})
    series = read_json(ROOT / "data" / "series.json", {})
    developer = read_json(ROOT / "data" / "developer-intelligence.json", {})
    refresh = read_json(ROOT / "data" / "refresh-status.json", {})
    index_text = read_text(ROOT / "index.html")
    accounts_text = read_text(ROOT / "accounts" / "index.html")
    coach_text = read_text(ROOT / "personal-coach.js")

    employees = registry.get("employees") if isinstance(registry.get("employees"), list) else []
    directory_rows = parse_directory_rows(accounts_text)
    directory_by_name = {row["name"]: row for row in directory_rows}

    records = snapshot.get("records") if isinstance(snapshot.get("records"), list) else []
    board = (snapshot.get("leaderboards") or {}).get("instagram") or {}
    analytics_rows = board.get("analytics") if isinstance(board.get("analytics"), list) else []
    people_rows = snapshot.get("people") if isinstance(snapshot.get("people"), list) else []
    composite = ((snapshot.get("leaderboards") or {}).get("combined") or {}).get("composite") or []

    records_by_name = {row.get("name"): row for row in records if isinstance(row, dict)}
    analytics_by_handle = {canonical_handle(row.get("handle")): row for row in analytics_rows if isinstance(row, dict)}
    people_by_handle = {canonical_handle(row.get("handle")): row for row in people_rows if isinstance(row, dict)}
    score_by_handle = {canonical_handle(row.get("handle")): row for row in composite if isinstance(row, dict)}

    roster_names = {employee.get("name") for employee in employees}
    extra_directory_names = sorted(set(directory_by_name) - roster_names)
    missing_directory_names = sorted(roster_names - set(directory_by_name))

    portal_identity_matches = 0
    snapshot_identity_matches = 0
    physical_routes = 0
    complete_confirmed_accounts = 0
    resolved_confirmed_accounts = 0
    recommendation_ready_accounts = 0
    employee_rows: list[dict[str, Any]] = []
    identity_issues: list[str] = []

    first_names: defaultdict[str, list[str]] = defaultdict(list)

    for employee in employees:
        name = str(employee.get("name") or "")
        role = employee.get("role") or ""
        handle = employee.get("handles", {}).get("instagram") if isinstance(employee.get("handles"), dict) else None
        relevant = employee.get("dashboardRelevant") is not False
        confirmed = employee.get("confirmed") is True and bool(handle)
        expected_slug = slugify(name)
        expected_first = first_name(name)
        first_names[expected_first.lower()].append(name)

        directory = directory_by_name.get(name)
        directory_identity_ok = bool(
            directory
            and directory.get("slug") == expected_slug
            and directory.get("firstName") == expected_first
            and directory.get("role") == role
            and canonical_handle(directory.get("handle")) == canonical_handle(handle)
            and directory.get("ranked") == relevant
        )
        if directory_identity_ok:
            portal_identity_matches += 1
        else:
            identity_issues.append(f"{name}: employee directory identity or access metadata does not match handles.json")

        route_exists = (ROOT / "accounts" / expected_slug / "index.html").exists()
        if route_exists:
            physical_routes += 1
        else:
            identity_issues.append(f"{name}: physical employee route is missing")

        record = records_by_name.get(name)
        expected_snapshot_record = relevant
        snapshot_identity_ok = bool(
            (not expected_snapshot_record and record is None)
            or (
                expected_snapshot_record
                and record is not None
                and canonical_handle(record.get("handle")) == canonical_handle(handle)
                and record.get("platform") == "instagram"
            )
        )
        if snapshot_identity_ok:
            snapshot_identity_matches += 1
        elif expected_snapshot_record:
            identity_issues.append(f"{name}: current snapshot record does not match the roster identity")

        analytics = analytics_by_handle.get(canonical_handle(handle)) if handle else None
        person = people_by_handle.get(canonical_handle(handle)) if handle else None
        score = score_by_handle.get(canonical_handle(handle)) if handle else None
        resolved = bool(record and record.get("resolved") is True)
        private = bool(record and record.get("isPrivate") is True)
        complete = bool(analytics and analytics.get("windowComplete") is True)
        comparable = analytics.get("comparablePosts") if analytics and is_number(analytics.get("comparablePosts")) else None
        coverage = metric_coverage(analytics or {})

        if confirmed and resolved and not private:
            resolved_confirmed_accounts += 1
        if confirmed and complete and resolved and not private:
            complete_confirmed_accounts += 1
        if confirmed and complete and person:
            recommendation_ready_accounts += 1

        grade, grade_reason = confidence_grade(
            relevant=relevant,
            confirmed=confirmed,
            identity_ok=directory_identity_ok and snapshot_identity_ok,
            resolved=resolved,
            private=private,
            complete=complete,
            comparable_posts=int(comparable) if comparable is not None else None,
            coverage=coverage,
        )

        if not relevant:
            status = "not_ranked"
            status_label = "Role not ranked"
        elif not confirmed:
            status = "setup_pending"
            status_label = "Confirmed handle required"
        elif not record or not snapshot_identity_ok:
            status = "identity_or_record_error"
            status_label = "Snapshot identity error"
        elif private:
            status = "private"
            status_label = "Private account"
        elif not resolved:
            status = "unresolved"
            status_label = "Collection unresolved"
        elif not complete:
            status = "partial"
            status_label = "Incomplete 30-day window"
        else:
            status = "complete"
            status_label = "Complete validated account data"

        strategy_declared = bool(employee.get("accountStrategy") or employee.get("strategy"))
        employee_rows.append(
            {
                "name": name,
                "role": role,
                "handle": handle,
                "slug": expected_slug,
                "firstNamePassword": expected_first,
                "dashboardRelevant": relevant,
                "confirmedHandle": confirmed,
                "portalIdentityMatches": directory_identity_ok,
                "physicalRouteExists": route_exists,
                "snapshotIdentityMatches": snapshot_identity_ok,
                "snapshotRecordPresent": record is not None,
                "resolved": resolved,
                "private": private,
                "windowComplete": complete,
                "postsInWindow": analytics.get("postsInWindow") if analytics else None,
                "comparablePosts": int(comparable) if comparable is not None else None,
                "metricCoverage": coverage,
                "momentumRank": score.get("rank") if isinstance(score, dict) else None,
                "personalCoachDataPresent": person is not None,
                "strategyBasis": "declared" if strategy_declared else "inferred from role and measured content",
                "status": status,
                "statusLabel": status_label,
                "measurementConfidenceGrade": grade,
                "measurementConfidenceReason": grade_reason,
            }
        )

    relevant_count = sum(1 for employee in employees if employee.get("dashboardRelevant") is not False)
    excluded_count = len(employees) - relevant_count
    confirmed_relevant = sum(
        1
        for employee in employees
        if employee.get("dashboardRelevant") is not False
        and employee.get("confirmed") is True
        and bool((employee.get("handles") or {}).get("instagram"))
    )
    setup_pending = relevant_count - confirmed_relevant

    captured = parse_time((snapshot.get("meta") or {}).get("capturedAt"))
    age_hours = round((now - captured).total_seconds() / 3600, 1) if captured else None
    if age_hours is None:
        freshness = "unknown"
    elif age_hours < 0:
        freshness = "future_dated"
    elif age_hours <= MAX_CURRENT_AGE_HOURS:
        freshness = "current"
    else:
        freshness = "archived_refresh_due"

    coverage_block = board.get("coverage") if isinstance(board.get("coverage"), dict) else {}
    complete_windows = coverage_block.get("completeWindowProfiles")
    ranked_scores = sum(1 for row in composite if isinstance(row, dict) and row.get("rank") is not None)

    duplicate_passwords = [
        {"firstName": names[0].split()[0] if names else key.title(), "employees": names}
        for key, names in sorted(first_names.items())
        if len(names) > 1
    ]

    identity_accuracy_denominator = len(employees)
    snapshot_expected = relevant_count + excluded_count
    validation = (snapshot.get("meta") or {}).get("validation") or {}
    internally_validated = validation.get("status") == "passed"

    issues: list[dict[str, str]] = []
    if missing_directory_names:
        issues.append({"severity": "critical", "issue": f"Directory is missing {len(missing_directory_names)} roster employees."})
    if extra_directory_names:
        issues.append({"severity": "high", "issue": f"Directory contains {len(extra_directory_names)} names outside the roster."})
    if identity_issues:
        issues.append({"severity": "high", "issue": f"{len(identity_issues)} identity or route checks failed."})
    if not internally_validated:
        issues.append({"severity": "critical", "issue": "The latest snapshot is not stamped as passed by the deterministic validator."})
    if freshness != "current":
        issues.append({"severity": "high", "issue": "The validated snapshot is outside the 108-hour present-tense window or has no valid timestamp."})
    if setup_pending:
        issues.append({"severity": "expected", "issue": f"{setup_pending} dashboard-relevant employees still have no confirmed Instagram handle."})
    if duplicate_passwords:
        issues.append({"severity": "security", "issue": f"{len(duplicate_passwords)} first-name password groups are shared by multiple employees."})
    issues.append({
        "severity": "security",
        "issue": "Employee portals currently load the full same-origin dashboard in an iframe and hide non-selected content visually; this is not server-side data isolation.",
    })
    issues.append({
        "severity": "method",
        "issue": "The audit proves repository and snapshot consistency, not independent ground-truth verification against Instagram for every metric.",
    })

    observations = series.get("profiles") if isinstance(series.get("profiles"), dict) else {}
    validated_series_points = 0
    total_series_points = 0
    for value in observations.values():
        points = value.get("points") if isinstance(value, dict) and isinstance(value.get("points"), list) else []
        total_series_points += len(points)
        validated_series_points += sum(1 for point in points if isinstance(point, dict) and point.get("validated") is True)

    report = {
        "schemaVersion": 1,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "scope": {
            "company": registry.get("company"),
            "rosterVersion": registry.get("rosterVersion"),
            "rosterSource": registry.get("source"),
            "rosterRows": len(employees),
            "dashboardRelevantEmployees": relevant_count,
            "employeesNotRankedByRole": excluded_count,
            "confirmedRelevantInstagramHandles": confirmed_relevant,
            "relevantEmployeesAwaitingConfirmedHandle": setup_pending,
        },
        "portal": {
            "directoryRows": len(directory_rows),
            "portalIdentityMatches": portal_identity_matches,
            "physicalEmployeeRoutes": physical_routes,
            "missingDirectoryNames": missing_directory_names,
            "extraDirectoryNames": extra_directory_names,
            "duplicateFirstNamePasswords": duplicate_passwords,
            "contrastGuardInstalled": CONTRAST_MARKER in coach_text,
            "personalCoachLoaded": PERSONAL_COACH_TAG in index_text,
            "obsoleteSnapshotEnhancerLoaded": OBSOLETE_SNAPSHOT_TAG in index_text,
            "isolationModel": "same-origin iframe plus visual DOM isolation",
        },
        "snapshot": {
            "capturedAt": (snapshot.get("meta") or {}).get("capturedAt"),
            "ageHoursAtAudit": age_hours,
            "freshness": freshness,
            "presentTenseMaximumAgeHours": MAX_CURRENT_AGE_HOURS,
            "source": (snapshot.get("meta") or {}).get("source"),
            "provider": (snapshot.get("meta") or {}).get("provider"),
            "measurementVersion": (snapshot.get("meta") or {}).get("measurementVersion"),
            "validationStatus": validation.get("status"),
            "validatorVersion": validation.get("validatorVersion"),
            "snapshotRosterVersion": (snapshot.get("meta") or {}).get("rosterVersion"),
            "recordRows": len(records),
            "expectedRelevantRecordRows": relevant_count,
            "snapshotIdentityMatches": snapshot_identity_matches,
            "resolvedProfiles": (snapshot.get("meta") or {}).get("resolvedProfiles"),
            "resolvedConfirmedAccounts": resolved_confirmed_accounts,
            "completeWindowProfiles": complete_windows,
            "completeConfirmedAccounts": complete_confirmed_accounts,
            "analyticsRows": len(analytics_rows),
            "personalCoachRows": len(people_rows),
            "recommendationReadyAccounts": recommendation_ready_accounts,
            "rankedMomentumProfiles": ranked_scores,
            "refreshOutcome": refresh.get("outcome"),
            "refreshAttemptedAt": refresh.get("attemptedAt"),
            "lastValidSnapshotAt": refresh.get("lastValidSnapshotAt"),
            "seriesProfiles": len(observations),
            "seriesPoints": total_series_points,
            "validatedSeriesPoints": validated_series_points,
            "developerIntelligenceGeneratedAt": developer.get("generatedAt"),
            "developerIntelligenceStatus": developer.get("status"),
            "developerReelsProcessed": developer.get("processedReels"),
            "developerTotalReels": developer.get("totalReels"),
        },
        "accuracy": {
            "portalIdentityAccuracyPct": percentage(portal_identity_matches, identity_accuracy_denominator),
            "physicalRouteCoveragePct": percentage(physical_routes, identity_accuracy_denominator),
            "snapshotIdentityAccuracyPct": percentage(snapshot_identity_matches, snapshot_expected),
            "confirmedAccountResolutionPct": percentage(resolved_confirmed_accounts, confirmed_relevant),
            "confirmedAccountCompleteWindowPct": percentage(complete_confirmed_accounts, confirmed_relevant),
            "recommendationReadyCoveragePct": percentage(recommendation_ready_accounts, confirmed_relevant),
            "internallyValidatedSnapshot": internally_validated,
            "independentExternalGroundTruthVerified": False,
        },
        "identityIssues": identity_issues,
        "issues": issues,
        "limitations": [
            "Public Instagram values are point-in-time observations and may differ from current live counts after capture.",
            "Public data does not provide first-party reach, saves, shares, watch time, audience quality or all view values consistently.",
            "Recommendation strategies are inferred unless the employee has a declared accountStrategy in handles.json.",
            "Recommendations are deterministic and evidence-backed but do not guarantee views, followers, leads or deals.",
            "Leads, viewings, deals and revenue are not yet connected to these employee portals.",
            "First-name passwords and client-side checks are not strong authentication.",
            "The current iframe portal visually isolates one account but still downloads the broader dashboard payload in the browser.",
        ],
        "employees": employee_rows,
    }
    return report


def markdown_report(report: dict[str, Any]) -> str:
    scope = report["scope"]
    portal = report["portal"]
    snapshot = report["snapshot"]
    accuracy = report["accuracy"]

    def shown(value: Any) -> str:
        if value is None:
            return "Unavailable"
        if isinstance(value, bool):
            return "Yes" if value else "No"
        return str(value)

    lines = [
        "# Kirpa Employee Portal Accuracy Report",
        "",
        f"Generated: **{report['generatedAt']}**",
        "",
        "> This report measures internal identity consistency, route coverage, deterministic snapshot validation and per-account measurement completeness. It is not an independent scrape-by-scrape verification against Instagram's live first-party systems.",
        "",
        "## Executive result",
        "",
        "| Check | Result | Interpretation |",
        "|---|---:|---|",
        f"| Roster-to-portal identity | {shown(accuracy['portalIdentityAccuracyPct'])}% | Name, role, handle, URL slug, first-name password and ranked flag compared for all roster rows. |",
        f"| Physical employee routes | {shown(accuracy['physicalRouteCoveragePct'])}% | A real `accounts/<full-name>/index.html` route is expected for every employee. |",
        f"| Snapshot identity consistency | {shown(accuracy['snapshotIdentityAccuracyPct'])}% | Dashboard-relevant records must match the current roster; excluded roles must not enter the ranked record set. |",
        f"| Confirmed accounts resolved | {shown(accuracy['confirmedAccountResolutionPct'])}% | Confirmed public handles successfully resolved in the latest snapshot. |",
        f"| Confirmed accounts with complete 30-day windows | {shown(accuracy['confirmedAccountCompleteWindowPct'])}% | Only these profiles support full current comparisons and recommendations. |",
        f"| Recommendation-ready coverage | {shown(accuracy['recommendationReadyCoveragePct'])}% | Profiles carrying complete personal analytics/coaching inputs. |",
        f"| Deterministic validator passed | {shown(accuracy['internallyValidatedSnapshot'])} | Recomputed roster, records, leaderboards and derived analytics agree internally. |",
        f"| Independently checked against live Instagram | {shown(accuracy['independentExternalGroundTruthVerified'])} | This audit does not claim external ground-truth verification. |",
        "",
        "## Scope and freshness",
        "",
        f"- Roster: **{scope['rosterRows']} employees** — {scope['dashboardRelevantEmployees']} dashboard-relevant and {scope['employeesNotRankedByRole']} outside the current ranking scope.",
        f"- Confirmed relevant Instagram handles: **{scope['confirmedRelevantInstagramHandles']}**; awaiting confirmed handle: **{scope['relevantEmployeesAwaitingConfirmedHandle']}**.",
        f"- Snapshot: **{shown(snapshot['capturedAt'])}**, age **{shown(snapshot['ageHoursAtAudit'])} hours**, classification **{snapshot['freshness']}**.",
        f"- Validation: **{shown(snapshot['validationStatus'])}**, measurement version **{shown(snapshot['measurementVersion'])}**, validator version **{shown(snapshot['validatorVersion'])}**.",
        f"- Snapshot records: **{snapshot['recordRows']} / {snapshot['expectedRelevantRecordRows']} expected relevant rows**; complete windows: **{shown(snapshot['completeWindowProfiles'])}**.",
        f"- Momentum-ranked profiles: **{snapshot['rankedMomentumProfiles']}**; recommendation-ready profiles: **{snapshot['recommendationReadyAccounts']}**.",
        f"- Developer intelligence: **{shown(snapshot['developerIntelligenceStatus'])}**, {shown(snapshot['developerReelsProcessed'])}/{shown(snapshot['developerTotalReels'])} Reels processed, generated {shown(snapshot['developerIntelligenceGeneratedAt'])}.",
        "",
        "## Portal implementation checks",
        "",
        f"- Directory rows: **{portal['directoryRows']}**; physical routes: **{portal['physicalEmployeeRoutes']}**.",
        f"- Contrast guard installed: **{shown(portal['contrastGuardInstalled'])}**.",
        f"- Personal coach loaded: **{shown(portal['personalCoachLoaded'])}**.",
        f"- Obsolete CSS-colliding snapshot enhancer loaded: **{shown(portal['obsoleteSnapshotEnhancerLoaded'])}**.",
        f"- Current isolation model: **{portal['isolationModel']}**.",
        "",
        "## Per-account measurement confidence",
        "",
        "The grade describes measurement confidence, not the employee's social-media performance.",
        "",
        "| Employee | Instagram | Portal | Snapshot status | Grade | Recommendation basis |",
        "|---|---|---|---|---:|---|",
    ]
    for employee in report["employees"]:
        portal_state = "Match" if employee["portalIdentityMatches"] and employee["physicalRouteExists"] else "Review"
        handle = f"@{employee['handle']}" if employee["handle"] else "Not confirmed"
        lines.append(
            f"| {employee['name']} | {handle} | {portal_state} | {employee['statusLabel']} | {employee['measurementConfidenceGrade']} | {employee['strategyBasis']} |"
        )

    lines.extend(["", "## Open issues and qualifications", ""])
    for issue in report["issues"]:
        lines.append(f"- **{issue['severity'].upper()}** — {issue['issue']}")

    lines.extend(["", "## What the report does not guarantee", ""])
    for limitation in report["limitations"]:
        lines.append(f"- {limitation}")
    lines.append("")
    return "\n".join(lines)


def validate(report: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    portal = report["portal"]
    accuracy = report["accuracy"]
    if not portal["contrastGuardInstalled"]:
        errors.append("employee coach contrast guard is missing")
    if portal["obsoleteSnapshotEnhancerLoaded"]:
        errors.append("obsolete account-coach-snapshot-ui.js loader is still present")
    if not portal["personalCoachLoaded"]:
        errors.append("personal-coach.js is not loaded by index.html")
    if accuracy["portalIdentityAccuracyPct"] != 100.0:
        errors.append(f"portal identity accuracy is {accuracy['portalIdentityAccuracyPct']}%, expected 100%")
    if accuracy["physicalRouteCoveragePct"] != 100.0:
        errors.append(f"physical route coverage is {accuracy['physicalRouteCoveragePct']}%, expected 100%")
    if accuracy["snapshotIdentityAccuracyPct"] != 100.0:
        errors.append(f"snapshot identity accuracy is {accuracy['snapshotIdentityAccuracyPct']}%, expected 100%")
    if not accuracy["internallyValidatedSnapshot"]:
        errors.append("latest snapshot has not passed its deterministic validator")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fix", action="store_true", help="Apply contrast and loader fixes before auditing")
    parser.add_argument("--check", action="store_true", help="Fail when mandatory quality gates are not met")
    args = parser.parse_args()

    changes = apply_visibility_fix() if args.fix else []
    report = build_report()
    write_text(ROOT / "data" / "employee-accuracy-report.json", json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    write_text(ROOT / "EMPLOYEE_ACCURACY_REPORT.md", markdown_report(report))

    for change in changes:
        print(f"[employee-quality] fixed: {change}")
    print(
        "[employee-quality] "
        f"{report['scope']['rosterRows']} roster rows, "
        f"{report['portal']['physicalEmployeeRoutes']} routes, "
        f"{report['accuracy']['portalIdentityAccuracyPct']}% portal identity accuracy, "
        f"{report['accuracy']['confirmedAccountCompleteWindowPct']}% complete confirmed-account coverage"
    )

    errors = validate(report)
    if args.check and errors:
        for error in errors:
            print(f"[employee-quality] ERROR: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
