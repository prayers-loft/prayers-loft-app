"""Commit 3 completion report — statistics, duplicate detection, samples.

Produces:
  - Console summary
  - backend/reading_plans/summaries_report.json (machine-readable)
"""
from __future__ import annotations

import json
import re
import statistics
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = ROOT / "backend" / "reading_plans" / "summaries_cache_v1.json"
REPORT_PATH = ROOT / "backend" / "reading_plans" / "summaries_report.json"

SECTIONS = {
    "Pentateuch": {"GEN", "EXO", "LEV", "NUM", "DEU"},
    "Historical": {"JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI",
                   "1CH", "2CH", "EZR", "NEH", "EST"},
    "Wisdom/Poetry": {"JOB", "PSA", "PRO", "ECC", "SNG"},
    "Major Prophets": {"ISA", "JER", "LAM", "EZK", "DAN"},
    "Minor Prophets": {"HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM",
                       "HAB", "ZEP", "HAG", "ZEC", "MAL"},
    "Gospels": {"MAT", "MRK", "LUK", "JHN"},
    "Acts": {"ACT"},
    "Epistles": {"ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH",
                 "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE",
                 "2PE", "1JN", "2JN", "3JN", "JUD"},
    "Revelation": {"REV"},
}


def section_of(book: str) -> str:
    for name, s in SECTIONS.items():
        if book in s:
            return name
    return "?"


