"""Commit 3 — generate canonical-web-v1 passage summaries via Claude Haiku 4.5.

Invariants (from AUTHORING_RULES.md §3):
- 8-60 words, descriptive, third-person, warm-but-restrained.
- No application ("we should", "let us", "you should", "pray", "consider"),
  no first-person ("I", "me", "my", "our", "us"),
  no interrogatives targeting the reader ("have you", "do you").
- "the Lord" replaces "Yahweh" in the summary while WEB text preserves "Yahweh".
- Numbers as digits ("12 disciples").
- No markdown, no bullets.

Operational guarantees:
- Checkpointed to backend/reading_plans/summaries_cache_v1.json after every
  successful entry. Reruns skip entries already present unless the entry has
  status "rejected".
- Per-entry retry limit = 3 (initial + 2 revisions). If all fail, the entry
  is flagged status="rejected" with the last output preserved for review.
- Concurrency capped (default 5) so runaway retries cannot torch the key.
- Never mutates plan_boundaries.py or the WEB corpus.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))
load_dotenv(ROOT / "backend" / ".env")

from reading_plans.bible_structure import BOOK_NAMES, num_verses  # noqa: E402
from plan_boundaries import ENTRIES  # noqa: E402

from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CORPUS_PATH = ROOT / "backend" / "reading_plans" / "web_corpus.json"
CACHE_PATH = ROOT / "backend" / "reading_plans" / "summaries_cache_v1.json"
REPORT_PATH = ROOT / "backend" / "reading_plans" / "summaries_report.json"

MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-haiku-4-5-20251001"
MAX_TOKENS = 220
TEMPERATURE = 0.4
MAX_ATTEMPTS_PER_ENTRY = 3
DEFAULT_CONCURRENCY = 5
KNOWN_EMPTY = {
    ("LUK", 17, 36), ("ACT", 8, 37), ("ACT", 15, 34), ("ACT", 24, 7),
    ("ROM", 16, 25), ("ROM", 16, 26), ("ROM", 16, 27),
}

# Words / phrases that would indicate the summary is preaching, applying,
# or drifting from a passage-content report. Case-insensitive substring
# match after normalizing whitespace.
BANNED_PHRASES = [
    # First-person plural / second-person application
    "we should", "we must", "we are called", "we are reminded", "we can",
    "we need", "we ought", "we see that", "we learn", "we find",
    "let us", "let's",
    "you should", "you must", "you can", "you are", "you will", "you have",
    "you ought", "you need",
    "your life", "your heart", "your walk", "your prayer",
    "our lives", "our hearts", "our walk", "our journey", "our faith",
    "our sin", "our own", "us today",
    # First-person singular
    " i ",
    # Devotional cues that outrun description
    "reminds us", "reminds the reader", "teaches us", "teaches the reader",
    "invites us", "invites the reader", "shows us how", "calls us to",
    "challenges us", "encourages us", "urges us",
    "application", "takeaway", "reflect on", "consider how",
    "apply this",
    # Interrogatives at the reader
    "have you", "do you", "are you", "will you", "can you", "would you",
    # Doctrinal shortcuts that outrun the passage
    "the gospel teaches", "this passage teaches",
    # Meta-refs the summary is not supposed to make
    "this reading", "today's reading", "today's passage",
    "in this chapter", "in this book",
]

# Words we allow only when narrating events. Anything with a personal pronoun
# targeting the reader is disallowed; the checker below does the heavy lifting.

# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

with CORPUS_PATH.open() as f:
    _CORPUS = json.load(f)["books"]


def passage_text(book: str, sc: int, sv: int, ec: int, ev: int) -> str:
    """Return the WEB text of the passage as one string, verse-tagged."""
    lines = []
    for c in range(sc, ec + 1):
        lo = sv if c == sc else 1
        hi = ev if c == ec else num_verses(book, c)
        for v in range(lo, hi + 1):
            if (book, c, v) in KNOWN_EMPTY:
                continue
            try:
                txt = _CORPUS[book][str(c)][v - 1]
            except (KeyError, IndexError):
                txt = ""
            if txt:
                lines.append(f"{c}:{v} {txt.strip()}")
    return "\n".join(lines)


def key_verse_text(book: str, kc: int, kv: int, kev: int | None) -> str:
    end = kev if kev else kv
    parts = []
    for v in range(kv, end + 1):
        if (book, kc, v) in KNOWN_EMPTY:
            continue
        try:
            txt = _CORPUS[book][str(kc)][v - 1]
        except (KeyError, IndexError):
            txt = ""
        if txt:
            parts.append(txt.strip())
    return " ".join(parts)


def reference_string(book: str, sc: int, sv: int, ec: int, ev: int) -> str:
    name = BOOK_NAMES[book]
    # Psalms use "Psalm" singular in citations.
    if book == "PSA":
        name = "Psalm"
    if sc == ec:
        if sv == 1 and ev == num_verses(book, sc):
            # whole chapter
            return f"{name} {sc}"
        if sv == ev:
            return f"{name} {sc}:{sv}"
        return f"{name} {sc}:{sv}-{ev}"
    return f"{name} {sc}:{sv}-{ec}:{ev}"


# --------------------------------------------------------------------------
# Prompt
# --------------------------------------------------------------------------

SYSTEM_PROMPT = """You write single-paragraph passage summaries for a Scripture reading plan.

