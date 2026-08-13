import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.reel_mentions import (
    SpokenWord,
    build_report,
    count_words,
    parse_timestamp,
    select_recent_reels,
    variants_for,
)


NOW = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)


class ReelMentionTests(unittest.TestCase):
    def test_multilingual_and_latin_variants_are_counted(self):
        words = [
            SpokenWord(0.0, 0.4, "Kirpa"),
            SpokenWord(1.0, 1.4, "कृपा"),
            SpokenWord(2.0, 2.5, "ਕਿਰਪਾ"),
            SpokenWord(3.0, 3.4, "Kripa"),
            SpokenWord(4.0, 4.4, "Dubai"),
        ]
        matches = count_words(words, variants_for("Kirpa"))
        self.assertEqual(len(matches), 4)
        self.assertEqual([match["start"] for match in matches], [0.0, 1.0, 2.0, 3.0])

    def test_split_brand_name_is_joined_once(self):
        words = [SpokenWord(0.0, 0.2, "Kir"), SpokenWord(0.25, 0.5, "pa")]
        matches = count_words(words, variants_for("Kirpa"))
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["heardAs"], "Kir pa")

    def test_unrelated_words_are_not_fuzzy_matches(self):
        words = [
            SpokenWord(0.0, 0.2, "karma"),
            SpokenWord(0.3, 0.5, "clip"),
            SpokenWord(0.6, 0.8, "Dubai"),
        ]
        self.assertEqual(count_words(words, variants_for("Kirpa")), [])

    def test_exact_rolling_window_owner_and_duplicate_filters(self):
        inside = NOW - timedelta(days=6)
        too_old = NOW - timedelta(days=8)
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
        selected = select_recent_reels(items, "kirpa.properties", NOW - timedelta(days=7), NOW)
        self.assertEqual([row["id"] for row in selected], ["one"])
        self.assertTrue(selected[0]["videoUrl"].endswith("a.mp4"))

    def test_timestamps_accept_seconds_milliseconds_and_iso(self):
        expected = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(parse_timestamp(expected.timestamp()), expected)
        self.assertEqual(parse_timestamp(expected.timestamp() * 1000), expected)
        self.assertEqual(parse_timestamp("2026-08-12T12:00:00Z"), expected)

    def test_partial_report_never_turns_failed_reel_into_zero(self):
        reels = [
            {"id": "a", "shortCode": "A", "_publishedAt": "2026-08-12T10:00:00Z"},
            {"id": "b", "shortCode": "B", "_publishedAt": "2026-08-11T10:00:00Z"},
        ]
        results = {
            "a": {
                "language": "hi", "languageProbability": 0.9,
                "mentionCount": 2, "matches": [{"start": 1, "end": 2, "heardAs": "Kirpa"}],
            }
        }
        report = build_report(
            reels, results, {"b": "download failed"}, "kirpa.properties", "Kirpa",
            NOW - timedelta(days=7), NOW,
        )
        self.assertEqual(report["status"], "partial")
        self.assertEqual(report["totalSpokenMentions"], 2)
        self.assertEqual(report["failedReels"], 1)
        self.assertIsNone(report["reels"][1]["mentionCount"])


if __name__ == "__main__":
    unittest.main()
