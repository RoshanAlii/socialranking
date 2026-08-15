#!/usr/bin/env python3
"""Build auditable developer intelligence for active confirmed Kirpa creators.

One Apify Actor run collects the incremental Reel window for the whole active
roster. Each unseen Reel is downloaded and transcribed once; that one word-level
result is matched against every configured developer before the media is
discarded. The committed cache retains only detected language, a transcript
fingerprint, and developer matches — never the full transcript or media.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import os
import re
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

try:
    from .reel_mentions import (
        CACHE_RETENTION_DAYS, DEFAULT_ACTOR, DEFAULT_MODEL, MentionCountError, SpokenWord,
        canonical_handle, download_media, iso_z, load_json, match_quality_issue, media_url,
        normalize_token, parse_timestamp, reel_identity, reel_url, safe_failure,
        select_recent_reels, thumbnail_url, caption_snippet, utc_now, write_json_atomic,
    )
except ImportError:  # direct `python src/developer_intelligence.py` execution
    from reel_mentions import (
        CACHE_RETENTION_DAYS, DEFAULT_ACTOR, DEFAULT_MODEL, MentionCountError, SpokenWord,
        canonical_handle, download_media, iso_z, load_json, match_quality_issue, media_url,
        normalize_token, parse_timestamp, reel_identity, reel_url, safe_failure,
        select_recent_reels, thumbnail_url, caption_snippet, utc_now, write_json_atomic,
    )


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROSTER = ROOT / "handles.json"
DEFAULT_DICTIONARY = ROOT / "developer-dictionary.json"
DEFAULT_OUTPUT = ROOT / "data" / "developer-intelligence.json"
DEFAULT_CACHE = ROOT / "data" / "developer-intelligence-cache.json"
DEFAULT_STATUS = ROOT / "data" / "developer-intelligence-status.json"
WINDOW_DAYS = 30
RUN_INTERVAL_DAYS = 14
INCREMENTAL_OVERLAP_DAYS = 2
MAX_REELS_PER_CREATOR = 40
MAX_TOTAL_ITEMS = 1200
SCHEMA_VERSION = 3
TRANSCRIPT_VERSION = 1
KIRPA_HANDLE_PATTERN = re.compile(r"\.kirpaa?(?:\.|$)", re.IGNORECASE)
APIFY_TERMINAL_STATES = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}
APIFY_RUN_TIMEOUT_SECONDS = 30 * 60


def active_creators(roster: dict[str, Any]) -> list[dict[str, str]]:
    if roster.get("activePlatforms", ["instagram"]) != ["instagram"]:
        raise MentionCountError("Developer analysis requires Instagram to be the only active platform")
    rows = []
    for employee in roster.get("employees", []):
        handle = canonical_handle((employee.get("handles") or {}).get("instagram"))
        if (
            employee.get("dashboardRelevant") is not False
            and employee.get("confirmed") is True
            and employee.get("needsHumanConfirmation") is not True
            and employee.get("optOut") is not True
            and handle
            and KIRPA_HANDLE_PATTERN.search(handle)
        ):
            rows.append({"name": employee.get("name") or handle, "handle": handle})
    return rows


def reel_owner(item: dict[str, Any]) -> str:
    owner = item.get("owner") if isinstance(item.get("owner"), dict) else {}
    author = item.get("authorMeta") if isinstance(item.get("authorMeta"), dict) else {}
    explicit = canonical_handle(
        item.get("ownerUsername") or item.get("username") or owner.get("username")
        or owner.get("userName") or author.get("name")
    )
    if explicit:
        return explicit
    parent = item.get("parentData") if isinstance(item.get("parentData"), dict) else {}
    source = str(item.get("inputUrl") or item.get("directUrl") or parent.get("inputUrl") or "")
    matched = re.search(r"instagram\.com/([^/?#]+)/?", source, re.IGNORECASE)
    return canonical_handle(matched.group(1)) if matched else ""


def select_roster_reels(
    items: Sequence[dict[str, Any]], creators: Sequence[dict[str, str]],
    start: datetime, end: datetime,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Attribute every Reel before it can enter creator-level evidence."""
    wanted = {row["handle"] for row in creators}
    selected: dict[str, dict[str, Any]] = {}
    missing_owner = 0
    foreign_owner = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        owner = reel_owner(item)
        if not owner:
            missing_owner += 1
            continue
        if owner not in wanted:
            foreign_owner += 1
            continue
        matched = select_recent_reels([item], owner, start, end)
        if not matched:
            continue
        copied = dict(matched[0])
        copied["_ownerHandle"] = owner
        key = f"{owner}:{reel_identity(copied)}"
        existing = selected.get(key)
        if not existing or (media_url(copied) and not media_url(existing)):
            selected[key] = copied
    if missing_owner:
        raise MentionCountError(
            f"Apify returned {missing_owner} Reel row(s) without a verifiable creator; preserved the prior report"
        )
    return list(selected.values()), {
        "attributedItems": len(selected),
        "foreignOwnerItems": foreign_owner,
        "missingOwnerItems": missing_owner,
    }


