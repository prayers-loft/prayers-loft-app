"""Corpus integrity tests for backend/reading_plans/web_corpus.json.

Run:
    python scripts/test_web_corpus.py

These are deterministic sanity checks — they do NOT validate WEB text
against another source, they just prove that:
  1. The corpus file exists and loads as JSON.
  2. Its meta block matches expectations (translation, license, source).
  3. Every one of the 66 canonical books is present.
  4. Chapter counts and per-chapter verse counts match
     bible_structure.py (with 3JN=14 to match WEB's numbering).
  5. Every verse text is non-empty and contains no residual USFM markup.
  6. A small basket of well-known verses matches their expected WEB
     wording verbatim (spot-check against fabrication or corruption).

Exit code 0 if all checks pass, 1 if any fail.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from reading_plans.bible_structure import (  # noqa: E402
    BOOK_ORDER, VERSES_PER_CHAPTER, num_chapters, num_verses,
)

CORPUS_PATH = ROOT / "backend" / "reading_plans" / "web_corpus.json"

# 20 well-known WEB verses, exact wording per ebible.org release. These
# are the spot-check basket — if any of these drift, someone tampered
# with the corpus or the parser is stripping too aggressively.
SPOT_CHECKS = [
    ("GEN", 1, 1, "In the beginning, God created the heavens and the earth."),
    ("GEN", 1, 27, "God created man in his own image. In God\u2019s image he created him; male and female he created them."),
    ("GEN", 12, 1, "Now Yahweh said to Abram, \u201cLeave your country, and your relatives, and your father\u2019s house, and go to the land that I will show you."),
    ("EXO", 3, 14, "God said to Moses, \u201cI AM WHO I AM,\u201d and he said, \u201cYou shall tell the children of Israel this: \u2018I AM has sent me to you.\u2019\u201d"),
    ("DEU", 6, 4, "Hear, Israel: Yahweh is our God. Yahweh is one."),
    ("JOS", 1, 9, "Haven\u2019t I commanded you? Be strong and courageous. Don\u2019t be afraid. Don\u2019t be dismayed, for Yahweh your God is with you wherever you go.\u201d"),
    ("PSA", 1, 2, "but his delight is in Yahweh\u2019s law. On his law he meditates day and night."),
    ("PSA", 23, 1, "Yahweh is my shepherd; I shall lack nothing."),
    ("PRO", 3, 5, "Trust in Yahweh with all your heart, and don\u2019t lean on your own understanding."),
    ("ISA", 40, 31, "but those who wait for Yahweh will renew their strength. They will mount up with wings like eagles. They will run, and not be weary. They will walk, and not faint."),
    ("ISA", 53, 5, "But he was pierced for our transgressions. He was crushed for our iniquities. The punishment that brought our peace was on him; and by his wounds we are healed."),
    ("JER", 29, 11, "For I know the thoughts that I think toward you,\u201d says Yahweh, \u201cthoughts of peace, and not of evil, to give you hope and a future."),
    ("EZK", 36, 26, "I will also give you a new heart, and I will put a new spirit within you. I will take away the stony heart out of your flesh, and I will give you a heart of flesh."),
    ("MAT", 5, 8, "Blessed are the pure in heart, for they shall see God."),
    ("JHN", 1, 1, "In the beginning was the Word, and the Word was with God, and the Word was God."),
    ("JHN", 3, 16, "For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life."),
    ("JHN", 15, 5, "I am the vine. You are the branches. He who remains in me and I in him bears much fruit, for apart from me you can do nothing."),
    ("ROM", 8, 1, "There is therefore now no condemnation to those who are in Christ Jesus, who don\u2019t walk according to the flesh, but according to the Spirit."),
    ("1CO", 13, 13, "But now faith, hope, and love remain\u2014these three. The greatest of these is love."),
    ("REV", 22, 20, "He who testifies these things says, \u201cYes, I am coming soon.\u201d Amen! Yes, come, Lord Jesus!"),
]

# WEB legitimately omits these verses (they are absent from the earliest
# Greek manuscripts and are documented as such in critical editions).
# The importer preserves the verse-number slot but leaves the text empty.
KNOWN_WEB_OMISSIONS = {
    ("LUK", 17, 36),
    ("ACT", 8, 37),
    ("ACT", 15, 34),
    ("ACT", 24, 7),
    ("ROM", 16, 25),
    ("ROM", 16, 26),
    ("ROM", 16, 27),
}

# Any residual USFM sequence would look like a backslash followed by
# lowercase letters (e.g. "\v", "\nd*"). Should never appear in text.
BAD_MARKUP = re.compile(r"\\[a-z]+\*?")


def main() -> int:
    if not CORPUS_PATH.exists():
        print(f"FAIL — corpus not found at {CORPUS_PATH}")
        return 1

    doc = json.loads(CORPUS_PATH.read_text())
    meta = doc.get("meta", {})
    books = doc.get("books", {})

    failed = 0

    # Check 1: meta block
    def m_check(name, ok, detail=""):
        nonlocal failed
        print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail and not ok else ''}")
        if not ok:
            failed += 1

    print("[meta]")
    m_check("translation is WEB", meta.get("translation") == "WEB")
    m_check("license is Public Domain", meta.get("license") == "Public Domain")
    m_check("source is ebible.org", "ebible.org" in (meta.get("source") or ""))
    m_check("book_count == 66", meta.get("book_count") == 66,
            f"got {meta.get('book_count')}")
    m_check("verse_count > 31000", (meta.get("verse_count") or 0) > 31000,
            f"got {meta.get('verse_count')}")

    # Check 2: all 66 books present
    print("\n[books]")
    missing_books = [b for b in BOOK_ORDER if b not in books]
    m_check("all 66 canonical books present", not missing_books,
            f"missing {missing_books}")

    # Check 3: chapter + verse structure matches bible_structure.py
    print("\n[structure]")
    structure_errors = []
    for b in BOOK_ORDER:
        if b not in books:
            continue
        expected_chs = len(VERSES_PER_CHAPTER[b])
        actual_chs = len(books[b])
        if actual_chs != expected_chs:
            structure_errors.append(f"{b}: {actual_chs} chapters (expected {expected_chs})")
            continue
        for ch_num in range(1, expected_chs + 1):
            arr = books[b].get(str(ch_num))
            if arr is None:
                structure_errors.append(f"{b} {ch_num}: chapter missing")
                continue
            expected_vs = VERSES_PER_CHAPTER[b][ch_num - 1]
            if len(arr) != expected_vs:
                structure_errors.append(f"{b} {ch_num}: {len(arr)} verses (expected {expected_vs})")
    m_check("chapter + verse counts match canonical structure", not structure_errors,
            f"first mismatch: {structure_errors[0]}" if structure_errors else "")

    # Check 4: no residual USFM markup, no unexpected empty verses
    print("\n[integrity]")
    unexpected_empty = 0
    expected_empty_seen = 0
    markup_count = 0
    for b in BOOK_ORDER:
        for ch, arr in books.get(b, {}).items():
            for i, txt in enumerate(arr):
                v = i + 1
                if not txt.strip():
                    if (b, int(ch), v) in KNOWN_WEB_OMISSIONS:
                        expected_empty_seen += 1
                    else:
                        unexpected_empty += 1
                elif BAD_MARKUP.search(txt):
                    markup_count += 1
    m_check("no unexpected empty verses",
            unexpected_empty == 0,
            f"{unexpected_empty} unexpectedly empty")
    m_check("known WEB omissions accounted for",
            expected_empty_seen == len(KNOWN_WEB_OMISSIONS),
            f"expected {len(KNOWN_WEB_OMISSIONS)}, saw {expected_empty_seen}")
    m_check("no residual USFM markup", markup_count == 0,
            f"{markup_count} contaminated verses")

    # Check 5: spot-check known verses
    print("\n[spot-check]")
    for (b, ch, v, expected) in SPOT_CHECKS:
        actual = books.get(b, {}).get(str(ch), [""] * v)[v - 1] if v - 1 < len(books.get(b, {}).get(str(ch), [])) else ""
        ok = actual == expected
        label = f"{b} {ch}:{v}"
        if ok:
            print(f"  PASS  {label}")
        else:
            print(f"  FAIL  {label}")
            print(f"        expected: {expected!r}")
            print(f"        actual:   {actual!r}")
            failed += 1

    print()
    if failed:
        print(f"RESULT: FAIL ({failed} check(s) failed)")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
