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
from src.developer_intelligence import (
    active_creators,
    build_report as build_developer_report,
    cache_entry_valid as developer_cache_entry_valid,
    developer_matches,
    due,
    incremental_lookback,
    normalized_dictionary,
    select_roster_reels,
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


class DeveloperIntelligenceTests(unittest.TestCase):
    def test_active_roster_uses_only_confirmed_kirpa_instagram_creators(self):
        roster = {
            "activePlatforms": ["instagram"],
            "employees": [
                {"name": "Included", "dashboardRelevant": True, "confirmed": True, "handles": {"instagram": "included.kirpa"}},
                {"name": "Kirpaa", "dashboardRelevant": True, "confirmed": True, "handles": {"instagram": "sales.kirpaa"}},
                {"name": "Unconfirmed", "dashboardRelevant": True, "confirmed": False, "handles": {"instagram": "no.kirpa"}},
                {"name": "Opted out", "dashboardRelevant": True, "confirmed": True, "optOut": True, "handles": {"instagram": "out.kirpa"}},
                {"name": "Other company", "dashboardRelevant": True, "confirmed": True, "handles": {"instagram": "person.other"}},
            ],
        }
        self.assertEqual(
            [row["handle"] for row in active_creators(roster)],
            ["included.kirpa", "sales.kirpaa"],
        )

    def test_one_word_stream_matches_every_configured_multilingual_developer(self):
        config = {
            "developers": [
                {"key": "damac", "name": "DAMAC", "variants": ["damak", "داماك"]},
                {"key": "emaar", "name": "Emaar", "variants": ["emaar properties", "إعمار"]},
            ]
        }
        developers = normalized_dictionary(config)
        words = [
            SpokenWord(0.0, 0.3, "DAMAK"),
            SpokenWord(1.0, 1.3, "Emaar"),
            SpokenWord(1.35, 1.7, "Properties"),
            SpokenWord(2.0, 2.4, "إعمار"),
        ]
        matches = {row["developerKey"]: row for row in developer_matches(words, developers)}
        self.assertEqual(matches["damac"]["mentionCount"], 1)
        self.assertEqual(matches["emaar"]["mentionCount"], 2)

    def test_cache_is_bound_to_owner_transcript_and_dictionary_versions(self):
        entry = {
            "sourcePublishedAt": "2026-08-12T10:00:00Z",
            "ownerHandle": "person.kirpa",
            "transcriptVersion": 1,
            "dictionaryVersion": "v1",
            "transcriptFingerprint": "abc123",
            "developerMatches": [],
        }
        self.assertTrue(developer_cache_entry_valid(entry, entry["sourcePublishedAt"], "person.kirpa", "v1"))
        self.assertFalse(developer_cache_entry_valid(entry, entry["sourcePublishedAt"], "other.kirpa", "v1"))
        self.assertFalse(developer_cache_entry_valid(entry, entry["sourcePublishedAt"], "person.kirpa", "v2"))

    def test_roster_collection_requires_attributable_owners_and_deduplicates(self):
        creators = [{"name": "Person", "handle": "person.kirpa"}]
        base = {
            "id": "one", "shortCode": "ONE", "ownerUsername": "person.kirpa",
            "timestamp": (NOW - timedelta(days=2)).isoformat(), "type": "Video", "productType": "clips",
        }
        selected, audit = select_roster_reels([base, dict(base)], creators, NOW - timedelta(days=30), NOW)
        self.assertEqual(len(selected), 1)
        self.assertEqual(audit["attributedItems"], 1)
        without_owner = {key: value for key, value in base.items() if key != "ownerUsername"}
        with self.assertRaisesRegex(Exception, "without a verifiable creator"):
            select_roster_reels([without_owner], creators, NOW - timedelta(days=30), NOW)

    def test_dictionary_change_forces_full_window_before_cached_rules_change(self):
        previous = {
            "schemaVersion": 3,
            "generatedAt": (NOW - timedelta(days=3)).isoformat(),
            "dictionaryVersion": "v1",
        }
        self.assertEqual(incremental_lookback(previous, NOW, "v1"), 5)
        self.assertEqual(incremental_lookback(previous, NOW, "v2"), 31)

    def test_partial_developer_report_retains_failures_as_unknown(self):
        creators = [{"name": "Person", "handle": "person.kirpa"}]
        reels = [
            {"id": "ok", "shortCode": "OK", "ownerUsername": "person.kirpa", "_ownerHandle": "person.kirpa", "_publishedAt": "2026-08-12T10:00:00Z"},
            {"id": "bad", "shortCode": "BAD", "ownerUsername": "person.kirpa", "_ownerHandle": "person.kirpa", "_publishedAt": "2026-08-11T10:00:00Z"},
        ]
        results = {
            "person.kirpa:ok": {
                "language": "en", "languageProbability": 0.95, "wordCount": 20,
                "developerMatches": [{"developerKey": "damac", "developer": "DAMAC", "mentionCount": 1, "matches": [{"start": 1.0, "end": 1.3, "heardAs": "DAMAC"}]}],
            }
        }
        report = build_developer_report(
            creators, reels, results, {"person.kirpa:bad": "download failed"}, [],
            {"dictionaryVersion": "v1", "matching": "exact", "developers": [{"key": "damac", "name": "DAMAC"}]},
            NOW - timedelta(days=30), NOW, {"runId": "run-1", "costUsd": 0.1}, "roster-v1",
        )
        self.assertEqual(report["status"], "partial")
        self.assertEqual(report["processedReels"], 1)
        self.assertEqual(report["failedReels"], 1)
        self.assertEqual(report["reelsWithDeveloperMention"], 1)
        self.assertIsNone(next(row for row in report["reels"] if row["id"] == "bad")["mentionCount"])
        self.assertEqual(report["creators"][0]["processingCoverage"], 0.5)

    def test_due_gate_waits_fourteen_days(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "developer.json"
            output.write_text(json.dumps({"generatedAt": NOW.isoformat()}), encoding="utf-8")
            self.assertFalse(due(output, NOW + timedelta(days=13, hours=23)))
            self.assertTrue(due(output, NOW + timedelta(days=14)))

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