def normalized_dictionary(config: dict[str, Any]) -> list[dict[str, Any]]:
    developers = []
    seen = set()
    for row in config.get("developers", []):
        key = str(row.get("key") or "").strip()
        name = str(row.get("name") or "").strip()
        if not key or not name or key in seen:
            raise MentionCountError("Developer dictionary contains a missing or duplicate key")
        seen.add(key)
        phrases = []
        for variant in [name, *(row.get("variants") or [])]:
            tokens = tuple(
                token for token in (normalize_token(part) for part in str(variant).split()) if token
            )
            if tokens and tokens not in phrases:
                phrases.append(tokens)
        developers.append({"key": key, "name": name, "phrases": phrases})
    if not developers:
        raise MentionCountError("Developer dictionary is empty")
    return developers


def developer_matches(
    words: Sequence[SpokenWord], developers: Sequence[dict[str, Any]]
) -> list[dict[str, Any]]:
    tokens = [normalize_token(word.text) for word in words]
    found = []
    for developer in developers:
        matches = []
        index = 0
        phrases = sorted(developer["phrases"], key=len, reverse=True)
        while index < len(words):
            matched = None
            for phrase in phrases:
                end = index + len(phrase)
                if end <= len(words) and tuple(tokens[index:end]) == phrase:
                    if len(phrase) > 1:
                        gaps = [words[pos + 1].start - words[pos].end for pos in range(index, end - 1)]
                        if any(gap > 0.55 for gap in gaps):
                            continue
                    matched = phrase
                    break
            if not matched:
                index += 1
                continue
            end_index = index + len(matched) - 1
            matches.append({
                "start": round(max(0.0, words[index].start), 2),
                "end": round(max(words[end_index].start, words[end_index].end), 2),
                "heardAs": " ".join(word.text.strip() for word in words[index : end_index + 1]).strip(),
            })
            index = end_index + 1
        quality_issue = match_quality_issue(matches)
        if quality_issue:
            raise MentionCountError(f"Transcript quality gate for {developer['name']}: {quality_issue}")
        if matches:
            found.append({
                "developerKey": developer["key"],
                "developer": developer["name"],
                "mentionCount": len(matches),
                "matches": matches,
            })
    return found


class DeveloperTranscriber:
    def __init__(self, model_name: str = DEFAULT_MODEL):
        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            raise MentionCountError("Install requirements-mentions.txt before transcribing") from error
        self.model_name = model_name
        self.model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=4)

    def transcribe(self, media_path: Path) -> tuple[list[SpokenWord], str | None, float | None]:
        prompt = (
            "Faithfully transcribe this Dubai real-estate Reel. Preserve audible proper names "
            "and developer brands without translating them. Do not infer or insert a brand from context."
        )
        segments, info = self.model.transcribe(
            str(media_path), beam_size=5, temperature=0, vad_filter=True,
            word_timestamps=True, initial_prompt=prompt, condition_on_previous_text=False,
        )
        words = []
        for segment in segments:
            for word in segment.words or []:
                words.append(SpokenWord(float(word.start), float(word.end), str(word.word)))
        language = getattr(info, "language", None)
        probability = getattr(info, "language_probability", None)
        return words, language, round(float(probability), 4) if probability is not None else None


