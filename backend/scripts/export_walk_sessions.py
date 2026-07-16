"""Export real Walk conversations for human transcript review.

Once the app is in beta, run this to produce a markdown review file with
recent full conversations (user turns + companion replies, in order),
already-sanitized text, plus each session's summary and extracted memory
items. Reads directly from Mongo — no API call, no auth needed.

USAGE:
    # Most recent 30 completed sessions, all users:
    python /app/backend/scripts/export_walk_sessions.py > /tmp/real-walk-sessions.md

    # Most recent 100 sessions, only include sessions with >= 2 user turns:
    python /app/backend/scripts/export_walk_sessions.py --limit 100 --min-turns 2

    # Only sessions for a specific guest_id or user_id (owner_key):
    python /app/backend/scripts/export_walk_sessions.py --owner "g:<guest_id>"
    python /app/backend/scripts/export_walk_sessions.py --owner "u:<user_id>"

    # Only sessions from the last 7 days:
    python /app/backend/scripts/export_walk_sessions.py --days 7

The output is designed to be read straight through. Each conversation is
labeled with owner_key (redacted to the first 8 chars by default so you
can distinguish users without exposing IDs) and a short summary line.

Reviewing workflow (per the beta plan):
  1. Export -> read straight through
  2. Mark moments where the companion sounded like ChatGPT
  3. Look for RECURRING patterns across users (not one-offs)
  4. Only when a pattern shows up in 3+ real sessions, patch the prompt
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(dotenv_path="/app/backend/.env")


def _redact(owner_key: str, mode: str) -> str:
    """Redact owner_key for review output.

    'short' (default) shows the type prefix + first 8 chars, e.g. "g:6964eee0".
    'full' shows the raw key (use with care).
    """
    if mode == "full" or not owner_key:
        return owner_key or "unknown"
    if ":" in owner_key:
        prefix, rest = owner_key.split(":", 1)
        return f"{prefix}:{rest[:8]}"
    return owner_key[:10]


def _fmt_time(dt: Optional[Any]) -> str:
    if not dt:
        return "?"
    if isinstance(dt, str):
        return dt
    try:
        return dt.isoformat(timespec="seconds")
    except Exception:  # noqa: BLE001
        return str(dt)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--min-turns", type=int, default=1,
                    help="Skip sessions with fewer than this many user turns.")
    ap.add_argument("--days", type=int, default=None,
                    help="Only include sessions started within the last N days.")
    ap.add_argument("--owner", type=str, default=None,
                    help="Filter to a specific owner_key (e.g. 'g:abc' or 'u:xyz').")
    ap.add_argument("--redact", choices=["short", "full"], default="short",
                    help="Redact owner_key in output (default: short).")
    ap.add_argument("--include-active", action="store_true",
                    help="Include sessions that haven't been explicitly ended.")
    args = ap.parse_args()

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]

    q: Dict[str, Any] = {}
    if not args.include_active:
        q["ended_at"] = {"$exists": True, "$ne": None}
    if args.owner:
        q["owner_key"] = args.owner
    if args.days:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=args.days)).isoformat()
        q["started_at"] = {"$gte": cutoff}

    cursor = db.walk_sessions.find(q).sort("started_at", -1).limit(args.limit)
    sessions: List[Dict[str, Any]] = await cursor.to_list(length=args.limit)

    print("# Real Walk conversations — review pass")
    print()
    print(f"- Query: {q}")
    print(f"- Sessions returned: {len(sessions)}")
    print(f"- Redaction: {args.redact}")
    print(f"- Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    print()
    print("**Review question (per the beta workflow):**")
    print()
    print("> \"If I read these conversations back-to-back, where would I begin recognizing the same speaker?\"")
    print()
    print("Note the RECURRING patterns. One-offs are not signal — only patterns that")
    print("show up in 3+ real sessions merit a targeted prompt refinement.")
    print()
    print("---")
    print()

    kept = 0
    for s in sessions:
        msgs = s.get("messages") or []
        user_turns = [m for m in msgs if m.get("role") == "user"]
        if len(user_turns) < args.min_turns:
            continue
        kept += 1
        owner = _redact(s.get("owner_key", ""), args.redact)
        sid = s.get("id", "?")[:8]
        started = _fmt_time(s.get("started_at"))
        ended = _fmt_time(s.get("ended_at"))
        summary = s.get("session_summary") or "(no summary yet)"

        print(f"## {owner} — session `{sid}`")
        print()
        print(f"- started: {started}")
        print(f"- ended:   {ended}")
        print(f"- user turns: {len(user_turns)}   total messages: {len(msgs)}")
        print(f"- session summary: {summary}")
        print()

        # Pull the extracted memory items associated with this session.
        mem_items = await db.walk_memory.find(
            {"source_session_id": s.get("id")}
        ).to_list(length=200)
        if mem_items:
            print("**Memory extracted from this session:**")
            for m in mem_items:
                kind = m.get("kind", "?")
                content = m.get("content", "")
                scripture = m.get("scripture_ref")
                status = m.get("status", "?")
                extra = f"  [{scripture}]" if scripture else ""
                print(f"- {kind} ({status}){extra}: {content}")
            print()

        print("**Transcript:**")
        print()
        for m in msgs:
            role = m.get("role", "?")
            content = (m.get("content") or "").strip()
            at = _fmt_time(m.get("at"))
            label = "USER" if role == "user" else "COMPANION"
            print(f"**{label}** ({at}):")
            print()
            for line in content.split("\n"):
                print(f"> {line}")
            print()
        print("---")
        print()

    print(f"_Kept {kept} of {len(sessions)} sessions after --min-turns filter._")


if __name__ == "__main__":
    asyncio.run(main())
