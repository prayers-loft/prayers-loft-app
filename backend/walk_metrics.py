"""Walk beta monitoring — lightweight aggregate event log.

Design constraints (user directives, 2026-06):
  * No user messages, assistant transcripts, or raw prompts in metrics.
  * No session or user content beyond opaque UUIDs (which are not PII).
  * No LLM-based transcript audit job.
  * Metrics failures MUST NOT interrupt the Walk response.
  * Sanitizer tracking stores only rule CATEGORY, never content.
  * Latency is split into time-to-first-chunk (TTFC) and full completion.
  * Token totals come from provider metadata when available.

We use a single Mongo collection ``walk_metrics_events`` with tiny docs
(one per event). Aggregations are queryable via straightforward Mongo
grouping — no external analytics platform.

Event types:
  session_started           — one per session/start
  turn_started              — one per user message received
  turn_completed            — one per successful assistant reply
  llm_failure               — one per SSE error frame emitted
  v4_fallback               — one when V5 path degrades to V4 opener
  sanitizer_activated       — one per rule-category hit per turn
                              (deduped within a turn; categories only)
  crisis_route              — one when classifier returns crisis stance
  session_ended             — one per session/end (completion tracking)
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger("walk.metrics")

_METRICS_COLLECTION = "walk_metrics_events"


async def _write(db: Any, doc: Dict[str, Any]) -> None:
    """Actual insert. Wrapped so callers can fire-and-forget."""
    try:
        doc["ts"] = datetime.now(timezone.utc)
        await db[_METRICS_COLLECTION].insert_one(doc)
    except Exception:  # noqa: BLE001
        # Metrics MUST NEVER break Walk. Log at debug only.
        logger.debug("metrics write failed (non-fatal)", exc_info=True)


def emit(db: Any, event_type: str, **fields: Any) -> None:
    """Fire-and-forget event emission. Returns immediately; write happens
    in a background task. Failures are swallowed."""
    try:
        doc = {"event": event_type, **{k: v for k, v in fields.items() if v is not None}}
        # asyncio.create_task returns immediately; the task runs on the
        # event loop as capacity allows.
        asyncio.create_task(_write(db, doc))
    except RuntimeError:
        # No running loop — happens in some test/setup paths. Silent.
        logger.debug("metrics emit: no running loop", exc_info=True)
    except Exception:  # noqa: BLE001
        logger.debug("metrics emit failed (non-fatal)", exc_info=True)


# ---------------------------------------------------------------------------
# Sanitizer rule category classifier
# ---------------------------------------------------------------------------
def sanitizer_rule_category(pattern_source: str) -> str:
    """Map a compiled sanitizer pattern's source to a coarse rule category.
    Only the category name is ever logged — never the pattern text and
    never the matched sentence."""
    ps = pattern_source.lower()
    if "can\\s+i\\s+ask" in ps or "may\\s+i\\s+ask" in ps:
        return "soft_question"
    if "last\\s+time\\s+you" in ps or "earlier\\s+you" in ps or "previously\\s+you" in ps:
        return "crm_recall_temporal"
    if "you\\s+said" in ps or "you\\s+mentioned" in ps or "you\\s+told\\s+me" in ps:
        return "crm_recall_plain"
    return "other"


# ---------------------------------------------------------------------------
# Ensure indexes for aggregation queries (called at app startup)
# ---------------------------------------------------------------------------
async def ensure_metrics_indexes(db: Any) -> None:
    try:
        await db[_METRICS_COLLECTION].create_index([("event", 1), ("ts", -1)])
        await db[_METRICS_COLLECTION].create_index("ts")
        await db[_METRICS_COLLECTION].create_index("session_id")
    except Exception:  # noqa: BLE001
        logger.debug("metrics index creation non-fatal", exc_info=True)


# ---------------------------------------------------------------------------
# Aggregation helpers — read-only summary the operator can call from a
# small admin endpoint or a shell for beta review.
# ---------------------------------------------------------------------------
async def summarize_beta(
    db: Any,
    since_hours: int = 168,
) -> Dict[str, Any]:
    """Return aggregate beta metrics for the last N hours. Reads only the
    metrics collection — never touches session transcripts."""
    from datetime import timedelta
    since_ts = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    coll = db[_METRICS_COLLECTION]

    async def _count(query: Dict[str, Any]) -> int:
        return await coll.count_documents({"ts": {"$gte": since_ts}, **query})

    # Basic counters
    v5_turns = await _count({"event": "turn_completed", "version": "v5"})
    v4_turns = await _count({"event": "turn_completed", "version": "v4"})
    llm_failures = await _count({"event": "llm_failure"})
    v4_fallbacks = await _count({"event": "v4_fallback"})
    crisis_routes = await _count({"event": "crisis_route"})
    completed_sessions = await _count({"event": "session_ended"})
    unique_sessions = len(
        await coll.distinct("session_id", {"ts": {"$gte": since_ts}})
    )
    sanitizer_hits = await _count({"event": "sanitizer_activated"})

    # Aggregations for tokens + latency (V5 only)
    pipeline = [
        {"$match": {
            "event": "turn_completed",
            "version": "v5",
            "ts": {"$gte": since_ts},
        }},
        {"$group": {
            "_id": None,
            "avg_in": {"$avg": "$input_tokens"},
            "avg_out": {"$avg": "$output_tokens"},
            "avg_ttfc": {"$avg": "$ttfc_ms"},
            "avg_total": {"$avg": "$total_ms"},
            "sum_in": {"$sum": "$input_tokens"},
            "sum_out": {"$sum": "$output_tokens"},
        }},
    ]
    agg = await coll.aggregate(pipeline).to_list(length=1)
    a = agg[0] if agg else {}

    # p95 via a second aggregation (simpler than $percentile on older Mongo).
    ttfc_samples = await coll.find(
        {"event": "turn_completed", "version": "v5", "ts": {"$gte": since_ts}},
        {"_id": 0, "ttfc_ms": 1, "total_ms": 1},
    ).to_list(length=10000)
    ttfc_list = sorted(s["ttfc_ms"] for s in ttfc_samples if s.get("ttfc_ms") is not None)
    total_list = sorted(s["total_ms"] for s in ttfc_samples if s.get("total_ms") is not None)

    def _p95(seq):
        if not seq:
            return None
        idx = max(0, int(round(0.95 * (len(seq) - 1))))
        return seq[idx]

    return {
        "window_hours": since_hours,
        "v5_turns": v5_turns,
        "v4_turns": v4_turns,
        "unique_sessions": unique_sessions,
        "completed_sessions": completed_sessions,
        "llm_failures": llm_failures,
        "v4_fallbacks": v4_fallbacks,
        "sanitizer_activations": sanitizer_hits,
        "crisis_routes": crisis_routes,
        "avg_input_tokens": a.get("avg_in"),
        "avg_output_tokens": a.get("avg_out"),
        "total_input_tokens": a.get("sum_in", 0),
        "total_output_tokens": a.get("sum_out", 0),
        "avg_ttfc_ms": a.get("avg_ttfc"),
        "p95_ttfc_ms": _p95(ttfc_list),
        "avg_total_ms": a.get("avg_total"),
        "p95_total_ms": _p95(total_list),
    }