def transcript_fingerprint(words: Sequence[SpokenWord]) -> str:
    normalized = " ".join(normalize_token(word.text) for word in words if normalize_token(word.text))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def process_reel(
    item: dict[str, Any], owner: str, transcriber: DeveloperTranscriber,
    developers: Sequence[dict[str, Any]], now: datetime, dictionary_version: str,
) -> dict[str, Any]:
    source = media_url(item)
    if not source:
        raise MentionCountError("Apify returned no downloadable audio or video URL")
    identity = reel_identity(item)
    suffix = Path(source.split("?", 1)[0]).suffix.lower()
    if suffix not in {".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".wav"}:
        suffix = ".mp4"
    with tempfile.TemporaryDirectory(prefix="developer-reel-") as directory:
        media_path = Path(directory) / f"{identity}{suffix}"
        download_media(source, media_path)
        words, language, probability = transcriber.transcribe(media_path)
    matches = developer_matches(words, developers)
    return {
        "sourcePublishedAt": item["_publishedAt"],
        "ownerHandle": owner,
        "transcriptVersion": TRANSCRIPT_VERSION,
        "dictionaryVersion": dictionary_version,
        "processedAt": iso_z(now),
        "language": language,
        "languageProbability": probability,
        "transcriptFingerprint": transcript_fingerprint(words),
        "wordCount": len(words),
        "developerMatches": matches,
    }


def cache_entry_valid(
    entry: Any, published_at: str, owner: str, dictionary_version: str
) -> bool:
    return bool(
        isinstance(entry, dict)
        and entry.get("sourcePublishedAt") == published_at
        and canonical_handle(entry.get("ownerHandle")) == canonical_handle(owner)
        and entry.get("transcriptVersion") == TRANSCRIPT_VERSION
        and entry.get("dictionaryVersion") == dictionary_version
        and isinstance(entry.get("developerMatches"), list)
        and isinstance(entry.get("transcriptFingerprint"), str)
    )


def wait_for_apify_run(
    requests_module: Any,
    token: str,
    initial_run: dict[str, Any],
    timeout_seconds: int = APIFY_RUN_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Wait through Apify's 60-second response cap until the run is terminal."""
    run = initial_run
    run_id = run.get("id")
    if not run_id:
        raise MentionCountError("Apify run response omitted the run id")
    deadline = time.monotonic() + timeout_seconds
    while run.get("status") not in APIFY_TERMINAL_STATES:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise MentionCountError(f"Apify run {run_id} did not finish within {timeout_seconds} seconds")
        response = requests_module.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"waitForFinish": max(1, min(60, int(remaining)))},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=max(5, min(70, int(remaining) + 5)),
        )
        if response.status_code >= 400:
            raise MentionCountError(
                f"Apify run status returned HTTP {response.status_code}: "
                f"{response.text[:300].replace(token, '[redacted]')}"
            )
        payload = response.json() or {}
        run = payload.get("data", payload)
    return run


def apify_collect(
    token: str, handles: Sequence[str], lookback_days: int, actor: str = DEFAULT_ACTOR
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        import requests
    except ImportError as error:
        raise MentionCountError("Install requirements-mentions.txt before collecting Reels") from error
    started = requests.post(
        f"https://api.apify.com/v2/acts/{actor}/runs",
        params={"waitForFinish": 300, "memory": 1024, "maxTotalChargeUsd": "0.75"},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "directUrls": [f"https://www.instagram.com/{handle}/reels/" for handle in handles],
            "resultsType": "reels",
            "resultsLimit": MAX_REELS_PER_CREATOR,
            "onlyPostsNewerThan": f"{lookback_days} days",
        },
        timeout=330,
    )
    if started.status_code >= 400:
        raise MentionCountError(
            f"Apify returned HTTP {started.status_code}: {started.text[:500].replace(token, '[redacted]')}"
        )
    payload = started.json() or {}
    run = wait_for_apify_run(requests, token, payload.get("data", payload))
    if run.get("status") != "SUCCEEDED":
        raise MentionCountError(
            f"Apify run {run.get('id', 'unknown')} ended {run.get('status', 'without a status')}"
        )
    dataset = requests.get(
        f"https://api.apify.com/v2/datasets/{run.get('defaultDatasetId')}/items",
        params={"clean": "true", "format": "json", "limit": MAX_TOTAL_ITEMS},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=120,
    )
    if dataset.status_code >= 400:
        raise MentionCountError(f"Apify dataset returned HTTP {dataset.status_code}: {dataset.text[:300]}")
    items = dataset.json()
    if not isinstance(items, list):
        raise MentionCountError("Apify developer dataset was not an item list")
    telemetry = {
        "actor": actor,
        "runId": run.get("id"),
        "status": run.get("status"),
        "costUsd": run.get("usageTotalUsd"),
        "itemCount": len(items),
        "lookbackDays": lookback_days,
    }
    return items, telemetry