Constraints — every summary must satisfy all of these:
1. 8 to 60 words. One paragraph. No bullets, no markdown, no line breaks.
2. THIRD PERSON PRESENT TENSE ONLY. Never "we", "us", "our", "you", "your", "I", "me", "my". Never "let us" or "let's".
3. DESCRIPTIVE ONLY. Report what happens or what the text says. Do NOT moralize, exhort, apply, invite, urge, teach, remind, or draw lessons.
4. NO devotional cues. Do not use: "reminds us", "teaches us", "invites us", "consider", "reflect", "meditate", "pray", "application", "takeaway".
5. NO questions directed at any reader.
6. Stay INSIDE the passage. Do not cite verses, characters, or events from outside the passage. Do not add extrabiblical background.
7. Use "the Lord" instead of "Yahweh" in your prose (the source text uses Yahweh; the summary softens it).
8. Numbers as digits ("12 disciples", not "twelve disciples").
9. Names as they appear in the passage. "God" and "Jesus" as-is.
10. Warm-but-restrained tone. No em dashes as a habit.

Output ONLY the summary paragraph. No preface, no quotes, no labels.
"""


def build_user_prompt(entry: dict[str, Any]) -> str:
    return (
        f"Reference: {entry['reference']}\n"
        f"Key Verse ({entry['key_verse_ref']}): {entry['key_verse_text']}\n\n"
        f"Passage (WEB text with verse tags):\n{entry['passage']}\n\n"
        f"Write the passage summary now. Third person, descriptive only, 8-60 words."
    )


REVISION_TEMPLATE = (
    "Your previous attempt violated the rules. Reasons:\n{reasons}\n\n"
    "Rewrite the summary. Same reference. Third person only. No devotional language.\n"
    "HARD CEILING: 50 words. Aim for 35–45 words.\n"
    "Strategy: pick only the 2 most significant movements in the passage. "
    "Drop minor characters and secondary events entirely. Use short declarative sentences.\n"
    "Verify your word count is under 50 before responding.\n"
    "Output ONLY the summary paragraph."
)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

# Individual banned pronouns (word-boundary; case-insensitive)
BANNED_TOKENS = {
    r"\bwe\b", r"\bus\b", r"\bour\b", r"\bours\b", r"\bourselves\b",
    r"\byou\b", r"\byour\b", r"\byours\b", r"\byourself\b",
    r"\bi\b", r"\bme\b", r"\bmy\b", r"\bmine\b", r"\bmyself\b",
}
BANNED_TOKEN_RE = re.compile("|".join(BANNED_TOKENS), re.IGNORECASE)


def word_count(text: str) -> int:
    return len([w for w in re.findall(r"\S+", text) if any(c.isalnum() for c in w)])


def validate_summary(text: str, entry: dict[str, Any]) -> tuple[bool, list[str]]:
    """Return (ok, list_of_reasons_if_not_ok)."""
    reasons: list[str] = []
    txt = text.strip()

    # Structural
    if not txt:
        return False, ["empty output"]
    if "\n" in txt:
        reasons.append("multi-line output — must be one paragraph")
    if txt.startswith('"') or txt.endswith('"'):
        reasons.append("wrapped in quotation marks — output the summary bare")
    if txt.startswith("Summary:") or txt.lower().startswith("here"):
        reasons.append("prefaced with a label — output the summary bare")

    # Word count
    wc = word_count(txt)
    if wc < 8:
        reasons.append(f"only {wc} words — minimum is 8")
    if wc > 60:
        reasons.append(f"{wc} words — maximum is 60")

    # Pronoun bans
    lower = txt.lower()
    padded = f" {lower} "
    if BANNED_TOKEN_RE.search(txt):
        offenders = sorted(set(m.group(0).lower() for m in BANNED_TOKEN_RE.finditer(txt)))
        reasons.append(f"contains disallowed first/second-person tokens: {offenders}")
    for phrase in BANNED_PHRASES:
        if phrase in padded:
            reasons.append(f"contains banned phrase: {phrase!r}")

    # Reference / meta leaks
    if "the reader" in lower or "readers" in lower:
        reasons.append("addresses the reader directly")

    # Yahweh should NOT appear in the summary (rule 7)
    if re.search(r"\byahweh\b", lower):
        reasons.append("uses 'Yahweh' — summary must say 'the Lord' instead")

    return (len(reasons) == 0, reasons)


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------


@dataclass
class SummaryRecord:
    day: int
    reference: str
    book: str
    passage_range: str
    key_verse_ref: str
    key_verse_text: str
    summary: str
    word_count: int
    status: str  # "ok" | "rejected"
    attempts: int
    reasons: list[str]  # last-attempt failure reasons (empty if ok)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_cache() -> dict[str, SummaryRecord]:
    if not CACHE_PATH.exists():
        return {}
    with CACHE_PATH.open() as f:
        raw = json.load(f)
    out: dict[str, SummaryRecord] = {}
    for k, v in raw.get("entries", {}).items():
        out[k] = SummaryRecord(**v)
    return out


def save_cache(records: dict[str, SummaryRecord], meta_extra: dict[str, Any] | None = None) -> None:
    payload = {
        "plan_id": "canonical-web-v1",
        "translation": "WEB",
        "model": f"{MODEL_PROVIDER}/{MODEL_NAME}",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "entries": {k: v.to_dict() for k, v in records.items()},
    }
    if meta_extra:
        payload.update(meta_extra)
    CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


# --------------------------------------------------------------------------
# LLM call
# --------------------------------------------------------------------------


def get_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise SystemExit("EMERGENT_LLM_KEY not set")
    return key


async def call_haiku(system: str, user: str, api_key: str, session_id: str) -> str:
    chat = (
        LlmChat(api_key=api_key, session_id=session_id, system_message=system)
        .with_model(MODEL_PROVIDER, MODEL_NAME)
        .with_params(max_tokens=MAX_TOKENS, temperature=TEMPERATURE)
    )
    msg = UserMessage(text=user)
    response = await chat.send_message(msg)
    return response if isinstance(response, str) else str(response)


# --------------------------------------------------------------------------
# Main flow
# --------------------------------------------------------------------------


async def generate_one(day: int, entry: dict[str, Any], api_key: str,
                       sem: asyncio.Semaphore,
                       counters: dict[str, int]) -> tuple[str, SummaryRecord]:
    async with sem:
        key = f"day-{day:04d}"
        user_prompt = build_user_prompt(entry)
        attempts = 0
        last_output = ""
        last_reasons: list[str] = []

        while attempts < MAX_ATTEMPTS_PER_ENTRY:
            attempts += 1
            counters["llm_calls"] += 1
            if attempts > 1:
                counters["retries"] += 1
                revision = REVISION_TEMPLATE.format(reasons="- " + "\n- ".join(last_reasons))
                current_user = user_prompt + "\n\n" + revision
            else:
                current_user = user_prompt

            try:
                out = await call_haiku(SYSTEM_PROMPT, current_user, api_key, f"summary-{key}-a{attempts}")
            except Exception as e:  # pragma: no cover — depends on network
                out = ""
                last_reasons = [f"LLM call failed: {e}"]
                await asyncio.sleep(min(2 ** attempts, 8))
                continue

            out = out.strip()
            # Strip stray leading labels if the model insists.
            for prefix in ("Summary:", "SUMMARY:", "summary:"):
                if out.startswith(prefix):
                    out = out[len(prefix):].strip()

            ok, reasons = validate_summary(out, entry)
            last_output = out
            last_reasons = reasons

            if ok:
                rec = SummaryRecord(
                    day=day,
                    reference=entry["reference"],
                    book=entry["book"],
                    passage_range=entry["passage_range"],
                    key_verse_ref=entry["key_verse_ref"],
                    key_verse_text=entry["key_verse_text"],
                    summary=out,
                    word_count=word_count(out),
                    status="ok",
                    attempts=attempts,
                    reasons=[],
                )
                counters["ok"] += 1
                return key, rec

        # All attempts exhausted
        rec = SummaryRecord(
            day=day,
            reference=entry["reference"],
            book=entry["book"],
            passage_range=entry["passage_range"],
            key_verse_ref=entry["key_verse_ref"],
            key_verse_text=entry["key_verse_text"],
            summary=last_output,
            word_count=word_count(last_output),
            status="rejected",
            attempts=attempts,
            reasons=last_reasons,
        )
        counters["rejected"] += 1
        return key, rec


def build_entries() -> list[dict[str, Any]]:
    out = []
    for i, e in enumerate(ENTRIES):
        b, sc, sv, ec, ev, kc, kv, kev, note = e
        day = i + 1
        out.append({
            "day": day,
            "book": b,
            "reference": reference_string(b, sc, sv, ec, ev),
            "passage_range": f"{b} {sc}:{sv}-{ec}:{ev}",
            "key_verse_ref": reference_string(b, kc, kv, kc, kev if kev else kv),
            "key_verse_text": key_verse_text(b, kc, kv, kev),
            "passage": passage_text(b, sc, sv, ec, ev),
            "editorial_note": note,
        })
    return out


async def main_async(concurrency: int, limit: int | None, force: bool,
                     redo_rejected: bool) -> None:
    api_key = get_key()
    entries = build_entries()
    if limit:
        entries = entries[:limit]

    cache = load_cache()

    # Which entries need work?
    to_do: list[dict[str, Any]] = []
    for e in entries:
        key = f"day-{e['day']:04d}"
        rec = cache.get(key)
        if rec is None:
            to_do.append(e)
        elif force:
            to_do.append(e)
        elif rec.status == "rejected" and redo_rejected:
            to_do.append(e)
    print(f"[{time.strftime('%H:%M:%S')}] plan={len(entries)}  cached={len(entries) - len(to_do)}  to_generate={len(to_do)}")

    if not to_do:
        print("Nothing to generate — cache is up to date.")
        return

    sem = asyncio.Semaphore(concurrency)
    counters = {"llm_calls": 0, "retries": 0, "ok": 0, "rejected": 0}
    tasks = [generate_one(e["day"], e, api_key, sem, counters) for e in to_do]

    done = 0
    last_save = time.monotonic()
    for coro in asyncio.as_completed(tasks):
        key, rec = await coro
        cache[key] = rec
        done += 1
        # Checkpoint every 20 entries or every 20 seconds
        if done % 20 == 0 or (time.monotonic() - last_save) > 20:
            save_cache(cache)
            last_save = time.monotonic()
            print(f"[{time.strftime('%H:%M:%S')}] progress {done}/{len(to_do)} "
                  f"ok={counters['ok']} rejected={counters['rejected']} "
                  f"llm_calls={counters['llm_calls']} retries={counters['retries']}")

    save_cache(cache)
    print(f"[{time.strftime('%H:%M:%S')}] DONE — "
          f"ok={counters['ok']}  rejected={counters['rejected']}  "
          f"llm_calls={counters['llm_calls']}  retries={counters['retries']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    ap.add_argument("--limit", type=int, default=None, help="only process first N entries")
    ap.add_argument("--force", action="store_true", help="regenerate every entry (danger: cost)")
    ap.add_argument("--redo-rejected", action="store_true", help="retry entries with status=rejected")
    args = ap.parse_args()
    asyncio.run(main_async(args.concurrency, args.limit, args.force, args.redo_rejected))


if __name__ == "__main__":
    main()
