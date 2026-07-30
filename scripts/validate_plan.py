"""Reading-plan validator.

Runs the six acceptance checks the product team asked for:

  1. Valid book, chapter, and verse ranges — every passage falls
     within canonical bounds (via bible_structure.py).
  2. Key Verse reference + location fields are self-consistent AND
     land inside their day's passage range.
  3. No missing or duplicated canonical passages (full-plan check;
     skipped for a sample file).
  4. Continuous Genesis-to-Revelation coverage (full-plan check).
  5. All 66 books represented (full-plan check).
  6. No passage assigned to more than one day unless the entry
     itself carries an intentional_repeat: true flag with a note.

Usage:
    python scripts/validate_plan.py backend/reading_plans/sample_review.json
    python scripts/validate_plan.py backend/reading_plans/canonical-web-v1.json

The sample file's `sections` shape is auto-flattened. A full-plan
file uses a top-level `days` array. Both work.

Exit code 0 = pass, 1 = at least one check failed. Coverage report
is always printed.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

# Allow running from repo root or from anywhere.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from reading_plans.bible_structure import (  # type: ignore
    BOOK_ORDER, BOOK_NAMES, VERSES_PER_CHAPTER,
    is_valid_range, is_valid_ref, num_chapters, num_verses,
    total_chapters, total_verses,
)


def load_entries(path: Path):
    """Return (entries, kind) where kind is 'sample' or 'full'.

    Sample files nest entries under sections{name: [...]}; full plan
    files just have a top-level days[] array. This normalizes both.
    """
    doc = json.loads(path.read_text())
    if "days" in doc and isinstance(doc["days"], list):
        return doc["days"], "full"
    if "sections" in doc:
        entries = []
        for name, section in doc["sections"].items():
            for e in section:
                # Tag the section origin for the coverage report.
                e = dict(e)
                e["_section"] = name
                entries.append(e)
        return entries, "sample"
    raise ValueError("Unrecognized plan file shape: no 'days' or 'sections' key")


def check_ranges(entries):
    """Check 1: passage ranges within canonical bounds."""
    problems = []
    for i, e in enumerate(entries):
        for p in e.get("passages", []):
            if not is_valid_range(p["book"], p["start_chapter"], p["start_verse"],
                                  p["end_chapter"], p["end_verse"]):
                problems.append((i, e.get("day"), p["reference"], "out-of-canonical-range"))
    return problems


def check_key_verse(entries):
    """Check 2: key_verse fields self-consistent and inside the passage."""
    problems = []
    for i, e in enumerate(entries):
        kv = e.get("key_verse")
        if not kv:
            problems.append((i, e.get("day"), "?", "missing-key-verse"))
            continue
        if not is_valid_ref(kv["book"], kv["chapter"], kv["verse_num"]):
            problems.append((i, e.get("day"), kv.get("reference", "?"), "kv-out-of-canonical"))
            continue
        # kv must land in at least one of the day's passage ranges.
        inside = False
        for p in e.get("passages", []):
            if kv["book"] != p["book"]:
                continue
            after_start = (kv["chapter"], kv["verse_num"]) >= (p["start_chapter"], p["start_verse"])
            before_end = (kv["chapter"], kv["verse_num"]) <= (p["end_chapter"], p["end_verse"])
            if after_start and before_end:
                inside = True
                break
        if not inside:
            problems.append((i, e.get("day"), kv.get("reference", "?"), "kv-outside-passage-range"))
        # Reference-string sanity: does "Genesis 12:2-3" start with the book name?
        ref = kv.get("reference", "")
        expected_prefix = f"{BOOK_NAMES[kv['book']]} {kv['chapter']}:"
        if not ref.startswith(expected_prefix):
            problems.append((i, e.get("day"), ref,
                             f"kv-reference-mismatch (expected prefix '{expected_prefix}')"))
    return problems


def _iter_covered_verses(entries):
    """Yield (book, chapter, verse) for every verse the plan covers.

    For a sample, entries covering non-first-14 days are still counted
    once, which is fine — sample coverage != full coverage.
    """
    for e in entries:
        for p in e.get("passages", []):
            b = p["book"]
            sc, sv = p["start_chapter"], p["start_verse"]
            ec, ev = p["end_chapter"], p["end_verse"]
            for ch in range(sc, ec + 1):
                start_v = sv if ch == sc else 1
                end_v = ev if ch == ec else num_verses(b, ch)
                for v in range(start_v, end_v + 1):
                    yield (b, ch, v)


def check_no_duplicate_verses(entries):
    """Check 6: no verse covered by two different days (unless marked)."""
    seen = {}
    problems = []
    for e in entries:
        day = e.get("day")
        if e.get("intentional_repeat"):
            continue
        for p in e.get("passages", []):
            b = p["book"]
            for ch in range(p["start_chapter"], p["end_chapter"] + 1):
                start_v = p["start_verse"] if ch == p["start_chapter"] else 1
                end_v = p["end_verse"] if ch == p["end_chapter"] else num_verses(b, ch)
                for v in range(start_v, end_v + 1):
                    key = (b, ch, v)
                    if key in seen:
                        problems.append((day, seen[key], f"{b} {ch}:{v}"))
                    else:
                        seen[key] = day
    return problems


def check_full_coverage(entries):
    """Checks 3 + 4 + 5 for a FULL plan file: every canonical verse
    covered exactly once, all 66 books present, no gaps in canonical
    order.

    Returns (missing_verses_by_book, missing_books).
    """
    covered = set(_iter_covered_verses(entries))
    missing_by_book = defaultdict(int)
    missing_books = []
    for book in BOOK_ORDER:
        book_missing = 0
        chapters = num_chapters(book)
        for ch in range(1, chapters + 1):
            for v in range(1, num_verses(book, ch) + 1):
                if (book, ch, v) not in covered:
                    book_missing += 1
        missing_by_book[book] = book_missing
        # A book with EVERY verse missing counts as "book not represented"
        book_verses_total = sum(VERSES_PER_CHAPTER[book])
        if book_missing == book_verses_total:
            missing_books.append(book)
    return missing_by_book, missing_books


def coverage_report(entries, kind):
    """Human-readable coverage summary."""
    covered = set(_iter_covered_verses(entries))
    book_coverage = defaultdict(int)
    for (b, _, _) in covered:
        book_coverage[b] += 1
    lines = []
    lines.append("=" * 72)
    lines.append(f"Coverage report ({kind})")
    lines.append("=" * 72)
    lines.append(f"Entries in file:          {len(entries)}")
    lines.append(f"Distinct verses covered:  {len(covered):>6} of {total_verses()} "
                 f"({100 * len(covered) / total_verses():.1f}%)")
    lines.append(f"Books touched:            {len(book_coverage):>6} of {len(BOOK_ORDER)}")
    lines.append("")
    lines.append("Per-book verse coverage (only books with any coverage shown):")
    for book in BOOK_ORDER:
        vcov = book_coverage.get(book, 0)
        vtot = sum(VERSES_PER_CHAPTER[book])
        if vcov == 0:
            continue
        pct = 100 * vcov / vtot
        lines.append(f"  {book}  {BOOK_NAMES[book]:<20s} {vcov:>5}/{vtot:<5}  {pct:5.1f}%")
    return "\n".join(lines)


def main(path_str: str) -> int:
    path = Path(path_str)
    entries, kind = load_entries(path)
    print(f"Validating {path.name} — {len(entries)} entries — kind={kind}\n")

    failed = 0

    p1 = check_ranges(entries)
    print(f"Check 1 (passage ranges canonical):        {'PASS' if not p1 else 'FAIL ('+str(len(p1))+')'}")
    for row in p1[:20]:
        print(f"  entry #{row[0]} day={row[1]} ref={row[2]} — {row[3]}")
    failed += bool(p1)

    p2 = check_key_verse(entries)
    print(f"Check 2 (key-verse consistency):           {'PASS' if not p2 else 'FAIL ('+str(len(p2))+')'}")
    for row in p2[:20]:
        print(f"  entry #{row[0]} day={row[1]} ref={row[2]} — {row[3]}")
    failed += bool(p2)

    p6 = check_no_duplicate_verses(entries)
    print(f"Check 6 (no duplicate verse coverage):     {'PASS' if not p6 else 'FAIL ('+str(len(p6))+')'}")
    for row in p6[:20]:
        print(f"  day={row[0]} previously seen on day={row[1]} at {row[2]}")
    failed += bool(p6)

    if kind == "full":
        missing_by_book, missing_books = check_full_coverage(entries)
        total_missing = sum(missing_by_book.values())
        print(f"Check 3+4 (no missing canonical verses):   "
              f"{'PASS' if total_missing == 0 else 'FAIL ('+str(total_missing)+' verses uncovered)'}")
        print(f"Check 5 (all 66 books represented):        "
              f"{'PASS' if not missing_books else 'FAIL (missing: '+', '.join(missing_books)+')'}")
        failed += (total_missing > 0) + bool(missing_books)
    else:
        print("Checks 3+4+5 (full-canonical coverage):    SKIPPED — sample file")

    print()
    print(coverage_report(entries, kind))
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: validate_plan.py <path-to-plan-json>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