def incremental_lookback(previous: dict[str, Any], now: datetime, dictionary_version: str) -> int:
    if previous.get("dictionaryVersion") != dictionary_version:
        return WINDOW_DAYS + 1
    generated = parse_timestamp(previous.get("generatedAt")) if previous.get("schemaVersion") == SCHEMA_VERSION else None
    if not generated or generated > now:
        return WINDOW_DAYS + 1
    age_days = math.ceil((now - generated).total_seconds() / 86400)
    if age_days > WINDOW_DAYS:
        return WINDOW_DAYS + 1
    return min(WINDOW_DAYS + 1, max(3, age_days + INCREMENTAL_OVERLAP_DAYS))


def reel_common(item: dict[str, Any], owner_name: str, owner_handle: str) -> dict[str, Any]:
    return {
        "id": reel_identity(item),
        "shortCode": item.get("shortCode") or item.get("shortcode"),
        "url": reel_url(item),
        "thumbnailUrl": thumbnail_url(item),
        "captionSnippet": caption_snippet(item),
        "publishedAt": item["_publishedAt"],
        "ownerName": owner_name,
        "ownerHandle": owner_handle,
    }


def build_report(
    creators: Sequence[dict[str, str]], reels: Sequence[dict[str, Any]],
    results: dict[str, dict[str, Any]], failures: dict[str, str],
    previous_rows: Sequence[dict[str, Any]], dictionary_config: dict[str, Any],
    start: datetime, now: datetime, telemetry: dict[str, Any], roster_version: str | None,
) -> dict[str, Any]:
    names = {row["handle"]: row["name"] for row in creators}
    rows_by_key: dict[str, dict[str, Any]] = {}
    for row in previous_rows:
        published = parse_timestamp(row.get("publishedAt"))
        owner = canonical_handle(row.get("ownerHandle"))
        identity = str(row.get("id") or "")
        if published and start <= published <= now and owner in names and identity:
            rows_by_key[f"{owner}:{identity}"] = row
    for item in reels:
        owner = canonical_handle(item.get("ownerUsername") or item.get("username") or item.get("_ownerHandle"))
        identity = reel_identity(item)
        key = f"{owner}:{identity}"
        common = reel_common(item, names.get(owner, owner), owner)
        result = results.get(key)
        if result:
            matches = result.get("developerMatches", [])
            rows_by_key[key] = {
                **common,
                "status": "processed",
                "language": result.get("language"),
                "languageProbability": result.get("languageProbability"),
                "wordCount": result.get("wordCount"),
                "mentionCount": sum(match.get("mentionCount", 0) for match in matches),
                "developerMatches": matches,
            }
        else:
            rows_by_key[key] = {
                **common,
                "status": "failed",
                "language": None,
                "languageProbability": None,
                "wordCount": None,
                "mentionCount": None,
                "developerMatches": [],
                "error": failures.get(key, "Processing failed"),
            }
    rows = sorted(rows_by_key.values(), key=lambda row: row.get("publishedAt") or "", reverse=True)
    processed = [row for row in rows if row.get("status") == "processed"]
    failed = [row for row in rows if row.get("status") != "processed"]
    with_mentions = [row for row in processed if (row.get("mentionCount") or 0) > 0]

    developer_rows = []
    for developer in dictionary_config.get("developers", []):
        matches = []
        for row in processed:
            match = next(
                (item for item in row.get("developerMatches", []) if item.get("developerKey") == developer.get("key")),
                None,
            )
            if match:
                matches.append((row, match))
        developer_rows.append({
            "key": developer.get("key"),
            "name": developer.get("name"),
            "totalMentions": sum(match.get("mentionCount", 0) for _, match in matches),
            "reels": len(matches),
            "creators": len({row.get("ownerHandle") for row, _ in matches}),
            "mentionRate": round(len(matches) / len(processed), 4) if processed else None,
        })
    developer_rows.sort(key=lambda row: (-row["reels"], -row["totalMentions"], row["name"]))

    creator_rows = []
    for creator in creators:
        creator_reels = [row for row in rows if row.get("ownerHandle") == creator["handle"]]
        creator_processed = [row for row in creator_reels if row.get("status") == "processed"]
        creator_mentions = [row for row in creator_processed if (row.get("mentionCount") or 0) > 0]
        mix: dict[str, dict[str, Any]] = {}
        for row in creator_mentions:
            for match in row.get("developerMatches", []):
                item = mix.setdefault(match["developerKey"], {
                    "key": match["developerKey"], "name": match["developer"], "mentions": 0, "reels": 0,
                })
                item["mentions"] += match.get("mentionCount", 0)
                item["reels"] += 1
        creator_rows.append({
            "name": creator["name"],
            "handle": creator["handle"],
            "totalReels": len(creator_reels),
            "processedReels": len(creator_processed),
            "failedReels": len(creator_reels) - len(creator_processed),
            "processingCoverage": round(len(creator_processed) / len(creator_reels), 4) if creator_reels else 1,
            "reelsWithDeveloperMention": len(creator_mentions),
            "totalDeveloperMentions": sum(row.get("mentionCount") or 0 for row in creator_processed),
            "developerShare": round(len(creator_mentions) / len(creator_processed), 4) if creator_processed else None,
            "developerDiversity": len(mix),
            "developerMix": sorted(mix.values(), key=lambda row: (-row["reels"], -row["mentions"], row["name"])),
        })

    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": "complete" if not failed else "partial",
        "generatedAt": iso_z(now),
        "windowStart": iso_z(start),
        "windowEnd": iso_z(now),
        "windowDays": WINDOW_DAYS,
        "rosterVersion": roster_version,
        "dictionaryVersion": dictionary_config.get("dictionaryVersion"),
        "activeCreators": len(creators),
        "totalReels": len(rows),
        "processedReels": len(processed),
        "failedReels": len(failed),
        "processingCoverage": round(len(processed) / len(rows), 4) if rows else 1,
        "reelsWithDeveloperMention": len(with_mentions),
        "totalDeveloperMentions": sum(row.get("mentionCount") or 0 for row in processed),
        "developerShare": round(len(with_mentions) / len(processed), 4) if processed else None,
        "developerDiversity": len({
            match.get("developerKey") for row in with_mentions for match in row.get("developerMatches", [])
        }),
        "developers": developer_rows,
        "creators": creator_rows,
        "reels": rows,
        "method": {
            "collector": DEFAULT_ACTOR,
            "transcriber": f"faster-whisper/{os.environ.get('WHISPER_MODEL', DEFAULT_MODEL)}",
            "oneTranscriptPerReel": True,
            "transcriptsPublished": False,
            "matchRule": dictionary_config.get("matching"),
            "multilingualVariants": True,
        },
        "providerTelemetry": telemetry,
    }


