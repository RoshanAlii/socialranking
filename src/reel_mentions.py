#!/usr/bin/env python3
"""Count spoken brand mentions in recent Instagram Reels.

The live path deliberately has three boundaries:

1. Apify returns public Reel metadata and short-lived media URLs.
2. Faster Whisper transcribes each previously unseen Reel locally on the
   GitHub runner. No transcript or media file is published.
3. A small, auditable cache stores only language, count, and matched
   timestamps so the same Reel is never transcribed twice.

Unknown and failed media are never converted to zero. A report with any
unprocessed Reel is marked partial and exposes its processing coverage.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "reel-mentions.json"
DEFAULT_CACHE = ROOT / "data" / "reel-mention-cache.json"
DEFAULT_ACCOUNT = "kirpa.properties"
DEFAULT_TARGET = "DAMAC"
DEFAULT_WINDOW_DAYS = 30
DEFAULT_MODEL = "small"
DEFAULT_ACTOR = "apify~instagram-scraper"
MAX_REELS = 100
MAX_MEDIA_BYTES = 300 * 1024 * 1024
CACHE_RETENTION_DAYS = 45
SCHEMA_VERSION = 2
TRANSCRIPTION_PROMPT_VERSION = 2

# These are plausible renderings of the same spoken name, not translations of
# arbitrary words. Faster Whisper can return native script or transliteration
# depending on the surrounding sentence and code-switching.
DEFAULT_VARIANTS = {
    # Latin
    "kirpa", "kripa", "kerpa", "kurpa", "keerpa", "kirpaa", "kripaa",
    "kirpah", "kirba", "keerbaa", "crepa",
    # Devanagari (Hindi/Marathi/Nepali)
    "किरपा", "कृपा", "क्रिपा",
    # Gurmukhi (Punjabi)
    "ਕਿਰਪਾ", "ਕ੍ਰਿਪਾ",
    # Perso-Arabic (Urdu/Arabic renderings)
    "کرپا", "كيرپا", "كِرپا", "کِرپا", "كيربا", "كربا",
    # South Indian scripts
    "கிர்பா", "கிருபா", "കിർപ", "കൃപ", "കിർപ്പ",
    "కిర్పా", "కృప", "ಕಿರ್ಪಾ", "ಕೃಪಾ",
    # Sinhala
    "කිර්පා", "කිරපා",
}

TARGET_VARIANTS = {
    "damac": {
        # Common Latin ASR renderings of the developer name.
        "damac", "damak", "dmac", "demac", "da mac",
        # Arabic/Perso-Arabic renderings seen in Gulf property content.
        "داماك", "داماک", "دامك", "دماك",
    },
    # Retained for reproducible historical runs.
    "kirpa": DEFAULT_VARIANTS,
}


class MentionCountError(RuntimeError):
    """Expected operational failure that is safe to show in Actions logs."""


@dataclass(frozen=True)
class SpokenWord:
    start: float
    end: float
    text: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime) -> str:
    value = value.astimezone(timezone.utc)
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric > 10_000_000_000:
            numeric /= 1000
        try:
            return datetime.fromtimestamp(numeric, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return parse_timestamp(float(text))
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def canonical_handle(value: Any) -> str:
    return str(value or "").strip().lstrip("@").lower()


def normalize_token(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).casefold().strip()
    return "".join(char for char in text if unicodedata.category(char)[0] in {"L", "M", "N"})


def variants_for(target: str, extras: str | None = None) -> set[str]:
    values = set(TARGET_VARIANTS.get(normalize_token(target), ()))
    values.add(target)
    if extras:
        values.update(part.strip() for part in extras.split(",") if part.strip())
    return {normalize_token(value) for value in values if normalize_token(value)}


def _latin(value: str) -> bool:
    return bool(value) and all("a" <= char <= "z" or "0" <= char <= "9" for char in value)


def is_target_token(token: str, variants: set[str]) -> bool:
    normalized = normalize_token(token)
    if normalized in variants:
        return True

    # Keep historical Kirpa fuzzy matching deliberately narrow. DAMAC uses an
    # explicit variant list so ordinary words such as "damage" cannot drift
    # into the count through approximate matching.
    if "kirpa" not in variants:
        return False
    if not _latin(normalized) or not (4 <= len(normalized) <= 6):
        return False
    if normalized[0] not in {"k", "c"} or "p" not in normalized:
        return False
    return any(_latin(candidate) and levenshtein(normalized, candidate) <= 1 for candidate in variants)


def levenshtein(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for row, lchar in enumerate(left, start=1):
        current = [row]
        for column, rchar in enumerate(right, start=1):
            current.append(min(
                current[-1] + 1,
                previous[column] + 1,
                previous[column - 1] + (lchar != rchar),
            ))
        previous = current
    return previous[-1]


def count_words(words: Sequence[SpokenWord], variants: set[str]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    index = 0
    while index < len(words):
        word = words[index]
        if is_target_token(word.text, variants):
            matches.append({
                "start": round(max(0.0, word.start), 2),
                "end": round(max(word.start, word.end), 2),
                "heardAs": word.text.strip(),
            })
            index += 1
            continue

        # ASR occasionally splits a short proper name into two tokens ("Kir"
        # + "pa"). Join only adjacent words with a tight audio gap.
        if index + 1 < len(words):
            following = words[index + 1]
            joined = normalize_token(word.text) + normalize_token(following.text)
            gap = following.start - word.end
            if gap <= 0.45 and is_target_token(joined, variants):
                matches.append({
                    "start": round(max(0.0, word.start), 2),
                    "end": round(max(following.start, following.end), 2),
                    "heardAs": f"{word.text.strip()} {following.text.strip()}".strip(),
                })
                index += 2
                continue
        index += 1
    return matches


def match_quality_issue(matches: Sequence[dict[str, Any]]) -> str | None:
    """Reject obvious ASR repetition artifacts instead of publishing them.

    A real speaker cannot say the same word three times at the same audio
    instant. Whisper can emit that shape when music or silence triggers a
    decoder loop, especially after a brand-heavy prompt.
    """
    starts: dict[int, int] = {}
    zero_length = 0
    for match in matches:
        start = float(match.get("start") or 0)
        end = float(match.get("end") or start)
        bucket = round(start * 20)  # 50 ms buckets tolerate timestamp jitter.
        starts[bucket] = starts.get(bucket, 0) + 1
        if end <= start:
            zero_length += 1
    if starts and max(starts.values()) >= 3:
        return "repeated target words share the same audio timestamp"
    if zero_length >= 3:
        return "multiple target words have zero-length audio timestamps"
    return None


def reel_identity(item: dict[str, Any]) -> str | None:
    value = item.get("id") or item.get("shortCode") or item.get("shortcode")
    return str(value) if value not in (None, "") else None


def reel_url(item: dict[str, Any]) -> str | None:
    direct = item.get("url") or item.get("postUrl")
    if isinstance(direct, str) and direct.startswith("https://www.instagram.com/"):
        return direct
    code = item.get("shortCode") or item.get("shortcode")
    return f"https://www.instagram.com/reel/{code}/" if code else None


def media_url(item: dict[str, Any]) -> str | None:
    for key in ("videoUrl", "audioUrl"):
        value = item.get(key)
        if isinstance(value, str) and value.startswith("https://"):
            return value
    return None


def thumbnail_url(item: dict[str, Any]) -> str | None:
    for key in ("displayUrl", "thumbnailUrl", "imageUrl", "previewUrl"):
        value = item.get(key)
        if isinstance(value, str) and value.startswith("https://"):
            return value
    images = item.get("images")
    if isinstance(images, list):
        for value in images:
            candidate = value.get("url") if isinstance(value, dict) else value
            if isinstance(candidate, str) and candidate.startswith("https://"):
                return candidate
    return None


def caption_snippet(item: dict[str, Any], limit: int = 180) -> str | None:
    caption = re.sub(r"\s+", " ", str(item.get("caption") or "")).strip()
    if not caption:
        return None
    return caption if len(caption) <= limit else caption[: limit - 1].rstrip() + "…"


def select_recent_reels(
    items: Iterable[dict[str, Any]],
    account: str,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    expected_owner = canonical_handle(account)
    for item in items:
        if not isinstance(item, dict):
            continue
        identity = reel_identity(item)
        published = parse_timestamp(
            item.get("timestamp") or item.get("takenAtTimestamp") or item.get("publishedAt")
        )
        owner = canonical_handle(item.get("ownerUsername") or item.get("username"))
        if not identity or not published or published < start or published > end + timedelta(minutes=10):
            continue
        if owner and owner != expected_owner:
            continue
        product_type = str(item.get("productType") or "").lower()
        item_type = str(item.get("type") or "").lower()
        url = str(reel_url(item) or "").lower()
        if product_type not in {"clips", "reel", "reels"} and item_type != "video" and "/reel" not in url:
            continue
        copied = dict(item)
        copied["_publishedAt"] = iso_z(published)
        existing = selected.get(identity)
        if not existing or (media_url(copied) and not media_url(existing)):
            selected[identity] = copied
    return sorted(selected.values(), key=lambda row: row["_publishedAt"], reverse=True)


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback
    except json.JSONDecodeError as error:
        raise MentionCountError(f"Invalid JSON in {path.relative_to(ROOT)}: {error}") from error


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def fetch_apify_reels(
    token: str,
    account: str,
    window_days: int,
    actor: str = DEFAULT_ACTOR,
) -> list[dict[str, Any]]:
    try:
        import requests
    except ImportError as error:
        raise MentionCountError("Install requirements-mentions.txt before running the live counter") from error

    endpoint = f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
    response = requests.post(
        endpoint,
        params={
            "timeout": 300,
            "memory": 1024,
            "maxItems": MAX_REELS,
            "maxTotalChargeUsd": "0.25",
            "clean": "true",
        },
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json={
            "directUrls": [f"https://www.instagram.com/{canonical_handle(account)}/reels/"],
            "resultsType": "reels",
            "resultsLimit": MAX_REELS,
            # Fetch one extra day, then apply the exact rolling boundary here.
            "onlyPostsNewerThan": f"{window_days + 1} days",
        },
        timeout=330,
    )
    if response.status_code >= 400:
        message = response.text[:500].replace(token, "[redacted]")
        raise MentionCountError(f"Apify returned HTTP {response.status_code}: {message}")
    try:
        payload = response.json()
    except ValueError as error:
        raise MentionCountError("Apify returned a non-JSON response") from error
    if not isinstance(payload, list):
        raise MentionCountError("Apify response was not a dataset item list")
    return payload


def download_media(url: str, destination: Path) -> None:
    try:
        import requests
    except ImportError as error:
        raise MentionCountError("Install requirements-mentions.txt before downloading media") from error
    headers = {"User-Agent": "Mozilla/5.0 (compatible; KirpaMentionCounter/1.0)"}
    with requests.get(url, headers=headers, stream=True, timeout=(20, 180)) as response:
        response.raise_for_status()
        expected = int(response.headers.get("content-length") or 0)
        if expected > MAX_MEDIA_BYTES:
            raise MentionCountError("Reel media exceeds the 300 MB safety limit")
        written = 0
        with destination.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                written += len(chunk)
                if written > MAX_MEDIA_BYTES:
                    raise MentionCountError("Reel media exceeds the 300 MB safety limit")
                output.write(chunk)
        if written == 0:
            raise MentionCountError("Reel media download was empty")


class LocalTranscriber:
    def __init__(self, model_name: str = DEFAULT_MODEL):
        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            raise MentionCountError("Install requirements-mentions.txt before transcribing") from error
        self.model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=4)

    def transcribe(self, media_path: Path, target: str) -> tuple[list[SpokenWord], str | None, float | None]:
        prompt = (
            "Faithfully transcribe this Dubai real-estate Reel. Preserve proper names and brands "
            "such as DAMAC, Sobha, Emaar and Kirpa only when they are actually audible. "
            "Do not infer, insert or repeat a company name from context."
        )
        segments, info = self.model.transcribe(
            str(media_path),
            beam_size=5,
            temperature=0,
            vad_filter=True,
            word_timestamps=True,
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        words: list[SpokenWord] = []
        for segment in segments:
            for word in segment.words or []:
                words.append(SpokenWord(float(word.start), float(word.end), str(word.word)))
        language = getattr(info, "language", None)
        probability = getattr(info, "language_probability", None)
        return words, language, round(float(probability), 4) if probability is not None else None


def safe_failure(error: Exception) -> str:
    message = re.sub(r"https?://\S+", "[media-url]", str(error))
    message = re.sub(r"apify_api_[A-Za-z0-9_-]+", "[redacted]", message)
    return message[:220]


def cache_entry_valid(entry: Any, published_at: str, target: str) -> bool:
    return bool(
        isinstance(entry, dict)
        and entry.get("sourcePublishedAt") == published_at
        and entry.get("targetKey") == normalize_token(target)
        and isinstance(entry.get("mentionCount"), int)
        and entry.get("mentionCount") >= 0
        and isinstance(entry.get("matches"), list)
        and match_quality_issue(entry.get("matches", [])) is None
        # Recheck legacy positive matches produced by the old brand-heavy
        # prompt. Confirmed zeros can stay cached; only the questionable
        # positives need another media download and neutral transcription.
        and (
            entry.get("mentionCount") == 0
            or entry.get("transcriptionPromptVersion") == TRANSCRIPTION_PROMPT_VERSION
        )
    )


def process_reel(
    item: dict[str, Any],
    transcriber: LocalTranscriber,
    target: str,
    variants: set[str],
    now: datetime,
) -> dict[str, Any]:
    source = media_url(item)
    if not source:
        raise MentionCountError("Apify returned no downloadable audio or video URL")
    identity = reel_identity(item)
    suffix = Path(source.split("?", 1)[0]).suffix.lower()
    if suffix not in {".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".wav"}:
        suffix = ".mp4"
    with tempfile.TemporaryDirectory(prefix="brand-reel-") as directory:
        media_path = Path(directory) / f"{identity}{suffix}"
        download_media(source, media_path)
        words, language, probability = transcriber.transcribe(media_path, target)
    matches = count_words(words, variants)
    quality_issue = match_quality_issue(matches)
    if quality_issue:
        raise MentionCountError(f"Transcript quality gate: {quality_issue}")
    return {
        "sourcePublishedAt": item["_publishedAt"],
        "targetKey": normalize_token(target),
        "transcriptionPromptVersion": TRANSCRIPTION_PROMPT_VERSION,
        "processedAt": iso_z(now),
        "language": language,
        "languageProbability": probability,
        "mentionCount": len(matches),
        "matches": matches,
    }


def prune_cache(cache_reels: dict[str, Any], now: datetime) -> dict[str, Any]:
    cutoff = now - timedelta(days=CACHE_RETENTION_DAYS)
    kept = {}
    for identity, entry in cache_reels.items():
        published = parse_timestamp(entry.get("sourcePublishedAt")) if isinstance(entry, dict) else None
        if published and published >= cutoff:
            kept[identity] = entry
    return kept


def build_report(
    reels: Sequence[dict[str, Any]],
    results: dict[str, dict[str, Any]],
    failures: dict[str, str],
    account: str,
    target: str,
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    rows = []
    for item in reels:
        identity = reel_identity(item)
        common = {
            "id": identity,
            "shortCode": item.get("shortCode") or item.get("shortcode"),
            "url": reel_url(item),
            "thumbnailUrl": thumbnail_url(item),
            "captionSnippet": caption_snippet(item),
            "publishedAt": item["_publishedAt"],
        }
        if identity in results:
            result = results[identity]
            rows.append({
                **common,
                "status": "processed",
                "language": result.get("language"),
                "languageProbability": result.get("languageProbability"),
                "mentionCount": result["mentionCount"],
                "matches": result["matches"],
            })
        else:
            rows.append({
                **common,
                "status": "failed",
                "language": None,
                "languageProbability": None,
                "mentionCount": None,
                "matches": [],
                "error": failures.get(identity, "Processing failed"),
            })

    processed = [row for row in rows if row["status"] == "processed"]
    failed_count = len(rows) - len(processed)
    mentions = sum(row["mentionCount"] for row in processed)
    containing = sum(1 for row in processed if row["mentionCount"] > 0)
    status = "complete" if failed_count == 0 else "partial"
    if not rows:
        status = "complete-no-reels"
    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": status,
        "metric": "spoken-audio",
        "account": canonical_handle(account),
        "target": target,
        "windowDays": int((end - start).total_seconds() // 86400),
        "generatedAt": iso_z(end),
        "windowStart": iso_z(start),
        "windowEnd": iso_z(end),
        "totalReels": len(rows),
        "processedReels": len(processed),
        "failedReels": failed_count,
        "processingCoverage": round(len(processed) / len(rows), 4) if rows else 1,
        "reelsMentioningTarget": containing,
        "totalSpokenMentions": mentions,
        "mentionRate": round(containing / len(processed), 4) if processed else None,
        "method": {
            "collector": DEFAULT_ACTOR,
            "transcriber": f"faster-whisper/{os.environ.get('WHISPER_MODEL', DEFAULT_MODEL)}",
            "manualReview": False,
            "transcriptsPublished": False,
            "countUnit": "word-level matches after multilingual normalization",
        },
        "reels": rows,
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    now = parse_timestamp(args.as_of) if args.as_of else utc_now()
    if now is None:
        raise MentionCountError("--as-of must be a valid ISO timestamp")
    start = now - timedelta(days=args.window_days)
    token = os.environ.get("APIFY_TOKEN_MENTION_COUNT")
    if args.fixture:
        items = load_json(Path(args.fixture), [])
    else:
        if not token:
            raise MentionCountError(
                "APIFY_TOKEN_MENTION_COUNT is required. The existing APIFY_TOKEN is intentionally not reused."
            )
        items = fetch_apify_reels(token, args.account, args.window_days, args.actor)
    reels = select_recent_reels(items, args.account, start, now)

    cache_path = Path(args.cache)
    cache = load_json(cache_path, {"schemaVersion": SCHEMA_VERSION, "reels": {}})
    cache_reels = prune_cache(cache.get("reels", {}), now)
    results: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}
    pending: list[dict[str, Any]] = []
    for item in reels:
        identity = reel_identity(item)
        entry = cache_reels.get(identity)
        if cache_entry_valid(entry, item["_publishedAt"], args.target):
            results[identity] = entry
        else:
            pending.append(item)

    transcriber = None
    variants = variants_for(args.target, os.environ.get("MENTION_VARIANTS"))
    for item in pending:
        identity = reel_identity(item)
        try:
            if args.dry_run:
                raise MentionCountError("Dry run does not transcribe uncached media")
            transcriber = transcriber or LocalTranscriber(args.model)
            result = process_reel(item, transcriber, args.target, variants, now)
            cache_reels[identity] = result
            results[identity] = result
        except Exception as error:  # keep one bad CDN URL from hiding all other Reels
            failures[identity] = safe_failure(error)

    report = build_report(reels, results, failures, args.account, args.target, start, now)
    if reels and report["processedReels"] == 0:
        examples = "; ".join(failures.values()) or "no Reel could be processed"
        raise MentionCountError(f"All {len(reels)} recent Reels failed: {examples}")

    write_json_atomic(cache_path, {
        "schemaVersion": SCHEMA_VERSION,
        "updatedAt": iso_z(now),
        "retentionDays": CACHE_RETENTION_DAYS,
        "reels": cache_reels,
    })
    write_json_atomic(Path(args.output), report)
    return report


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--account", default=os.environ.get("INSTAGRAM_ACCOUNT", DEFAULT_ACCOUNT))
    result.add_argument("--target", default=os.environ.get("MENTION_TARGET", DEFAULT_TARGET))
    result.add_argument(
        "--window-days",
        type=int,
        default=int(os.environ.get("MENTION_WINDOW_DAYS", DEFAULT_WINDOW_DAYS)),
    )
    result.add_argument("--model", default=os.environ.get("WHISPER_MODEL", DEFAULT_MODEL))
    result.add_argument("--actor", default=os.environ.get("APIFY_REELS_ACTOR", DEFAULT_ACTOR))
    result.add_argument("--output", default=str(DEFAULT_OUTPUT))
    result.add_argument("--cache", default=str(DEFAULT_CACHE))
    result.add_argument("--fixture", help="Read Apify-shaped items from a local JSON fixture")
    result.add_argument("--as-of", help="Deterministic UTC timestamp for tests or replay")
    result.add_argument("--dry-run", action="store_true", help="Use cached results only")
    return result


def main() -> int:
    args = parser().parse_args()
    if args.window_days < 1 or args.window_days > 31:
        raise SystemExit("--window-days must be between 1 and 31")
    try:
        report = run(args)
    except MentionCountError as error:
        print(f"::error title=Reel mention count failed::{error}")
        return 2
    print(
        f"Counted {report['totalSpokenMentions']} spoken {report['target']} mention(s) "
        f"across {report['processedReels']}/{report['totalReels']} Reel(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
