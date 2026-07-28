"""Second-pass rewrite for the 49 meta-referenced summaries.

Strategy:
  - Only re-process entries flagged with meta-language ("the passage",
    "the text", "the chapter", "the book", "the reading").
  - Use a stricter prompt that explicitly forbids those phrases.
  - Only replace the cached summary if the new one:
      (a) passes all existing validators, AND
      (b) contains no meta-reference phrases.
  - Otherwise leave the original summary intact (this respects the user's
    directive to leave passages unchanged if no natural wording exists).

Cost bound: max 3 LLM calls per flagged entry × 49 entries = 147 calls.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))
load_dotenv(ROOT / "backend" / ".env")

from generate_summaries import (  # noqa: E402
    build_entries, build_user_prompt, call_haiku, get_key,
    validate_summary, word_count, SummaryRecord, CACHE_PATH, save_cache,
)

META_PAT = re.compile(
    r"\b(the passage|the text|the reading|the chapter|the book)\b",
    re.IGNORECASE,
)

REWRITE_SYSTEM = """You write single-paragraph passage summaries for a Scripture reading plan.

Constraints — every summary must satisfy all of these:
1. 8 to 60 words. One paragraph. No bullets, no markdown.
2. THIRD PERSON PRESENT TENSE ONLY. Never "we", "us", "our", "you", "your", "I", "me", "my". Never "let us" or "let's".
3. DESCRIPTIVE ONLY. Report what happens or what the text says. Do NOT moralize, exhort, apply, or draw lessons.
4. NO devotional cues. Do not use: "reminds us", "teaches us", "invites us", "consider", "reflect", "meditate on", "pray", "application", "takeaway".
5. NO questions directed at any reader.
6. NEVER use the phrases: "the passage", "the text", "the reading", "the chapter", "the book". Do not refer to the reading itself. Describe its contents directly.
7. Stay INSIDE the passage. Do not cite verses, characters, or events from outside it.
8. Use "the Lord" instead of "Yahweh" in your prose.
9. Numbers as digits ("12 disciples").
10. Warm-but-restrained tone.

For proverb collections, name what the sayings address ("Sayings contrast the righteous and the wicked…").
For genealogies, name what is traced ("Descendants of Levi are traced through 3 sons…").
For law codes, name what is regulated ("Laws address unsolved murders, marriage after captivity, and disobedient sons…").
For psalms, name the psalm's speaker or subject ("David laments…", "The psalmist proclaims…").

Output ONLY the summary paragraph. No preface, no quotes, no labels.
"""

REWRITE_USER_HINT = (
    "\n\nIMPORTANT: The previous summary began with meta-language like "
    "'The passage describes…' or similar. Rewrite it to describe the actual "
    "contents directly (e.g., 'Sayings warn…', 'Descendants of Levi…', "
    "'David laments…', 'Paul argues…'). Do NOT use 'the passage', 'the text', "
    "'the chapter', 'the book', or 'the reading' anywhere in the output."
)


async def rewrite_one(day: int, entry_ctx: dict, current_summary: str,
                      api_key: str, sem: asyncio.Semaphore,
                      counters: dict) -> tuple[bool, str, list[str]]:
    """Return (accepted, new_summary_or_original, reasons_if_failed)."""
    async with sem:
        base = build_user_prompt(entry_ctx) + REWRITE_USER_HINT
        for attempt in range(3):
            counters["llm_calls"] += 1
            if attempt > 0:
                counters["retries"] += 1
            try:
                out = await call_haiku(REWRITE_SYSTEM, base, api_key,
                                       f"rewrite-{day}-a{attempt+1}")
            except Exception as e:
                await asyncio.sleep(min(2 ** attempt, 8))
                continue
            out = out.strip()
            for pref in ("Summary:", "SUMMARY:", "summary:"):
                if out.startswith(pref):
                    out = out[len(pref):].strip()
            ok, reasons = validate_summary(out, entry_ctx)
            if not ok:
                continue
            if META_PAT.search(out):
                reasons = ["still contains meta-reference"]
                continue
            return True, out, []
        return False, current_summary, reasons if 'reasons' in locals() else ["unknown"]


async def main_async() -> None:
    api_key = get_key()
    cache_data = json.loads(CACHE_PATH.read_text())
    all_entries = build_entries()
    entries_by_day = {e["day"]: e for e in all_entries}

    flagged_days = []
    for k, v in cache_data["entries"].items():
        if v["status"] == "ok" and META_PAT.search(v["summary"]):
            flagged_days.append(v["day"])
    flagged_days.sort()
    print(f"[{time.strftime('%H:%M:%S')}] flagged meta-reference entries: {len(flagged_days)}")

    sem = asyncio.Semaphore(4)
    counters = {"llm_calls": 0, "retries": 0}
    replaced = 0
    preserved = 0
    results: list[dict] = []

    async def worker(day: int):
        nonlocal replaced, preserved
        key = f"day-{day:04d}"
        old = cache_data["entries"][key]
        ctx = entries_by_day[day]
        accepted, new_text, reasons = await rewrite_one(
            day, ctx, old["summary"], api_key, sem, counters)
        if accepted:
            replaced += 1
            results.append({
                "day": day, "reference": old["reference"],
                "action": "replaced", "old": old["summary"], "new": new_text,
            })
            old["summary"] = new_text
            old["word_count"] = word_count(new_text)
            old["attempts"] = old["attempts"] + 1
        else:
            preserved += 1
            results.append({
                "day": day, "reference": old["reference"],
                "action": "preserved", "reason": "no natural rewrite available",
            })

    await asyncio.gather(*(worker(d) for d in flagged_days))

    # Save
    CACHE_PATH.write_text(json.dumps(cache_data, ensure_ascii=False, indent=2))

    print(f"[{time.strftime('%H:%M:%S')}] rewrite pass complete")
    print(f"  replaced:  {replaced}")
    print(f"  preserved: {preserved}")
    print(f"  llm_calls: {counters['llm_calls']}  retries: {counters['retries']}")

    log_path = ROOT / "backend" / "reading_plans" / "summaries_rewrite_log.json"
    log_path.write_text(json.dumps({
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "replaced_count": replaced,
        "preserved_count": preserved,
        "llm_calls": counters["llm_calls"],
        "retries": counters["retries"],
        "results": results,
    }, ensure_ascii=False, indent=2))
    print(f"  log:      {log_path}")


if __name__ == "__main__":
    asyncio.run(main_async())