def prune_cache(entries: dict[str, Any], now: datetime) -> dict[str, Any]:
    cutoff = now - timedelta(days=max(CACHE_RETENTION_DAYS, 75))
    return {
        key: value for key, value in entries.items()
        if isinstance(value, dict) and (parse_timestamp(value.get("sourcePublishedAt")) or datetime.min.replace(tzinfo=timezone.utc)) >= cutoff
    }


def write_status(path: Path, value: dict[str, Any]) -> None:
    write_json_atomic(path, {"schemaVersion": 1, **value})


def run(args: argparse.Namespace) -> dict[str, Any]:
    now = parse_timestamp(args.as_of) if args.as_of else utc_now()
    if now is None:
        raise MentionCountError("--as-of must be a valid ISO timestamp")
    roster = load_json(Path(args.roster), {})
    dictionary_config = load_json(Path(args.dictionary), {})
    creators = active_creators(roster)
    if not creators:
        raise MentionCountError("No active confirmed .kirpa creators were found")
    developers = normalized_dictionary(dictionary_config)
    previous = load_json(Path(args.output), {})
    dictionary_version = str(dictionary_config.get("dictionaryVersion") or "unversioned")
    lookback_days = incremental_lookback(previous, now, dictionary_version)
    token = os.environ.get("APIFY_TOKEN_MENTION_COUNT") or os.environ.get("APIFY_TOKEN")
    if args.fixture:
        items = load_json(Path(args.fixture), [])
        telemetry = {"actor": "fixture", "runId": None, "status": "SUCCEEDED", "costUsd": 0, "itemCount": len(items), "lookbackDays": lookback_days}
    else:
        if not token:
            raise MentionCountError("APIFY_TOKEN_MENTION_COUNT or APIFY_TOKEN is required")
        items, telemetry = apify_collect(token, [row["handle"] for row in creators], lookback_days, args.actor)

    start = now - timedelta(days=WINDOW_DAYS)
    collect_start = now - timedelta(days=lookback_days)
    selected, attribution = select_roster_reels(items, creators, collect_start, now)
    telemetry.update(attribution)

    cache_path = Path(args.cache)
    cache = load_json(cache_path, {"schemaVersion": SCHEMA_VERSION, "reels": {}})
    entries = prune_cache(cache.get("reels", {}), now)
    results: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}
    transcriber = None
    for item in selected:
        owner = canonical_handle(item.get("_ownerHandle"))
        key = f"{owner}:{reel_identity(item)}"
        entry = entries.get(key)
        if cache_entry_valid(entry, item["_publishedAt"], owner, dictionary_version):
            results[key] = entry
            continue
        try:
            if args.dry_run:
                raise MentionCountError("Dry run does not transcribe uncached media")
            transcriber = transcriber or DeveloperTranscriber(args.model)
            result = process_reel(item, owner, transcriber, developers, now, dictionary_version)
            entries[key] = result
            results[key] = result
        except Exception as error:
            failures[key] = safe_failure(error)

    report = build_report(
        creators, selected, results, failures, previous.get("reels", []), dictionary_config,
        start, now, telemetry, roster.get("rosterVersion"),
    )
    write_json_atomic(cache_path, {
        "schemaVersion": SCHEMA_VERSION,
        "updatedAt": iso_z(now),
        "retentionDays": 75,
        "dictionaryVersion": dictionary_version,
        "reels": entries,
    })
    write_json_atomic(Path(args.output), report)
    write_status(Path(args.status), {
        "outcome": "success" if report["status"] == "complete" else "partial",
        "attemptedAt": iso_z(now),
        "lastSuccessfulAt": iso_z(now),
        "reason": None,
        "processingCoverage": report["processingCoverage"],
        "failedReels": report["failedReels"],
    })
    return report


