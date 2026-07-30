"""Singleton loader for the canonical-web-v1 reading plan.

The 7.8 MB artifact is parsed EXACTLY ONCE at first access. Subsequent calls
return the same in-memory index. The loader is thread-safe (module import is
serialized in CPython) and keeps a dict lookup by day (O(1)).
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

ARTIFACT_PATH = Path(__file__).parent / "canonical-web-v1.json"

# Module-level singletons — do not reset in production. Tests that want to
# force a reload should call reset_cache_for_tests().
_lock = threading.Lock()
_plan: Optional[dict[str, Any]] = None
_days_by_number: Optional[dict[int, dict[str, Any]]] = None
_load_count: int = 0


def _load_now() -> None:
    global _plan, _days_by_number, _load_count
    with ARTIFACT_PATH.open() as f:
        data = json.load(f)
    _plan = data
    _days_by_number = {d["day"]: d for d in data["days"]}
    _load_count += 1
    log.info(
        "reading_plan_loaded",
        extra={
            "plan_id": data.get("plan_id"),
            "sha256": data.get("sha256"),
            "total_days": data.get("total_days"),
            "load_count": _load_count,
        },
    )


def _ensure_loaded() -> None:
    if _plan is None:
        with _lock:
            if _plan is None:
                _load_now()


def plan_metadata() -> dict[str, Any]:
    """Return everything except the (very large) days array."""
    _ensure_loaded()
    assert _plan is not None
    return {k: v for k, v in _plan.items() if k != "days"}


def total_days() -> int:
    _ensure_loaded()
    assert _plan is not None
    return _plan["total_days"]


def plan_id() -> str:
    _ensure_loaded()
    assert _plan is not None
    return _plan["plan_id"]


def get_day(day_number: int) -> dict[str, Any]:
    """Return the full day payload (passage, key verse, summary, …)."""
    _ensure_loaded()
    assert _days_by_number is not None
    if day_number not in _days_by_number:
        raise KeyError(f"day {day_number} not in plan (total days = {total_days()})")
    return _days_by_number[day_number]


def clamp_day(day_number: Any, default: int = 1) -> int:
    """Coerce a value into 1..total_days(); fall back to default if invalid."""
    _ensure_loaded()
    total = total_days()
    try:
        d = int(day_number)
    except (TypeError, ValueError):
        return default
    if d < 1:
        return default
    if d > total:
        return total
    return d


def load_count_for_tests() -> int:
    return _load_count


def reset_cache_for_tests() -> None:
    """Force the next access to reload from disk. TESTS ONLY."""
    global _plan, _days_by_number
    with _lock:
        _plan = None
        _days_by_number = None
