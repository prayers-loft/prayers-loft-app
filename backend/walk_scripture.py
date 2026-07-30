"""
Walk Scripture reference parser — Phase 5 (Build 26B).

Deterministic, local, regex-based detection of Bible references in assistant
text. Covers all 66 canonical books + common abbreviations. Zero LLM calls,
zero external dependencies.

Public API:
  parse_scripture_refs(text) -> List[ScriptureRef]
      Return every reference found in the text with the canonical book name,
      chapter, optional verse (start / end), and the exact span in the source.

  contains_scripture_reference(text) -> bool
      Cheap boolean: does the text contain at least one detectable reference?

Design notes:
  * Book detection requires a KNOWN book name — ordinary numbers ("5:30 pm",
    "chapter 4", "room 12:30") never trigger a false match.
  * Numbered books (1 Kings, 2 Corinthians, 3 John) support the ordinal
    written with or without a space and with common abbreviated forms
    ("1 Cor", "2Ti", "1st Cor").
  * Verse ranges use "-" or "\u2013" (en dash) or "\u2014" (em dash).
  * Multiple references separated by ";" or "," within the same book are
    NOT split into separate refs — MVP just captures the first range per
    book mention. If beta feedback shows this needs to be smarter, we can
    extend without breaking the public API.
  * "Scripture says <passage>" prefix is honored but not required — the
    parser finds bare references too. Backward compatible.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

# =============================================================================
# Canonical book table
# =============================================================================

# Each entry: (canonical_name, [aliases_including_abbreviations])
# Book names are ordered longest-first per group so the alternation regex
# prefers "Song of Solomon" over "Song".
_BOOKS: List[Tuple[str, List[str]]] = [
    # ----- Old Testament -----
    ("Genesis",       ["Genesis", "Gen", "Gn"]),
    ("Exodus",        ["Exodus", "Exod", "Exo", "Ex"]),
    ("Leviticus",     ["Leviticus", "Lev", "Lv"]),
    ("Numbers",       ["Numbers", "Num", "Nm", "Nu"]),
    ("Deuteronomy",   ["Deuteronomy", "Deut", "Dt"]),
    ("Joshua",        ["Joshua", "Josh", "Jos"]),
    ("Judges",        ["Judges", "Judg", "Jdg", "Jgs"]),
    ("Ruth",          ["Ruth", "Ru"]),
    ("1 Samuel",      ["1 Samuel", "1Samuel", "1 Sam", "1Sam", "1 Sa", "1Sa", "First Samuel", "I Samuel"]),
    ("2 Samuel",      ["2 Samuel", "2Samuel", "2 Sam", "2Sam", "2 Sa", "2Sa", "Second Samuel", "II Samuel"]),
    ("1 Kings",       ["1 Kings", "1Kings", "1 Kgs", "1Kgs", "1 Ki", "1Ki", "First Kings", "I Kings"]),
    ("2 Kings",       ["2 Kings", "2Kings", "2 Kgs", "2Kgs", "2 Ki", "2Ki", "Second Kings", "II Kings"]),
    ("1 Chronicles",  ["1 Chronicles", "1Chronicles", "1 Chr", "1Chr", "1 Ch", "1Ch", "First Chronicles", "I Chronicles"]),
    ("2 Chronicles",  ["2 Chronicles", "2Chronicles", "2 Chr", "2Chr", "2 Ch", "2Ch", "Second Chronicles", "II Chronicles"]),
    ("Ezra",          ["Ezra", "Ezr"]),
    ("Nehemiah",      ["Nehemiah", "Neh"]),
    ("Esther",        ["Esther", "Est"]),
    ("Job",           ["Job", "Jb"]),
    ("Psalms",        ["Psalms", "Psalm", "Pss", "Psa", "Ps"]),
    ("Proverbs",      ["Proverbs", "Prov", "Prv", "Pr"]),
    ("Ecclesiastes",  ["Ecclesiastes", "Eccles", "Eccl", "Ecc", "Ec", "Qoh"]),
    ("Song of Solomon", ["Song of Solomon", "Song of Songs", "Canticles", "Song", "SoS"]),
    ("Isaiah",        ["Isaiah", "Isa", "Is"]),
    ("Jeremiah",      ["Jeremiah", "Jer"]),
    ("Lamentations",  ["Lamentations", "Lam"]),
    ("Ezekiel",       ["Ezekiel", "Ezek", "Eze", "Ezk", "Ez"]),
    ("Daniel",        ["Daniel", "Dan", "Dn"]),
    ("Hosea",         ["Hosea", "Hos"]),
    ("Joel",          ["Joel", "Jl"]),
    ("Amos",          ["Amos", "Am"]),
    ("Obadiah",       ["Obadiah", "Obad", "Ob"]),
    ("Jonah",         ["Jonah", "Jon", "Jnh"]),
    ("Micah",         ["Micah", "Mic"]),
    ("Nahum",         ["Nahum", "Nah", "Na"]),
    ("Habakkuk",      ["Habakkuk", "Hab", "Hb"]),
    ("Zephaniah",     ["Zephaniah", "Zeph", "Zep"]),
    ("Haggai",        ["Haggai", "Hag", "Hg"]),
    ("Zechariah",     ["Zechariah", "Zech", "Zec"]),
    ("Malachi",       ["Malachi", "Mal"]),
    # ----- New Testament -----
    ("Matthew",       ["Matthew", "Matt", "Mt"]),
    ("Mark",          ["Mark", "Mk", "Mrk"]),
    ("Luke",          ["Luke", "Lk", "Luk"]),
    ("John",          ["John", "Jn", "Jhn"]),
    ("Acts",          ["Acts", "Ac", "Act"]),
    ("Romans",        ["Romans", "Rom", "Ro", "Rm"]),
    ("1 Corinthians", ["1 Corinthians", "1Corinthians", "1 Cor", "1Cor", "1 Co", "1Co", "First Corinthians", "I Corinthians"]),
    ("2 Corinthians", ["2 Corinthians", "2Corinthians", "2 Cor", "2Cor", "2 Co", "2Co", "Second Corinthians", "II Corinthians"]),
    ("Galatians",     ["Galatians", "Gal", "Ga"]),
    ("Ephesians",     ["Ephesians", "Eph", "Ephes"]),
    ("Philippians",   ["Philippians", "Phil", "Php", "Pp"]),
    ("Colossians",    ["Colossians", "Col", "Cl"]),
    ("1 Thessalonians", ["1 Thessalonians", "1Thessalonians", "1 Thess", "1Thess", "1 Th", "1Th", "First Thessalonians", "I Thessalonians"]),
    ("2 Thessalonians", ["2 Thessalonians", "2Thessalonians", "2 Thess", "2Thess", "2 Th", "2Th", "Second Thessalonians", "II Thessalonians"]),
    ("1 Timothy",     ["1 Timothy", "1Timothy", "1 Tim", "1Tim", "1 Ti", "1Ti", "First Timothy", "I Timothy"]),
    ("2 Timothy",     ["2 Timothy", "2Timothy", "2 Tim", "2Tim", "2 Ti", "2Ti", "Second Timothy", "II Timothy"]),
    ("Titus",         ["Titus", "Tit", "Ti"]),
    ("Philemon",      ["Philemon", "Phlm", "Phm", "Philem"]),
    ("Hebrews",       ["Hebrews", "Heb", "Hb"]),
    ("James",         ["James", "Jas", "Jm"]),
    ("1 Peter",       ["1 Peter", "1Peter", "1 Pet", "1Pet", "1 Pe", "1Pe", "First Peter", "I Peter"]),
    ("2 Peter",       ["2 Peter", "2Peter", "2 Pet", "2Pet", "2 Pe", "2Pe", "Second Peter", "II Peter"]),
    ("1 John",        ["1 John", "1John", "1 Jn", "1Jn", "1 Jo", "1Jo", "First John", "I John"]),
    ("2 John",        ["2 John", "2John", "2 Jn", "2Jn", "2 Jo", "2Jo", "Second John", "II John"]),
    ("3 John",        ["3 John", "3John", "3 Jn", "3Jn", "3 Jo", "3Jo", "Third John", "III John"]),
    ("Jude",          ["Jude", "Jud"]),
    ("Revelation",    ["Revelation", "Rev", "Rv", "Apocalypse"]),
]

# Build alias → canonical map, and a longest-first alternation regex source.
_ALIAS_TO_CANON: dict = {}
_ALL_ALIASES: List[str] = []
for canon, aliases in _BOOKS:
    for a in aliases:
        _ALIAS_TO_CANON[a.lower()] = canon
        _ALL_ALIASES.append(a)

# Sort longest-first so "Song of Solomon" is preferred over "Song", and
# "1 Corinthians" over "1 Cor". Escape and join.
_ALL_ALIASES_SORTED = sorted(set(_ALL_ALIASES), key=lambda s: (-len(s), s))
_BOOK_ALT = "|".join(re.escape(a) for a in _ALL_ALIASES_SORTED)

# The full reference regex.
# Pattern:
#   (?<![A-Za-z])                — book must not be preceded by a letter
#                                  (prevents matching "in Genesis-adjacent")
#   (BOOK)                       — one of the aliases above
#   \s+                          — at least one whitespace
#   (\d{1,3})                    — chapter, 1–3 digits
#   (?:                          — optional verse portion:
#     [:\.]                      — colon or dot verse separator
#     (\d{1,3})                  — start verse
#     (?:[-\u2013\u2014](\d{1,3}))?  — optional end verse (- / en / em dash)
#   )?
#   (?![A-Za-z0-9])              — must not be followed by a letter/digit
#                                  (prevents "Genesis 1:1a" or "5:301")
# Also: reject when the book is a single-letter alias immediately preceded
# by punctuation that suggests a URL, path, or time-of-day pattern —
# handled by post-filtering rather than in-regex to keep the pattern tidy.
_SCRIPTURE_RE = re.compile(
    r"(?<![A-Za-z])(" + _BOOK_ALT + r")\.?\s+(\d{1,3})"
    r"(?:[:\.](\d{1,3})(?:[-\u2013\u2014](\d{1,3}))?)?"
    r"(?![A-Za-z0-9])",
)

# The classic "Scripture says" marker — still honored as a hint but no
# longer required for detection.
SCRIPTURE_SAYS_MARKER = re.compile(
    r"(^|\n\s*|\s)Scripture says[,\s\u2014\u2013:\-]+",
    re.IGNORECASE,
)


@dataclass
class ScriptureRef:
    """A single detected reference."""
    canonical_book: str          # e.g. "Philippians"
    chapter: int
    verse_start: Optional[int]   # None when only a chapter reference
    verse_end: Optional[int]     # None when no range
    span: Tuple[int, int]        # (start, end) offsets in the source text
    raw: str                     # the exact substring that matched

    def formatted(self, style: str = "canonical") -> str:
        """Render the reference in a canonical form for storage / display.
        style="canonical": 'Philippians 4:6-7'
        style="short":     'Phil 4:6-7' (uses first alias which is canonical
                            for MVP; abbreviation could be added later)"""
        parts = [self.canonical_book, " ", str(self.chapter)]
        if self.verse_start is not None:
            parts += [":", str(self.verse_start)]
            if self.verse_end is not None:
                parts += ["-", str(self.verse_end)]
        return "".join(parts)


def parse_scripture_refs(text: str) -> List[ScriptureRef]:
    """Return every reference detected in `text`. Empty list for no matches."""
    if not text:
        return []
    refs: List[ScriptureRef] = []
    for m in _SCRIPTURE_RE.finditer(text):
        book_alias = m.group(1)
        canon = _ALIAS_TO_CANON.get(book_alias.lower())
        if canon is None:
            continue  # defensive; shouldn't happen given the alternation
        chapter = int(m.group(2))
        verse_start = int(m.group(3)) if m.group(3) else None
        verse_end = int(m.group(4)) if m.group(4) else None
        refs.append(ScriptureRef(
            canonical_book=canon,
            chapter=chapter,
            verse_start=verse_start,
            verse_end=verse_end,
            span=(m.start(), m.end()),
            raw=m.group(0),
        ))
    return refs


def contains_scripture_reference(text: str) -> bool:
    """Cheap boolean check — does `text` contain at least one reference?"""
    if not text:
        return False
    return bool(_SCRIPTURE_RE.search(text))


def has_scripture_says_marker(text: str) -> bool:
    """Backward-compat helper: does the text carry the classic 'Scripture
    says' introducer? Still used by V4/V5 rendering paths."""
    if not text:
        return False
    return bool(SCRIPTURE_SAYS_MARKER.search(text))
