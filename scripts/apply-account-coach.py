#!/usr/bin/env python3
"""Keep the personal coaching engine connected to the generated dashboard."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch_ingest() -> bool:
    path = ROOT / "src" / "ingest.js"
    text = path.read_text(encoding="utf-8")
    original = text

    coach_import = "const { buildAccountCoach } = require('./coach');"
    if coach_import not in text:
        marker = "const POST_CACHE = require('./post-cache');"
        if marker not in text:
            raise SystemExit("src/ingest.js: POST_CACHE import marker not found")
        text = text.replace(marker, marker + "\n" + coach_import, 1)

    setup = """    const personalPostingTime = personPostingTime(record, now, days);
    const personalPillars = personContentPillars(record, now, days);
    const personalCadence = postingWeeks(record, now, days);
    const personalDaysSinceLastPost = daysSinceLastPost(record, now, days);
    const personalGoals = goalProgress(record, employee, defaults, now, days);
    const actionContext = {
      now, days, benchmarks, hashtags,
      timing: content?.timing,
      teamMedianRate: content?.teamMedianRate,
      engagementRate: rate,
      targets: Object.assign({}, defaults, employee?.targets || {}),
    };
    const personalActions = nextActions(record, actionContext);
    const coach = buildAccountCoach(record, employee || {}, {
      now,
      days,
      capturedAt: new Date(now).toISOString(),
      analytics,
      score,
      benchmarks,
      teamBenchmarks: board.teamBenchmarks || null,
      content,
      targets: actionContext.targets,
      existingActions: personalActions,
      postingTime: personalPostingTime,
      pillars: personalPillars,
      cadence: personalCadence,
      daysSinceLastPost: personalDaysSinceLastPost,
    });
"""
    return_marker = "    return {\n      name: record.name,\n      handle: record.handle,"
    if "const coach = buildAccountCoach(record" not in text:
        if return_marker not in text:
            raise SystemExit("src/ingest.js: buildPeople return marker not found")
        text = text.replace(return_marker, setup + return_marker, 1)

    replacements = {
        "      daysSinceLastPost: daysSinceLastPost(record, now, days),": "      daysSinceLastPost: personalDaysSinceLastPost,",
        "      cadence: postingWeeks(record, now, days),": "      cadence: personalCadence,",
        "      goals: goalProgress(record, employee, defaults, now, days),": "      goals: personalGoals,",
        "      postingTime: personPostingTime(record, now, days),": "      postingTime: personalPostingTime,",
        "      contentPillars: personContentPillars(record, now, days),": "      contentPillars: personalPillars,",
    }
    for old, new in replacements.items():
        if old in text:
            text = text.replace(old, new, 1)

    old_actions = re.compile(
        r"      nextActions: nextActions\(record, \{\n"
        r"        now, days, benchmarks, hashtags,\n"
        r"        timing: content\?\.timing,\n"
        r"        teamMedianRate: content\?\.teamMedianRate,\n"
        r"        engagementRate: rate,\n"
        r"        targets: Object\.assign\(\{\}, defaults, employee\?\.targets \|\| \{\}\),\n"
        r"      \}\),"
    )
    if "      coach," not in text:
        text, count = old_actions.subn("      nextActions: personalActions,\n      coach,", text, count=1)
        if count != 1:
            raise SystemExit("src/ingest.js: nextActions block not found")

    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def patch_dashboard() -> bool:
    path = ROOT / "index.html"
    text = path.read_text(encoding="utf-8")
    original = text
    tag = '  <script src="./account-coach-ui.js"></script>'
    if tag not in text:
        marker = "</body>"
        if marker not in text:
            raise SystemExit("index.html: closing body tag not found")
        text = text.replace(marker, tag + "\n" + marker, 1)
    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> None:
    changed = []
    if patch_ingest():
        changed.append("src/ingest.js")
    if patch_dashboard():
        changed.append("index.html")
    print("[account-coach] " + ("patched " + ", ".join(changed) if changed else "integration already present"))


if __name__ == "__main__":
    main()