def due(output: Path, now: datetime) -> bool:
    report = load_json(output, {})
    generated = parse_timestamp(report.get("generatedAt"))
    return generated is None or now - generated >= timedelta(days=RUN_INTERVAL_DAYS)


def github_output(values: dict[str, Any]) -> None:
    destination = os.environ.get("GITHUB_OUTPUT")
    if destination:
        with Path(destination).open("a", encoding="utf-8") as output:
            for key, value in values.items():
                output.write(f"{key}={str(value).lower() if isinstance(value, bool) else value}\n")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--roster", default=str(DEFAULT_ROSTER))
    result.add_argument("--dictionary", default=str(DEFAULT_DICTIONARY))
    result.add_argument("--output", default=str(DEFAULT_OUTPUT))
    result.add_argument("--cache", default=str(DEFAULT_CACHE))
    result.add_argument("--status", default=str(DEFAULT_STATUS))
    result.add_argument("--model", default=os.environ.get("WHISPER_MODEL", DEFAULT_MODEL))
    result.add_argument("--actor", default=os.environ.get("APIFY_REELS_ACTOR", DEFAULT_ACTOR))
    result.add_argument("--fixture")
    result.add_argument("--as-of")
    result.add_argument("--dry-run", action="store_true")
    result.add_argument("--check-due", action="store_true")
    return result


def main() -> int:
    args = parser().parse_args()
    now = parse_timestamp(args.as_of) if args.as_of else utc_now()
    if now is None:
        print("::error title=Developer intelligence failed::Invalid --as-of timestamp")
        return 2
    if args.check_due:
        is_due = due(Path(args.output), now)
        github_output({"due": is_due})
        print(f"Developer analysis is {'due' if is_due else 'not due'}.")
        return 0
    try:
        report = run(args)
    except MentionCountError as error:
        previous = load_json(Path(args.output), {})
        write_status(Path(args.status), {
            "outcome": "preserved",
            "attemptedAt": iso_z(now),
            "lastSuccessfulAt": previous.get("generatedAt"),
            "reason": safe_failure(error),
            "dataPreserved": True,
        })
        print(f"::warning title=Developer intelligence preserved::{safe_failure(error)}")
        return 0 if previous.get("schemaVersion") == SCHEMA_VERSION else 2
    print(
        f"Developer intelligence: {report['processedReels']}/{report['totalReels']} Reels processed, "
        f"{report['reelsWithDeveloperMention']} with developer mentions."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