def normalize_for_dupes(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", s.lower())).strip()


def duplicate_scan(records: list[dict]) -> list[dict]:
    """Detect near-duplicates via 5-gram signature intersection."""
    dupes: list[dict] = []
    signatures: dict[int, list[dict]] = defaultdict(list)
    for r in records:
        words = normalize_for_dupes(r["summary"]).split()
        for i in range(len(words) - 4):
            sig = hash(" ".join(words[i:i + 5]))
            signatures[sig].append(r)
    seen_pairs: set[tuple[int, int]] = set()
    for sig, items in signatures.items():
        if len(items) < 2:
            continue
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                key = (a["day"], b["day"])
                if key in seen_pairs or a["day"] == b["day"]:
                    continue
                seen_pairs.add(key)
                ratio = SequenceMatcher(None, a["summary"], b["summary"]).ratio()
                if ratio >= 0.55:
                    dupes.append({
                        "day_a": a["day"], "ref_a": a["reference"],
                        "day_b": b["day"], "ref_b": b["reference"],
                        "similarity": round(ratio, 3),
                    })
    dupes.sort(key=lambda d: -d["similarity"])
    return dupes[:40]


def cost_estimate(llm_calls: int, retries: int) -> dict[str, float]:
    """Rough estimate for Claude Haiku 4.5.
    Input pricing: ~$1 / M tokens, output ~$5 / M tokens.
    We assume ~900 input tokens / call and ~90 output tokens / successful call,
    plus ~90 output tokens per retry.
    """
    input_price_per_m = 1.00
    output_price_per_m = 5.00
    input_tokens = llm_calls * 900
    output_tokens = llm_calls * 90
    input_cost = input_tokens / 1_000_000 * input_price_per_m
    output_cost = output_tokens / 1_000_000 * output_price_per_m
    return {
        "assumed_input_tokens_per_call": 900,
        "assumed_output_tokens_per_call": 90,
        "input_tokens_total": input_tokens,
        "output_tokens_total": output_tokens,
        "input_cost_usd": round(input_cost, 4),
        "output_cost_usd": round(output_cost, 4),
        "total_estimated_cost_usd": round(input_cost + output_cost, 4),
    }


def find_meta_reference_flags(records: list[dict]) -> list[dict]:
    """Surface descriptive-but-borderline meta-references for user review."""
    pat = re.compile(r"\b(the passage|the text|the reading|the chapter|the book)\b",
                     re.IGNORECASE)
    hits = []
    for r in records:
        m = pat.search(r["summary"])
        if m:
            hits.append({
                "day": r["day"],
                "reference": r["reference"],
                "trigger": m.group(0).lower(),
                "summary": r["summary"],
            })
    return hits


def main() -> None:
    with CACHE_PATH.open() as f:
        cache = json.load(f)
    entries = list(cache["entries"].values())
    entries.sort(key=lambda v: v["day"])

    total = len(entries)
    ok = [v for v in entries if v["status"] == "ok"]
    rejected = [v for v in entries if v["status"] == "rejected"]
    attempts = [v["attempts"] for v in entries]
    llm_calls = sum(attempts)
    retries = sum(a - 1 for a in attempts)

    wcs = [v["word_count"] for v in ok]
    wc_stats = {
        "min": min(wcs), "max": max(wcs),
        "mean": round(statistics.mean(wcs), 1),
        "median": statistics.median(wcs),
        "stdev": round(statistics.stdev(wcs), 1),
        "under_20": sum(1 for w in wcs if w < 20),
        "20_to_40": sum(1 for w in wcs if 20 <= w <= 40),
        "41_to_55": sum(1 for w in wcs if 41 <= w <= 55),
        "56_to_60": sum(1 for w in wcs if 56 <= w <= 60),
    }

    # per section
    per_section: dict[str, dict] = {}
    for name in SECTIONS:
        section_entries = [v for v in ok if section_of(v["book"]) == name]
        if not section_entries:
            continue
        wcs_s = [v["word_count"] for v in section_entries]
        per_section[name] = {
            "days": len(section_entries),
            "mean_words": round(statistics.mean(wcs_s), 1),
            "median_words": statistics.median(wcs_s),
        }

    # duplicates
    dupes = duplicate_scan(ok)
    meta_flags = find_meta_reference_flags(ok)

    # representative samples (one per section)
    samples_by_section: dict[str, dict] = {}
    for name in SECTIONS:
        section_entries = [v for v in ok if section_of(v["book"]) == name]
        if section_entries:
            picked = section_entries[len(section_entries) // 2]
            samples_by_section[name] = {
                "day": picked["day"],
                "reference": picked["reference"],
                "key_verse_ref": picked["key_verse_ref"],
                "word_count": picked["word_count"],
                "summary": picked["summary"],
            }

    cost = cost_estimate(llm_calls, retries)

    # Attempt distribution
    attempt_hist = Counter(attempts)

    report = {
        "plan_id": cache.get("plan_id"),
        "model": cache.get("model"),
        "translation": cache.get("translation"),
        "generated_at_utc": cache.get("generated_at_utc"),
        "totals": {
            "planned_days": total,
            "summaries_generated_ok": len(ok),
            "summaries_rejected_final": len(rejected),
            "llm_calls_total": llm_calls,
            "retries_total": retries,
            "attempt_distribution": dict(sorted(attempt_hist.items())),
        },
        "cost_estimate": cost,
        "word_count_statistics": wc_stats,
        "per_section": per_section,
        "duplicate_pairs_detected": {
            "count": len(dupes),
            "threshold_similarity": 0.55,
            "pairs": dupes,
        },
        "manually_flagged_for_review": {
            "note": "These summaries are structurally valid (third person, correct length, no banned phrases) but use a meta-narrative phrase like 'the passage describes'. Common for genealogies and proverb collections where the text has no protagonist. Surfaced for your judgment.",
            "count": len(meta_flags),
            "entries": meta_flags,
        },
        "rejected_entries": [
            {
                "day": v["day"], "reference": v["reference"],
                "word_count": v["word_count"], "reasons": v["reasons"],
                "summary": v["summary"],
            }
            for v in rejected
        ],
        "representative_samples": samples_by_section,
    }

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    # Console
    print("=" * 72)
    print("Commit 3 — Summaries Generation Report")
    print("=" * 72)
    print(f"Plan: {cache.get('plan_id')}  ·  Model: {cache.get('model')}")
    print(f"Generated (UTC): {cache.get('generated_at_utc')}")
    print()
    print(f"Total days planned:              {total}")
    print(f"  OK summaries:                  {len(ok)}")
    print(f"  Rejected (flagged for review): {len(rejected)}")
    print()
    print(f"Total LLM calls:                 {llm_calls}")
    print(f"Total retries:                   {retries}")
    print(f"Attempt distribution:            {dict(sorted(attempt_hist.items()))}")
    print()
    print(f"Estimated cost (Haiku 4.5):      "
          f"${cost['total_estimated_cost_usd']}  "
          f"(input {cost['input_tokens_total']} tok · "
          f"output {cost['output_tokens_total']} tok)")
    print()
    print("Word-count statistics (OK summaries):")
    for k, v in wc_stats.items():
        print(f"  {k:12s} {v}")
    print()
    print("Per-section:")
    print(f"  {'section':16s} {'days':>4s}  {'mean_w':>6s}  {'med_w':>5s}")
    for name, s in per_section.items():
        print(f"  {name:16s} {s['days']:4d}  {s['mean_words']:6.1f}  {s['median_words']:5}")
    print()
    print(f"Duplicate/near-duplicate pairs (>=0.55 similarity): {len(dupes)}")
    for d in dupes[:6]:
        print(f"  {d['similarity']:.2f}  day {d['day_a']:>4d} '{d['ref_a']}' ~ "
              f"day {d['day_b']:>4d} '{d['ref_b']}'")
    print()
    print(f"Manually flagged for review (meta-reference phrases): {len(meta_flags)}")
    for f in meta_flags[:5]:
        print(f"  day {f['day']:>4d} · {f['reference']}  (trigger: {f['trigger']!r})")
    print()
    print("Representative samples (one per section):")
    for name, s in samples_by_section.items():
        print(f"  [{name}] Day {s['day']} · {s['reference']} · {s['word_count']}w")
        print(f"    {s['summary']}")
        print()
    print(f"Full report written to: {REPORT_PATH}")


if __name__ == "__main__":
    main()
