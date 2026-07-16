"""Conversation Quality Sprint V3 — scenario evaluator.

Runs the current SYSTEM_PROMPT against a battery of realistic first-message
scenarios and prints a compact transcript + per-response metrics that
correspond to the V3 checklist:

  - concise?           (word count)
  - avoids over-questioning?   (question count)
  - avoids unsupported certainty?   (banned phrases)
  - teaches meaningfully?   (soft observation openers)
  - transcript-callback free?   (banned "you said" phrases)
  - marriage/absent-party safeguard applied?   (only for those scenarios)

The evaluator is deliberately mechanical — it flags patterns you can
eyeball fast. Final judgement remains yours.

Usage:
    python /app/backend/scripts/eval_walk_scenarios_v3.py > /tmp/walk-scenarios-v3.md
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
import litellm
from emergentintegrations.llm.chat import get_integration_proxy_url

load_dotenv(dotenv_path="/app/backend/.env")

# Import prompt straight from walk.py so we always test the shipping version.
from walk import SYSTEM_PROMPT, WALK_MODEL  # noqa: E402


# -----------------------------------------------------------------------------
# Scenarios — realistic first messages spanning the V3 test matrix.
# -----------------------------------------------------------------------------
SCENARIOS: List[Tuple[str, str]] = [
    (
        "sexual_temptation",
        "I've been fighting hard against looking at porn again, and tonight I feel it coming back. My wife's out of town and I don't know what to do.",
    ),
    (
        "pornography_relapse",
        "I fell again last night. Twice this week. I promised myself I was done and I keep failing.",
    ),
    (
        "marital_intimacy_conflict",
        "My wife hasn't wanted to be intimate with me for months. I feel unwanted and honestly it's making me angry.",
    ),
    (
        "unanswered_prayer",
        "I've been praying for my dad's healing for two years. Tests came back yesterday and it's worse. I don't know if God even hears me anymore.",
    ),
    (
        "anger",
        "I lost it with my son again. He's ten. He didn't do anything that bad and I screamed at him. Now he's scared of me.",
    ),
    (
        "anxiety",
        "I can't sleep. My mind won't stop looping about work, money, my kids, everything. I know Philippians 4 says don't be anxious but I feel like I'm drowning.",
    ),
    (
        "shame",
        "I don't think God could love me if He knew what I really do when no one is watching. I feel like a fraud at church.",
    ),
    (
        "grief",
        "My mom died six weeks ago. Everyone stopped calling. I still cry every morning and I don't know if that's normal.",
    ),
    (
        "spiritual_dryness",
        "I read my Bible and it feels like nothing. I pray and it feels like the ceiling. Six months of this. I'm starting to wonder if I ever really knew God.",
    ),
    (
        "celebration",
        "I need to tell someone — I've been sober from drinking for a full year today. I never thought I'd get here.",
    ),
    (
        "doubt",
        "I've been reading arguments against Christianity and honestly some of them are hard to answer. I don't want to lose my faith but I feel it slipping.",
    ),
    (
        "forgiveness",
        "My brother stole from our parents years ago and never apologized. Mom's dying and she keeps asking me to forgive him. I don't know how.",
    ),
    (
        "addiction",
        "I've been using pills for about a year and now I can't stop. I've hidden it from everyone. I know I need help but I'm terrified of what people will think.",
    ),
    (
        "loneliness",
        "I go to church every week but I feel completely invisible. I have no real friends. It's been years and I don't know how to change it.",
    ),
]


# -----------------------------------------------------------------------------
# Heuristics
# -----------------------------------------------------------------------------
BANNED_CERTAINTY = (
    r"the real issue is",
    r"the only way through",
    r"this is what'?s happening",
    r"what you actually need",
    r"you clearly (?:need|want|feel)",
    r"obviously,?\s",
)

BANNED_ABSENT_PARTY = (
    r"your wife doesn'?t understand you",
    r"she makes you feel",
    r"he clearly doesn'?t respect",
    r"your spouse (?:isn'?t|is not) (?:seeing|hearing|honoring)",
)

TRANSCRIPT_CALLBACKS = (
    # Real transcript-style callbacks require an actual summarizing clause
    # after the verb. Bare "you said that out loud", "you told me" (as a
    # bare acknowledgement), and demonstratives are NOT callbacks.
    # We only fire when the verb is followed by a subject pronoun or the
    # continuation is clearly a paraphrase of prior content.
    r"you said (?:you\b|how\b|i\b|we\b|there\b|about (?:the|your|his|her))",
    r"you mentioned (?:you\b|how\b|i\b|we\b|there\b|that (?:you|i|we|he|she|the|your))",
    r"you told me (?:you\b|how\b|i\b|we\b|there\b|that (?:you|i|we|he|she|the|your))",
    r"earlier you shared",
    r"last time you said",
    r"previously you told",
    r"as you shared earlier",
)

SOFT_TEACH_MARKERS = (
    # Ceremonial soft-observation openers.
    "one thing stands out",
    "i've noticed",
    "i'm wondering",
    "can i share",
    "something i've seen",
    "one possibility",
    "it seems",
    "i may be missing",
    # Meaning-teach markers — a reply that names a truth/principle/pattern
    # counts as teaching even without a soft opener.
    "the saints called",
    "the gospel is",
    "grace",
    "isn't the opposite of",
    "sometimes there's a pattern",
    "not because",
    "one of the hardest",
    "here's what i want you to hear",
    "here's what",
    "faith grows",
    "it usually means",
    "sanctification",
    "temptation often",
    "this doesn't mean",
    "that doesn't make you",
)

MARRIAGE_SAFEGUARD_MARKERS = (
    "i can only hear one side",
    "i don't want to assume",
    "i also don't want to assume",
    "i'm only hearing one side",
    "without hearing from",
    "i can't diagnose",
    "i want to be careful not to diagnose",
    "not to assume what your wife",
    "not to assume what your husband",
    "her experience",
    "his experience",
)


def _count_paragraphs(text: str) -> int:
    return len([p for p in re.split(r"\n\s*\n", text.strip()) if p.strip()])


def _count_questions(text: str) -> int:
    return text.count("?")


def _count_words(text: str) -> int:
    return len(re.findall(r"\S+", text))


def _matches(text: str, patterns) -> List[str]:
    lower = text.lower()
    return [p for p in patterns if re.search(p, lower)]


def _has_any(text: str, needles) -> List[str]:
    lower = text.lower()
    return [n for n in needles if n in lower]


# -----------------------------------------------------------------------------
# Runner
# -----------------------------------------------------------------------------
async def one_shot(user_msg: str) -> str:
    """Send a single user turn and return the assistant reply."""
    api_key = os.environ["EMERGENT_LLM_KEY"]
    params = {
        "model": WALK_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "api_key": api_key,
        "temperature": 0.75,
        "max_tokens": 800,
    }
    if api_key.startswith("sk-emergent-"):
        proxy = get_integration_proxy_url()
        params["api_base"] = proxy + "/llm"
        params["custom_llm_provider"] = "openai"
    resp = await litellm.acompletion(**params)
    return resp.choices[0].message.content or ""


def evaluate(name: str, reply: str) -> dict:
    words = _count_words(reply)
    paras = _count_paragraphs(reply)
    qs = _count_questions(reply)
    banned_cert = _matches(reply, BANNED_CERTAINTY)
    banned_absent = _matches(reply, BANNED_ABSENT_PARTY)
    transcript = _matches(reply, TRANSCRIPT_CALLBACKS)
    teach_hits = _has_any(reply, SOFT_TEACH_MARKERS)
    marriage_flag = "marital" in name or "marriage" in name or "intimacy_conflict" in name
    marriage_hits = _has_any(reply, MARRIAGE_SAFEGUARD_MARKERS) if marriage_flag else []
    # PASS/FAIL rules per V3.
    verdict = []
    verdict.append(("concise (<=180 words)", "PASS" if words <= 180 else f"FAIL ({words} words)"))
    verdict.append(("<=4 paragraphs", "PASS" if paras <= 4 else f"FAIL ({paras} paragraphs)"))
    verdict.append(("<=1 question", "PASS" if qs <= 1 else f"FAIL ({qs} question marks)"))
    verdict.append(("no unsupported certainty", "PASS" if not banned_cert else f"FAIL {banned_cert}"))
    verdict.append(("no transcript callback", "PASS" if not transcript else f"FAIL {transcript}"))
    verdict.append(("teaches meaningfully", "PASS" if teach_hits else "SOFT (no soft-observation marker)"))
    if marriage_flag:
        verdict.append(("absent-spouse safeguard present", "PASS" if marriage_hits else "FAIL (no safeguard phrase)"))
        verdict.append(("no side-taking language", "PASS" if not banned_absent else f"FAIL {banned_absent}"))
    return {
        "words": words,
        "paragraphs": paras,
        "questions": qs,
        "verdict": verdict,
    }


async def main() -> None:
    print("# Walk Companion — V3 Conversation Quality Sprint")
    print()
    print(f"Model: `{WALK_MODEL}` — Sonnet 4.5")
    print(f"Prompt: SYSTEM_PROMPT from /app/backend/walk.py (v3)")
    print(f"Temperature: 0.75  |  max_tokens: 800")
    print()
    print("---")
    print()
    aggregate = []
    for name, msg in SCENARIOS:
        t0 = time.time()
        try:
            reply = await one_shot(msg)
        except Exception as e:  # noqa: BLE001
            reply = f"[ERROR: {e}]"
        latency = time.time() - t0
        metrics = evaluate(name, reply)
        aggregate.append((name, metrics))
        print(f"## {name}  ({latency:.1f}s)")
        print()
        print("**USER:**")
        print()
        print(f"> {msg}")
        print()
        print("**COMPANION:**")
        print()
        for line in reply.strip().split("\n"):
            print(f"> {line}")
        print()
        print("**Metrics**")
        for label, result in metrics["verdict"]:
            emoji = "✅" if str(result).startswith("PASS") else ("⚠️" if str(result).startswith("SOFT") else "❌")
            print(f"- {emoji} {label}: {result}")
        print()
        print("---")
        print()
    # Aggregate.
    print("## Aggregate")
    print()
    total = len(aggregate)
    for label_idx, label in enumerate([
        "concise (<=180 words)",
        "<=4 paragraphs",
        "<=1 question",
        "no unsupported certainty",
        "no transcript callback",
        "teaches meaningfully",
    ]):
        passes = sum(1 for _, m in aggregate for l, r in m["verdict"] if l == label and str(r).startswith("PASS"))
        print(f"- {label}: {passes}/{total}")


if __name__ == "__main__":
    asyncio.run(main())
