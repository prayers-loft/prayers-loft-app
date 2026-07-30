"""Section-aware validator for scripts/plan_boundaries.py (Commits 2a-2e).

Runs the same rules as scripts/validate_plan.py but against the
in-progress ENTRIES list, and against the WEB corpus for key-verse
existence. Reports gaps/overlaps/lengths for whichever books are
represented, per biblical section.
"""
from __future__ import annotations
import json, sys, statistics
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from reading_plans.bible_structure import (  # noqa
    BOOK_ORDER, BOOK_NAMES, VERSES_PER_CHAPTER, num_verses, is_valid_range, is_valid_ref,
)
from plan_boundaries import ENTRIES  # noqa

CORPUS = json.loads((ROOT / "backend/reading_plans/web_corpus.json").read_text())["books"]
KNOWN_EMPTY = {("LUK",17,36),("ACT",8,37),("ACT",15,34),("ACT",24,7),
               ("ROM",16,25),("ROM",16,26),("ROM",16,27)}

SECTIONS = {
    "Pentateuch":       ["GEN","EXO","LEV","NUM","DEU"],
    "Historical Books": ["JOS","JDG","RUT","1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST"],
    "Wisdom/Poetry":    ["JOB","PSA","PRO","ECC","SNG"],
    "Major Prophets":   ["ISA","JER","LAM","EZK","DAN"],
    "Minor Prophets":   ["HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL"],
    "Gospels":          ["MAT","MRK","LUK","JHN"],
    "Acts":             ["ACT"],
    "Epistles":         ["ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD"],
    "Revelation":       ["REV"],
}
BOOK_TO_SECTION = {b: s for s, bs in SECTIONS.items() for b in bs}

def verse_count(book, sc, sv, ec, ev):
    if sc == ec:
        return ev - sv + 1
    n = num_verses(book, sc) - sv + 1
    for c in range(sc+1, ec):
        n += num_verses(book, c)
    n += ev
    return n

def iter_verses(book, sc, sv, ec, ev):
    for c in range(sc, ec+1):
        lo = sv if c == sc else 1
        hi = ev if c == ec else num_verses(book, c)
        for v in range(lo, hi+1):
            yield (book, c, v)

def main():
    problems, notes, lengths, per_book, per_section = [], [], [], defaultdict(int), defaultdict(int)
    seen_verses, days_per_book = {}, defaultdict(int)
    books_touched = set()
    for i, e in enumerate(ENTRIES):
        b, sc, sv, ec, ev, kc, kv, kev, note = e
        # Check 1: valid range
        if not is_valid_range(b, sc, sv, ec, ev):
            problems.append(f"entry #{i} {b} {sc}:{sv}-{ec}:{ev} out of canonical range")
            continue
        # Check 2: key verse valid + inside passage
        if not is_valid_ref(b, kc, kv):
            problems.append(f"entry #{i} {b} kv {kc}:{kv} out of canonical")
        elif not ((sc, sv) <= (kc, kv) <= (ec, ev)):
            problems.append(f"entry #{i} {b} kv {kc}:{kv} outside passage")
        # Check 2b: key-verse text exists in WEB (unless known omission)
        kv_txt = CORPUS.get(b, {}).get(str(kc), [""] * kv)[kv-1] if (kv-1) < len(CORPUS.get(b,{}).get(str(kc),[])) else ""
        if not kv_txt.strip() and (b, kc, kv) not in KNOWN_EMPTY:
            problems.append(f"entry #{i} {b} {kc}:{kv} key-verse text missing from corpus")
        # Check 6: no duplicate verses
        for v in iter_verses(b, sc, sv, ec, ev):
            if v in seen_verses:
                problems.append(f"duplicate {v} in entry #{i} (also in #{seen_verses[v]})")
            seen_verses[v] = i
        # Stats
        n = verse_count(b, sc, sv, ec, ev)
        lengths.append((i, b, sc, sv, ec, ev, n))
        per_book[b] += 1
        per_section[BOOK_TO_SECTION[b]] += 1
        days_per_book[b] += 1
        books_touched.add(b)
        if note:
            notes.append((i+1, f"{b} {sc}:{sv}-{ec}:{ev}", note))
        # Unusually long
        if n > 60:
            notes.append((i+1, f"{b} {sc}:{sv}-{ec}:{ev}", f"LONG READING ({n} verses)"))

    # Report
    print(f"=== ENTRIES: {len(ENTRIES)} ===")
    print(f"Books touched: {len(books_touched)}: {sorted(books_touched, key=BOOK_ORDER.index)}")
    print(f"\nPer-section day count:")
    for s in SECTIONS:
        if per_section[s]:
            print(f"  {s:20s} {per_section[s]:>3d}")
    print(f"\nPer-book day count:")
    for b in BOOK_ORDER:
        if per_book[b]:
            print(f"  {b:>4s} {BOOK_NAMES[b]:<20s} {per_book[b]:>3d} days")

    if lengths:
        ns = [x[6] for x in lengths]
        shortest = min(lengths, key=lambda x: x[6])
        longest = max(lengths, key=lambda x: x[6])
        print(f"\nReading length: mean={statistics.mean(ns):.1f}  median={statistics.median(ns):.1f}  "
              f"min={min(ns)} ({shortest[1]} {shortest[2]}:{shortest[3]}-{shortest[4]}:{shortest[5]})  "
              f"max={max(ns)} ({longest[1]} {longest[2]}:{longest[3]}-{longest[4]}:{longest[5]})")

    # Coverage check for touched books
    print(f"\nCoverage check for touched books:")
    for b in sorted(books_touched, key=BOOK_ORDER.index):
        missing = 0
        for c in range(1, len(VERSES_PER_CHAPTER[b])+1):
            for v in range(1, num_verses(b, c)+1):
                if (b, c, v) not in seen_verses:
                    missing += 1
        total = sum(VERSES_PER_CHAPTER[b])
        status = "COMPLETE" if missing == 0 else f"missing {missing}"
        print(f"  {b} {BOOK_NAMES[b]:<20s} {total-missing:>5d}/{total:<5d} {status}")

    print(f"\nEditorial notes ({len([n for n in notes if 'LONG' not in n[2]])}):")
    for row in notes:
        if "LONG" not in row[2]:
            print(f"  day {row[0]:>3d} {row[1]:<25s} {row[2]}")
    print(f"\nUnusually long readings ({len([n for n in notes if 'LONG' in n[2]])}):")
    for row in notes:
        if "LONG" in row[2]:
            print(f"  day {row[0]:>3d} {row[1]:<25s} {row[2]}")

    print(f"\nProblems ({len(problems)}):")
    for p in problems[:30]:
        print(f"  {p}")
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main())
