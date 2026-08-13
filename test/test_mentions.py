import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.reel_mentions import (
    SpokenWord,
    build_report,
    cache_entry_valid,
    count_words,
    match_quality_issue,
    parse_timestamp,
    select_recent_reels,
    variants_for,
)


NOW = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)


class ReelMentionTests(unittest.TestCase):
    def test_multilingual_and_latin_variants_are_counted(self):
        words = [
            SpokenWord(0.0, 0.4, "DAMAC"),
            SpokenWord(1.0, 1.4, "Damak"),
            SpokenWord(2.0, 2.5, "داماك"),
            SpokenWord(3.0, 3.4, "D-MAC"),
            SpokenWord(4.0, 4.4, "Dubai"),
        ]
        matches = count_words(words, variants_for("DAMAC"))
        self.assertEqual(len(matches), 4)
        self.assertEqual([match["start"] for match in matches], [0.0, 1.0, 2.0, 3.0])

    def test_split_brand_name_is_joined_once(self):
        words = [SpokenWord(0.0, 0.2, "Da"), SpokenWord(0.25, 0.5, "mac")]
        matches = count_words(words, variants_for("DAMAC"))
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["heardAs"], "Da mac")

    def test_unrelated_words_are_not_fuzzy_matches(self):
        words = [
            SpokenWord(0.0, 0.2, "damage"),
            SpokenWord(0.3, 0.5, "dramatic"),
            SpokenWord(0.6, 0.8, "Dubai"),
        ]
        self.assertEqual(count_words(words, variants_for("DAMAC")), [])

    def test_exact_rolling_window_owner_and_duplicate_filters(self):
        inside = NOW - timedelta(days=29)
        too_old = NOW - timedelta(days=31)
        items = [
            {
                "id": "one", "shortCode": "A", "ownerUsername": "kirpa.properties",
                "timestamp": inside.isoformat(), "type": "Video", "productType": "clips",
                "videoUrl": "https://cdn.example/a.mp4",
            },
            {
                "id": "one", "shortCode": "A", "ownerUsername": "kirpa.properties",
                "timestamp": inside.isoformat(), "type": "Video", "productType": "clips",
            },
            {
                "id": "old", "ownerUsername": "kirpa.properties",
                "timestamp": too_old.isoformat(), "type": "Video", "productType": "clips",
            },
            {
                "id": "foreign", "ownerUsername": "someone.else",
                "timestamp": inside.isoformat(), "type": "Video", "productType": "clips",
            },
        ]
        selected = select_recent_reels(items, "kirpa.properties", NOW - timedelta(days=30), NOW)
        self.assertEqual([row["id"] for row in selected], ["one"])
        self.assertTrue(selected[0]["videoUrl"].endswith("a.mp4"))

    def test_timestamps_accept_seconds_milliseconds_and_iso(self):
        expected = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(parse_timestamp(expected.timestamp()), expected)
        self.assertEqual(parse_timestamp(expected.timestamp() * 1000), expected)
        self.assertEqual(parse_timestamp("2026-08-12T12:00:00Z"), expected)

    def test_partial_report_never_turns_failed_reel_into_zero(self):
        reels = [
            {
                "id": "a", "shortCode": "A", "_publishedAt": "2026-08-12T10:00:00Z",
                "displayUrl": "https://cdn.example/a.jpg", "caption": "A DAMAC launch in Dubai",
            },
            {"id": "b", "shortCode": "B", "_publishedAt": "2026-08-11T10:00:00Z"},
        ]
        results = {
            "a": {
                "language": "hi", "languageProbability": 0.9,
                "mentionCount": 2, "matches": [{"start": 1, "end": 2, "heardAs": "DAMAC"}],
            }
        }
        report = build_report(
            reels, results, {"b": "download failed"}, "kirpa.properties", "DAMAC",
            NOW - timedelta(days=30), NOW,
        )
        self.assertEqual(report["status"], "partial")
        self.assertEqual(report["totalSpokenMentions"], 2)
        self.assertEqual(report["failedReels"], 1)
        self.assertIsNone(report["reels"][1]["mentionCount"])
        self.assertEqual(report["windowDays"], 30)
        self.assertEqual(report["reels"][0]["thumbnailUrl"], "https://cdn.example/a.jpg")
        self.assertEqual(report["reels"][0]["captionSnippet"], "A DAMAC launch in Dubai")

    def test_cache_is_isolated_by_target(self):
        entry = {
            "sourcePublishedAt": "2026-08-12T10:00:00Z",
            "targetKey": "kirpa",
            "transcriptionPromptVersion": 2,
            "mentionCount": 1,
            "matches": [{"start": 1, "end": 2, "heardAs": "Kirpa"}],
        }
        self.assertTrue(cache_entry_valid(entry, entry["sourcePublishedAt"], "Kirpa"))
        self.assertFalse(cache_entry_valid(entry, entry["sourcePublishedAt"], "DAMAC"))

    def test_legacy_positive_is_rechecked_but_legacy_zero_stays_cached(self):
        positive = {
            "sourcePublishedAt": "2026-08-12T10:00:00Z",
            "targetKey": "damac",
            "mentionCount": 1,
            "matches": [{"start": 49.56, "end": 49.92, "heardAs": "Damak"}],
        }
        zero = {**positive, "mentionCount": 0, "matches": []}
        self.assertFalse(cache_entry_valid(positive, positive["sourcePublishedAt"], "DAMAC"))
        self.assertTrue(cache_entry_valid(zero, zero["sourcePublishedAt"], "DAMAC"))

    def test_repeated_same_timestamp_is_flagged_as_asr_artifact(self):
        matches = [
            {"start": 10.46, "end": 10.46, "heardAs": "D-MAC"},
            {"start": 10.46, "end": 10.46, "heardAs": "D-MAC"},
            {"start": 10.47, "end": 10.47, "heardAs": "D-MAC"},
        ]
        self.assertIsNotNone(match_quality_issue(matches))
        entry = {
            "sourcePublishedAt": "2026-08-12T10:00:00Z",
            "targetKey": "damac",
            "mentionCount": len(matches),
            "matches": matches,
        }
        self.assertFalse(cache_entry_valid(entry, entry["sourcePublishedAt"], "DAMAC"))


if __name__ == "__main__":
    unittest.main()
