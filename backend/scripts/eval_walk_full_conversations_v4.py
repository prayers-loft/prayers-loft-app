"""V4 Conversation Quality Sprint — full multi-turn transcript battery.

Drives 20+ scripted multi-turn conversations against the live SYSTEM_PROMPT.
Each conversation runs 4–5 user turns and ends with a natural closer
("thanks" / "amen" / "goodnight") to exercise the ending-recognition rule.

Emits per-turn metrics AND a per-conversation qualitative snapshot to stdout.

Usage:
    python /app/backend/scripts/eval_walk_full_conversations_v4.py > /tmp/walk-conversations-v4.md
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

from walk import (  # noqa: E402
    SYSTEM_PROMPT,
    WALK_MODEL,
    _sanitize_assistant_reply,
)


# -----------------------------------------------------------------------------
# 20+ scripted conversations (subject, [user turns…]).
# The last user turn is always a natural closer to test ending recognition.
# -----------------------------------------------------------------------------
CONVERSATIONS: List[Tuple[str, List[str]]] = [
    (
        "temptation",
        [
            "I've been fighting hard against looking at porn again, and tonight I feel it coming back. My wife's out of town and I don't know what to do.",
            "It's the loneliness, mostly. And boredom. I'm tired and I don't want to think.",
            "Praying feels hollow. But I'll try. I don't want to hurt her again — even if she never knows.",
            "That helped. I'll go for a walk and text my accountability partner.",
            "Thanks.",
        ],
    ),
    (
        "pornography",
        [
            "I fell again last night. Twice this week. I promised myself I was done and I keep failing.",
            "I don't even know what triggered it. I was just… numb.",
            "I hate how easy it is to reach for it. Like my hand knows the pattern.",
            "I'll tell my small-group leader this week. That's terrifying but I'll do it.",
            "Amen.",
        ],
    ),
    (
        "marriage",
        [
            "My wife hasn't wanted to be intimate with me for months. I feel unwanted and honestly it's making me angry.",
            "We've tried talking. It usually turns into a fight or she shuts down. I don't know if she's punishing me or just done.",
            "I'm scared to keep trying because rejection hurts more each time.",
            "You're right — I don't know what she's carrying. I've been so caught up in my own hurt I haven't asked.",
            "Okay. Thank you.",
        ],
    ),
    (
        "loneliness",
        [
            "I go to church every week but I feel completely invisible. I have no real friends. It's been years and I don't know how to change it.",
            "I sit in the back. I leave right after. I've thought about staying for coffee but I never do.",
            "I'm afraid if I actually try and it doesn't work, that'll be worse than being lonely.",
            "That's a hard truth. I think I've been waiting to be noticed instead of showing up.",
            "Thanks for that.",
        ],
    ),
    (
        "shame",
        [
            "I don't think God could love me if He knew what I really do when no one is watching. I feel like a fraud at church.",
            "I look at pornography. Sometimes daily. I've done it for years and I hide it perfectly.",
            "I've never confessed this to anyone. Not once.",
            "I want to. But I'm terrified of what my pastor will think.",
            "Okay. I'll pray about who to tell first. Goodnight.",
        ],
    ),
    (
        "anxiety",
        [
            "I can't sleep. My mind won't stop looping about work, money, my kids, everything. I know Philippians 4 says don't be anxious but I feel like I'm drowning.",
            "The kids are fine. Money's tight but not disaster. Work is just… relentless.",
            "I think I'm scared I can't hold it all together and I don't want anyone to see me fail.",
            "That helps. I'll try to name one thing to God tonight and stop before I spiral.",
            "Amen. Goodnight.",
        ],
    ),
    (
        "grief",
        [
            "My mom died six weeks ago. Everyone stopped calling. I still cry every morning and I don't know if that's normal.",
            "The mornings are the worst. I used to call her most mornings on my way to work.",
            "I don't want people to think I'm not okay. I just don't know how to be okay yet.",
            "Thank you for saying that. I've been afraid I'm doing grief wrong.",
            "Thanks.",
        ],
    ),
    (
        "depression",
        [
            "I don't want to hurt myself, but I don't really want to be here either. Everything feels heavy and grey. It's been months.",
            "I'm eating and sleeping. Barely. I'm making it through work. Nothing feels like anything.",
            "I haven't told anyone. I'm supposed to be the strong one in my family.",
            "I know I probably need to talk to a doctor. I've been avoiding it.",
            "Okay. I'll call my doctor tomorrow. Thanks for not making it weird.",
        ],
    ),
    (
        "answered_prayer",
        [
            "I need to tell someone — my daughter's biopsy came back benign. I've been praying for a month straight and I don't even know how to feel.",
            "Relief and exhaustion, mostly. And a little guilty for how afraid I was.",
            "I want to remember this moment. I don't want to forget that God met me here.",
            "Yeah. I'll write it down tonight. Thank you.",
            "Amen.",
        ],
    ),
    (
        "spiritual_dryness",
        [
            "I read my Bible and it feels like nothing. I pray and it feels like the ceiling. Six months of this. I'm starting to wonder if I ever really knew God.",
            "Before this, it was… warmth. A kind of settled sense that God was near. Not always dramatic but real.",
            "Nothing big happened. Just a slow fade. I kept doing the practices and they kept feeling more empty.",
            "That's a strange kind of comfort — that this doesn't mean I've lost Him.",
            "Thank you.",
        ],
    ),
    (
        "church_hurt",
        [
            "My last church covered up something serious. I left. It's been two years and I still can't walk into any building without feeling sick.",
            "The leadership. People I trusted. When someone finally spoke up they were pushed out and the person who did it was quietly moved.",
            "I still love Jesus. I just don't trust institutions anymore.",
            "I do miss it. Community. Communion. Just not the performance.",
            "Okay. I'll try that. Thanks.",
        ],
    ),
    (
        "parenting",
        [
            "I lost it with my son again. He's ten. He didn't do anything that bad and I screamed at him. Now he's scared of me.",
            "He got quiet. He's been avoiding me all evening. I hate that I did that.",
            "My dad was the same way. I promised myself I wouldn't be. And here I am.",
            "I'll go talk to him. Not to explain — just to apologize. Ask his forgiveness.",
            "Thanks. I needed to hear that.",
        ],
    ),
    (
        "forgiveness",
        [
            "My brother stole from our parents years ago and never apologized. Mom's dying and she keeps asking me to forgive him. I don't know how.",
            "It's that he never said sorry. He acts like it didn't happen.",
            "If I forgive him, doesn't that just let him off the hook?",
            "I hadn't heard it framed that way. Handing the debt to God. That I could maybe try.",
            "Thank you. Goodnight.",
        ],
    ),
    (
        "calling",
        [
            "I feel like God might be calling me to leave my job and go into full-time ministry. But I have three kids and a mortgage and I don't know if this is faith or foolishness.",
            "I don't want to be dramatic. But it won't quiet down. It's been almost a year.",
            "My wife is scared but supportive. My pastor thinks I should get more training first.",
            "That makes sense. Wait for confirmation, not just conviction.",
            "Okay. Thanks for helping me slow down.",
        ],
    ),
    (
        "celebration",
        [
            "I need to tell someone — I've been sober from drinking for a full year today. I never thought I'd get here.",
            "It doesn't feel like willpower. Every time I wanted to quit quitting, something held me.",
            "I want to thank Him properly. I don't know how.",
            "That's beautiful. I'll do that.",
            "Amen. Thank you.",
        ],
    ),
    (
        "disappointment",
        [
            "I've been praying for my dad's healing for two years. Tests came back yesterday and it's worse. I don't know if God even hears me anymore.",
            "I'm not angry. I'm just tired. And I feel guilty for being tired.",
            "How do I keep praying when it feels pointless?",
            "That's honest. I think I've been trying to sound faithful instead of being honest with Him.",
            "Thanks. I'll try tonight.",
        ],
    ),
    (
        "doubt",
        [
            "I've been reading arguments against Christianity and honestly some of them are hard to answer. I don't want to lose my faith but I feel it slipping.",
            "It's mostly the problem of suffering. And the reliability of the resurrection accounts.",
            "I don't want easy answers. I've heard those. I want to know it's actually okay to sit here for a while.",
            "That helps. Wrestling isn't slipping. I'll keep at it — with people, not alone.",
            "Thanks.",
        ],
    ),
    (
        "addiction",
        [
            "I've been using pills for about a year and now I can't stop. I've hidden it from everyone. I know I need help but I'm terrified of what people will think.",
            "It started after my back surgery. I never came off them.",
            "My wife doesn't know. That's the part that terrifies me most.",
            "Okay. I'll call my doctor first, and tell my wife tonight. I don't want to keep hiding.",
            "Thank you. Goodnight.",
        ],
    ),
    (
        "anger",
        [
            "I've been sitting on rage all week. My boss threw me under the bus and I can't stop replaying it. I'm supposed to love my enemies but I want to burn something down.",
            "He blamed me for a mistake he made. To the whole team. He hasn't corrected it.",
            "Part of me knows it's not about him. It's about being unseen. Not defended.",
            "I don't want to pretend it didn't happen. But I don't want to be owned by it either.",
            "Okay. I'll pray for him tonight. Even if I don't feel like it.",
        ],
    ),
    (
        "fear",
        [
            "I keep having panic attacks about my daughter. She's fine — she's five and healthy — but I keep imagining her getting hurt or dying and I can't shake it.",
            "It started when a friend's kid drowned last summer. I couldn't stop picturing it.",
            "I trust God with my life. I don't know if I trust Him with hers.",
            "That's a real question. I've been afraid to even ask it.",
            "Thanks. That gives me something to sit with.",
        ],
    ),
]


# -----------------------------------------------------------------------------
# Metrics
# -----------------------------------------------------------------------------
def _words(t: str) -> int: return len(re.findall(r"\S+", t))
def _paragraphs(t: str) -> int: return len([p for p in re.split(r"\n\s*\n", t.strip()) if p.strip()])
def _questions(t: str) -> int: return t.count("?")

BANNED_OPENERS = ("that sounds", "i'm glad you told me", "i hear you", "it sounds like", "thank you for sharing")
def _repetitive_opener(t: str) -> str | None:
    low = t.strip().lower()
    for b in BANNED_OPENERS:
        if low.startswith(b):
            return b
    return None

CANI_ASK_RE = re.compile(r"\bCan\s+I\s+ask\b|\bMay\s+I\s+ask\b|\bCan\s+I\s+share\s+(?:an?\s+observation|something)\b|\bCan\s+I\s+tell\s+you\s+(?:what\s+I\s+notice|something)", re.IGNORECASE)

CLOSER_MARKERS = ("thanks", "thank you", "amen", "okay.", "sounds good", "i'll do that", "goodnight", "bye", "see you", "you too")
def _is_closer_user_turn(t: str) -> bool:
    stripped = t.strip().lower().rstrip(".!?")
    return any(stripped == m or stripped.startswith(m + " ") or stripped.endswith(" " + m) for m in CLOSER_MARKERS) or len(stripped.split()) <= 3

CLOSING_MARKERS = (
    "goodnight", "grace and peace", "amen", "may god's peace", "may god give",
    "may his peace", "he watches over you", "sleep well", "walk in peace",
    "peace to you", "i'll be here when", "i'll be here whenever",
    "peace be with you", "blessing", "you're welcome", "he'll meet you",
    "i'll be praying", "close to the brokenhearted", "he sees you",
    "he loves you",
)
def _sounds_like_closing(t: str) -> bool:
    low = t.lower()
    return any(m in low for m in CLOSING_MARKERS)


async def chat_turn(system: str, history: List[dict], user_msg: str) -> str:
    api_key = os.environ["EMERGENT_LLM_KEY"]
    params = {
        "model": WALK_MODEL,
        "messages": [{"role": "system", "content": system}] + history + [{"role": "user", "content": user_msg}],
        "api_key": api_key,
        "temperature": 0.75,
        "max_tokens": 800,
    }
    if api_key.startswith("sk-emergent-"):
        proxy = get_integration_proxy_url()
        params["api_base"] = proxy + "/llm"
        params["custom_llm_provider"] = "openai"
    resp = await litellm.acompletion(**params)
    raw = resp.choices[0].message.content or ""
    # Apply the same sanitizer the server applies at stream time.
    return _sanitize_assistant_reply(raw).strip()


async def run_conversation(name: str, user_turns: List[str]) -> dict:
    system = SYSTEM_PROMPT
    history: List[dict] = []
    turns_data = []
    used_openers = set()
    for i, user_msg in enumerate(user_turns):
        t0 = time.time()
        try:
            reply = await chat_turn(system, history, user_msg)
        except Exception as e:  # noqa: BLE001
            reply = f"[ERROR: {e}]"
        elapsed = time.time() - t0
        history.append({"role": "user", "content": user_msg})
        history.append({"role": "assistant", "content": reply})

        is_closer = _is_closer_user_turn(user_msg) and i == len(user_turns) - 1
        opener_hit = _repetitive_opener(reply)
        if opener_hit:
            used_openers.add(opener_hit)
        turns_data.append({
            "user": user_msg,
            "assistant": reply,
            "words": _words(reply),
            "paras": _paragraphs(reply),
            "questions": _questions(reply),
            "cani_ask_slipped": bool(CANI_ASK_RE.search(reply)),
            "opener_hit": opener_hit,
            "is_closer_turn": is_closer,
            "sounds_closing": _sounds_like_closing(reply),
            "elapsed_s": elapsed,
        })
    return {"name": name, "turns": turns_data, "used_openers": used_openers}


async def main() -> None:
    print("# Walk Companion — V4 Conversation Quality Sprint")
    print()
    print(f"Model: `{WALK_MODEL}` — Claude Sonnet 4.5")
    print("Prompt: SYSTEM_PROMPT from /app/backend/walk.py (V4)")
    print("Sanitizer: `_sanitize_assistant_reply` applied to every reply (matches server behaviour).")
    print()
    print(f"Total conversations: **{len(CONVERSATIONS)}** — each ends with a natural closer to test ending recognition.")
    print()
    print("---")
    print()

    all_convos = []
    for name, turns in CONVERSATIONS:
        convo = await run_conversation(name, turns)
        all_convos.append(convo)
        # Emit transcript
        print(f"## {name}")
        print()
        for i, t in enumerate(convo["turns"]):
            print(f"**Turn {i+1} — user:**")
            print()
            print(f"> {t['user']}")
            print()
            print(f"**Turn {i+1} — companion** ({t['elapsed_s']:.1f}s, {t['words']}w, {t['paras']}p, {t['questions']}q):")
            print()
            for line in t["assistant"].strip().split("\n"):
                print(f"> {line}")
            print()
            flags = []
            if t["cani_ask_slipped"]:
                flags.append("❌ 'Can I ask/share/tell' slipped past sanitizer")
            if t["opener_hit"]:
                flags.append(f"⚠️ repetitive opener: '{t['opener_hit']}'")
            if t["is_closer_turn"]:
                if t["sounds_closing"]:
                    flags.append("✅ recognized closer + closed gracefully")
                else:
                    flags.append("❌ user signaled close, companion did not close")
            if flags:
                for f in flags:
                    print(f"- {f}")
                print()
        # Per-conversation summary
        opener_repeat = len(convo["used_openers"]) < sum(1 for t in convo["turns"] if t["opener_hit"])
        print(f"**Conversation summary — {name}:**")
        cani = sum(t["cani_ask_slipped"] for t in convo["turns"])
        total_q = sum(t["questions"] for t in convo["turns"])
        avg_words = sum(t["words"] for t in convo["turns"]) / max(1, len(convo["turns"]))
        closer_turn = convo["turns"][-1]
        closer_ok = "✅" if (closer_turn["is_closer_turn"] and closer_turn["sounds_closing"]) else "⚠️"
        print(f"- avg words/reply: {avg_words:.0f}")
        print(f"- total question marks: {total_q}")
        print(f"- 'Can I ask/share/tell' slippage: {cani}")
        print(f"- distinct AI-flavored openers used: {len(convo['used_openers'])} — {sorted(convo['used_openers']) if convo['used_openers'] else '(none)'}")
        print(f"- ending recognized + closed cleanly: {closer_ok}")
        print()
        print("---")
        print()

    # Global aggregate
    print("## Aggregate")
    print()
    total_convos = len(all_convos)
    total_turns = sum(len(c["turns"]) for c in all_convos)
    slippage = sum(t["cani_ask_slipped"] for c in all_convos for t in c["turns"])
    endings_ok = sum(1 for c in all_convos if c["turns"][-1]["is_closer_turn"] and c["turns"][-1]["sounds_closing"])
    endings_flagged = sum(1 for c in all_convos if c["turns"][-1]["is_closer_turn"] and not c["turns"][-1]["sounds_closing"])
    all_openers = set()
    for c in all_convos:
        all_openers |= c["used_openers"]
    print(f"- conversations: {total_convos}")
    print(f"- total assistant replies: {total_turns}")
    print(f"- 'Can I ask/share/tell' slippages after sanitizer: **{slippage} / {total_turns}**")
    print(f"- distinct AI-flavored openers seen across all convos: **{len(all_openers)}** — {sorted(all_openers) if all_openers else '(none)'}")
    print(f"- natural endings recognized + closed cleanly: **{endings_ok} / {total_convos}**")
    if endings_flagged:
        print(f"- endings the companion missed (user closed but AI kept going): **{endings_flagged}**")


if __name__ == "__main__":
    asyncio.run(main())
