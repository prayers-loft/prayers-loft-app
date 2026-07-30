"""
Unit tests for Walk Scripture reference parser (Build 26B, Phase 5).

Coverage per the Phase 5 approval:
  - all 66 canonical book names
  - common abbreviations
  - numbered books (1/2/3)
  - verse ranges (hyphen and en-dash)
  - multiple references in one text
  - ordinary numbers (times, chapter counts) that must NOT trigger
  - "Scripture says" marker still honored (backward compatibility)

Run with:
    cd /app/backend && python -m pytest tests/test_walk_scripture.py -v
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from walk_scripture import (  # noqa: E402
    parse_scripture_refs,
    contains_scripture_reference,
    has_scripture_says_marker,
    _BOOKS,
)


# =============================================================================
# 1. All 66 books detectable with full canonical name
# =============================================================================
class TestAllCanonicalBooks:
    def test_all_66_books_present(self):
        # Sanity: the master table lists 66 books (39 OT + 27 NT).
        assert len(_BOOKS) == 66

    def test_every_canonical_book_matches_with_chapter(self):
        misses = []
        for canonical, _ in _BOOKS:
            text = f"See {canonical} 1"
            refs = parse_scripture_refs(text)
            if not refs or refs[0].canonical_book != canonical:
                misses.append(canonical)
        assert not misses, f"missed canonical books: {misses}"

    def test_every_canonical_book_matches_with_chapter_verse(self):
        misses = []
        for canonical, _ in _BOOKS:
            text = f"See {canonical} 1:1"
            refs = parse_scripture_refs(text)
            if (not refs or
                refs[0].canonical_book != canonical or
                refs[0].chapter != 1 or
                refs[0].verse_start != 1):
                misses.append(canonical)
        assert not misses, f"missed book+chap+verse for: {misses}"


# =============================================================================
# 2. Abbreviations
# =============================================================================
class TestAbbreviations:
    def test_common_abbreviations(self):
        cases = [
            ("Gen 1:1", "Genesis"),
            ("Ex 20:3", "Exodus"),
            ("Ps 23:1", "Psalms"),
            ("Psa 23", "Psalms"),
            ("Ps. 23:1", "Psalms"),        # dot separator
            ("Prov 3:5", "Proverbs"),
            ("Eccl 3:1", "Ecclesiastes"),
            ("Song 2:1", "Song of Solomon"),
            ("Isa 40:31", "Isaiah"),
            ("Mt 5:3", "Matthew"),
            ("Mk 12:30", "Mark"),
            ("Lk 15:20", "Luke"),
            ("Jn 3:16", "John"),
            ("Rom 8:28", "Romans"),
            ("Phil 4:6", "Philippians"),
            ("Php 4:6", "Philippians"),
            ("Rev 21:4", "Revelation"),
        ]
        for text, expected_book in cases:
            refs = parse_scripture_refs(text)
            assert refs, f"no match for: {text}"
            assert refs[0].canonical_book == expected_book, \
                f"{text} → {refs[0].canonical_book}, expected {expected_book}"


# =============================================================================
# 3. Numbered books (1/2/3 with variants)
# =============================================================================
class TestNumberedBooks:
    def test_numbered_books_full_name(self):
        cases = [
            ("1 Samuel 3:10", "1 Samuel"),
            ("2 Samuel 12:7", "2 Samuel"),
            ("1 Kings 19:12", "1 Kings"),
            ("2 Kings 6:16", "2 Kings"),
            ("1 Corinthians 13:4", "1 Corinthians"),
            ("2 Corinthians 5:17", "2 Corinthians"),
            ("1 Peter 5:7", "1 Peter"),
            ("2 Peter 3:9", "2 Peter"),
            ("1 John 4:19", "1 John"),
            ("2 John 1:6", "2 John"),
            ("3 John 1:4", "3 John"),
            ("1 Thessalonians 5:17", "1 Thessalonians"),
            ("2 Timothy 3:16", "2 Timothy"),
        ]
        for text, expected_book in cases:
            refs = parse_scripture_refs(text)
            assert refs, f"no match for: {text}"
            assert refs[0].canonical_book == expected_book, \
                f"{text} → {refs[0].canonical_book}, expected {expected_book}"

    def test_numbered_books_abbreviated(self):
        cases = [
            ("1 Cor 13:4", "1 Corinthians"),
            ("2Cor 5:17", "2 Corinthians"),  # no space
            ("1 Pe 5:7", "1 Peter"),
            ("2Pe 3:9", "2 Peter"),
            ("1 Jn 4:19", "1 John"),
            ("2Ti 3:16", "2 Timothy"),
            ("1 Ki 19", "1 Kings"),
        ]
        for text, expected_book in cases:
            refs = parse_scripture_refs(text)
            assert refs, f"no match for: {text}"
            assert refs[0].canonical_book == expected_book

    def test_roman_numeral_numbered_books(self):
        cases = [
            ("I Corinthians 13:4", "1 Corinthians"),
            ("II Peter 3:9", "2 Peter"),
            ("III John 1:4", "3 John"),
        ]
        for text, expected_book in cases:
            refs = parse_scripture_refs(text)
            assert refs, f"no match for: {text}"
            assert refs[0].canonical_book == expected_book


# =============================================================================
# 4. Verse ranges
# =============================================================================
class TestVerseRanges:
    def test_hyphen_verse_range(self):
        refs = parse_scripture_refs("Philippians 4:6-7")
        assert len(refs) == 1
        assert refs[0].canonical_book == "Philippians"
        assert refs[0].chapter == 4
        assert refs[0].verse_start == 6
        assert refs[0].verse_end == 7

    def test_en_dash_verse_range(self):
        refs = parse_scripture_refs("Philippians 4:6\u20137")
        assert len(refs) == 1
        assert refs[0].verse_start == 6
        assert refs[0].verse_end == 7

    def test_em_dash_verse_range(self):
        refs = parse_scripture_refs("Philippians 4:6\u20147")
        assert len(refs) == 1
        assert refs[0].verse_start == 6
        assert refs[0].verse_end == 7

    def test_no_verse_at_all(self):
        refs = parse_scripture_refs("read all of Romans 8")
        assert len(refs) == 1
        assert refs[0].chapter == 8
        assert refs[0].verse_start is None
        assert refs[0].verse_end is None

    def test_multi_digit_chapter_and_verse(self):
        refs = parse_scripture_refs("Psalm 119:105")
        assert refs[0].canonical_book == "Psalms"
        assert refs[0].chapter == 119
        assert refs[0].verse_start == 105


# =============================================================================
# 5. Multiple references in one text
# =============================================================================
class TestMultipleReferences:
    def test_two_refs_in_a_sentence(self):
        text = "Compare Romans 8:28 with James 1:2-4."
        refs = parse_scripture_refs(text)
        assert len(refs) == 2
        books = [r.canonical_book for r in refs]
        assert books == ["Romans", "James"]

    def test_three_refs_with_scripture_says_marker(self):
        text = (
            "Scripture says, Do not be anxious about anything "
            "(Philippians 4:6-7). Elsewhere we're told Cast all your anxiety "
            "on him (1 Peter 5:7). And in Isaiah 41:10 God says fear not."
        )
        refs = parse_scripture_refs(text)
        assert len(refs) == 3
        assert [r.canonical_book for r in refs] == [
            "Philippians", "1 Peter", "Isaiah"
        ]

    def test_same_book_multiple_chapters(self):
        text = "See Psalm 23 and also Psalm 1:1."
        refs = parse_scripture_refs(text)
        assert len(refs) == 2
        assert refs[0].chapter == 23
        assert refs[1].chapter == 1
        assert refs[1].verse_start == 1


# =============================================================================
# 6. False-positive guards — ordinary numbers must NOT match
# =============================================================================
class TestFalsePositives:
    def test_time_of_day_does_not_match(self):
        # "5:30 pm" without any book prefix is not a reference.
        refs = parse_scripture_refs("Let's meet at 5:30 pm.")
        assert refs == []

    def test_bare_chapter_reference_does_not_match(self):
        refs = parse_scripture_refs("Read chapter 4 tonight.")
        assert refs == []

    def test_room_number_does_not_match(self):
        refs = parse_scripture_refs("Meet me in Room 12:30.")
        assert refs == []

    def test_random_colon_number_does_not_match(self):
        refs = parse_scripture_refs("Score was 3:1 at half-time.")
        assert refs == []

    def test_word_that_starts_with_book_alias_does_not_match(self):
        # 'John' followed by no space and letters is not a reference.
        refs = parse_scripture_refs("Johnson said the meeting starts at 4:30.")
        assert refs == []

    def test_number_immediately_after_verse_is_not_swallowed(self):
        # "Genesis 1:11" is a real reference (verse 11). "Genesis 1:1a" is
        # NOT — we reject a letter/digit immediately following.
        refs = parse_scripture_refs("Genesis 1:1 says the beginning")
        assert len(refs) == 1
        assert refs[0].verse_start == 1
        # Confirm 1:11 is fine (real chap/verse).
        refs = parse_scripture_refs("Genesis 1:11")
        assert refs[0].verse_start == 11

    def test_book_followed_by_letter_not_a_reference(self):
        # "Amos in the OT" — Amos is a book name but no chapter follows.
        refs = parse_scripture_refs("Amos in the OT wrote about justice.")
        assert refs == []

    def test_url_like_number_does_not_match(self):
        refs = parse_scripture_refs("visit http://example.com/path/12:30/detail")
        assert refs == []


# =============================================================================
# 7. Backward compatibility — "Scripture says" marker still honored
# =============================================================================
class TestScriptureSaysMarker:
    def test_marker_still_detectable(self):
        assert has_scripture_says_marker("Scripture says, do not fear.")
        assert has_scripture_says_marker(
            "One line stayed with me. Scripture says, come to me..."
        )
        assert not has_scripture_says_marker("She said, do not fear.")

    def test_marker_and_bare_ref_coexist(self):
        # A text using the marker AND a bare reference should still yield
        # a bare-reference parse (both signals available to the renderer).
        text = "Scripture says peace is a gift (Philippians 4:7)."
        assert has_scripture_says_marker(text)
        refs = parse_scripture_refs(text)
        assert len(refs) == 1
        assert refs[0].canonical_book == "Philippians"


# =============================================================================
# 8. Formatted output for storage / display
# =============================================================================
class TestFormattedOutput:
    def test_canonical_formatted_chapter_verse_range(self):
        refs = parse_scripture_refs("Phil 4:6-7")
        assert refs[0].formatted() == "Philippians 4:6-7"

    def test_canonical_formatted_chapter_only(self):
        refs = parse_scripture_refs("Romans 8")
        assert refs[0].formatted() == "Romans 8"

    def test_canonical_formatted_single_verse(self):
        refs = parse_scripture_refs("Jn 3:16")
        assert refs[0].formatted() == "John 3:16"


# =============================================================================
# 9. contains_scripture_reference() — quick boolean check
# =============================================================================
class TestContainsReference:
    def test_positive(self):
        assert contains_scripture_reference("Read Ps 23 tonight.")

    def test_negative(self):
        assert not contains_scripture_reference(
            "This is just a normal message with no verse."
        )

    def test_empty(self):
        assert not contains_scripture_reference("")
        assert not contains_scripture_reference(None)  # type: ignore[arg-type]

    def test_negative_time_of_day(self):
        assert not contains_scripture_reference("meet at 5:30")
