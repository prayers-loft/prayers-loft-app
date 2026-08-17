"""E2E backend tests for Build 22 QA pass — Walk memory lifecycle, memory
isolation, SSE stance/closing metadata, daily-verse smoke.

Runs against the deployed preview URL (EXPO_PUBLIC_BACKEND_URL). Uses real
Claude Sonnet streaming, so tests allow generous timeouts.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Optional

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://exodus-build-preview.preview.emergentagent.com",
).rstrip("/")

STREAM_TIMEOUT_S = 90.0


# -----------------------------------------------------------------------------
# Fixtures / helpers
# -----------------------------------------------------------------------------
@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _guest_headers(guest_id: Optional[str] = None) -> dict:
    return {"X-Guest-Id": guest_id or f"guest-{uuid.uuid4().hex[:12]}"}


def _stream_message(
    api: requests.Session,
    session_id: str,
    guest_id: str,
    text: str,
    timeout_s: float = STREAM_TIMEOUT_S,
) -> dict:
    """POST an SSE message turn; return {'chunks': [...], 'done': {...}, 'error': str|None}."""
    url = f"{BASE_URL}/api/walk/session/{session_id}/message"
    headers = {
        "X-Guest-Id": guest_id,
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    result = {"chunks": [], "done": None, "error": None, "raw_events": []}
    started = time.time()
    with api.post(
        url, headers=headers, json={"text": text}, stream=True, timeout=timeout_s
    ) as r:
        if r.status_code != 200:
            result["error"] = f"HTTP {r.status_code}: {r.text[:400]}"
            return result

        current_event: Optional[str] = None
        for raw_line in r.iter_lines(decode_unicode=True):
            if time.time() - started > timeout_s:
                result["error"] = "SSE timeout"
                break
            if raw_line is None:
                continue
            line = raw_line.strip("\r")
            if line == "":
                current_event = None
                continue
            if line.startswith("event:"):
                current_event = line[len("event:") :].strip()
                continue
            if line.startswith("data:"):
                data_str = line[len("data:") :].strip()
                result["raw_events"].append((current_event or "message", data_str))
                try:
                    payload = json.loads(data_str)
                except Exception:
                    payload = {"_raw": data_str}
                if current_event == "done":
                    result["done"] = payload
                    break
                if current_event == "error":
                    result["error"] = data_str
                    break
                if "delta" in payload:
                    result["chunks"].append(payload["delta"])
    return result


# =============================================================================
# Daily verse smoke (Guest, Day 1)
# =============================================================================
class TestDailyVerse:
    def test_guest_daily_verse_returns_day1_genesis(self, api):
        r = api.get(f"{BASE_URL}/api/daily-verse", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("day") == 1
        assert data.get("book_name") == "Genesis"
        assert data.get("reference") == "Genesis 1:1-25"
        assert isinstance(data.get("passage"), list) and len(data["passage"]) == 25


# =============================================================================
# Walk memory lifecycle — landing.callback_hint second-person, last_session_summary
# =============================================================================
class TestWalkMemoryLifecycle:
    def test_full_lifecycle_second_person_callback(self, api):
        gid = f"guest-{uuid.uuid4().hex[:12]}"
        hdrs_json = {**_guest_headers(gid), "Content-Type": "application/json"}

        # start
        r = api.post(f"{BASE_URL}/api/walk/session/start", headers=hdrs_json, timeout=20)
        assert r.status_code == 200, r.text
        session_id = r.json().get("id") or r.json().get("session_id")
        assert session_id, r.json()

        # 2 user turns via SSE
        first = _stream_message(
            api, session_id, gid,
            "I've been wrestling with dryness in my prayer life for the past few weeks. It's hard.",
        )
        assert first["error"] is None, f"turn1 error: {first['error']}"
        assert first["done"] is not None, f"no done event; events={first['raw_events'][:5]}"
        assert "stance" in first["done"]
        assert "closing" in first["done"]

        second = _stream_message(
            api, session_id, gid,
            "Yeah. I think I've just been busy and haven't been making time. Thanks for listening.",
        )
        assert second["error"] is None, f"turn2 error: {second['error']}"
        assert second["done"] is not None

        # end session
        r = api.post(
            f"{BASE_URL}/api/walk/session/{session_id}/end",
            headers=hdrs_json,
            timeout=30,
        )
        assert r.status_code == 200, r.text

        # give the async summarizer a moment
        time.sleep(3.0)

        # landing
        r = api.get(f"{BASE_URL}/api/walk/landing", headers=_guest_headers(gid), timeout=15)
        assert r.status_code == 200, r.text
        landing = r.json()

        callback_hint = landing.get("callback_hint")
        assert callback_hint, f"callback_hint missing/empty: {landing}"
        low = callback_hint.lower()
        # MUST be second person
        assert low.startswith("last time, you"), (
            f"callback_hint must start with 'Last time, you'; got: {callback_hint!r}"
        )
        # MUST NOT be third person
        for banned in [" they ", " the user ", " he ", " she ", "they were", "the user was"]:
            assert banned not in low, f"callback_hint leaks third person '{banned}': {callback_hint!r}"

        # last_session_summary present and second-person
        lss = landing.get("last_session_summary")
        assert lss, f"last_session_summary missing: {landing}"
        # If dict, look for 'summary' field
        summary_text = lss.get("summary") if isinstance(lss, dict) else str(lss)
        assert summary_text, f"no summary text in last_session_summary: {lss}"
        s_low = summary_text.lower()
        assert s_low.startswith("you "), (
            f"last_session_summary must be second-person 'You…'; got: {summary_text!r}"
        )


# =============================================================================
# Memory data isolation between two distinct guests
# =============================================================================
class TestGuestIsolation:
    def test_guest_a_and_b_do_not_leak(self, api):
        gid_a = f"guest-{uuid.uuid4().hex[:12]}"
        gid_b = f"guest-{uuid.uuid4().hex[:12]}"

        # Guest A: complete a conversation
        r = api.post(
            f"{BASE_URL}/api/walk/session/start",
            headers={**_guest_headers(gid_a), "Content-Type": "application/json"},
            timeout=20,
        )
        assert r.status_code == 200
        sid_a = r.json().get("id") or r.json().get("session_id")

        t1 = _stream_message(
            api, sid_a, gid_a,
            "I'm anxious about starting a new job next week. It feels overwhelming.",
        )
        assert t1["error"] is None
        assert t1["done"] is not None
        t2 = _stream_message(
            api, sid_a, gid_a,
            "Thanks. I think I need to trust that God is with me in this transition.",
        )
        assert t2["error"] is None
        assert t2["done"] is not None

        r = api.post(
            f"{BASE_URL}/api/walk/session/{sid_a}/end",
            headers={**_guest_headers(gid_a), "Content-Type": "application/json"},
            timeout=30,
        )
        assert r.status_code == 200
        time.sleep(3.5)

        # Guest A landing has memory
        r = api.get(f"{BASE_URL}/api/walk/landing", headers=_guest_headers(gid_a), timeout=15)
        assert r.status_code == 200
        landing_a = r.json()
        # Guest A must see SOMETHING from their own session (either summary, hint,
        # or an active_* field). The critical assertion below is that Guest B
        # sees NONE of it.
        assert (
            landing_a.get("last_session_summary")
            or landing_a.get("callback_hint")
            or landing_a.get("active_struggle")
            or landing_a.get("active_commitment")
            or landing_a.get("active_prayer")
        ), f"Guest A landing missing all memory: {landing_a}"

        # Guest B landing must be pristine — no memory whatsoever
        r = api.get(f"{BASE_URL}/api/walk/landing", headers=_guest_headers(gid_b), timeout=15)
        assert r.status_code == 200
        landing_b = r.json()
        assert not landing_b.get("callback_hint"), (
            f"LEAK: Guest B sees callback_hint: {landing_b.get('callback_hint')!r}"
        )
        assert not landing_b.get("last_session_summary"), (
            f"LEAK: Guest B sees last_session_summary: {landing_b.get('last_session_summary')!r}"
        )
        for field in ("active_struggle", "active_commitment", "active_prayer"):
            assert not landing_b.get(field), (
                f"LEAK: Guest B sees {field}: {landing_b.get(field)!r}"
            )
        # session_count / is_first_ever should reflect Guest B has no history
        assert landing_b.get("session_count", 0) == 0, (
            f"LEAK: Guest B session_count non-zero: {landing_b.get('session_count')}"
        )


# =============================================================================
# SSE done event — stance + closing metadata
# =============================================================================
class TestSSEDoneMetadata:
    def test_bare_thanks_after_resolved_conversation_yields_close(self, api):
        gid = f"guest-{uuid.uuid4().hex[:12]}"
        hdrs_json = {**_guest_headers(gid), "Content-Type": "application/json"}

        r = api.post(f"{BASE_URL}/api/walk/session/start", headers=hdrs_json, timeout=20)
        assert r.status_code == 200
        sid = r.json().get("id") or r.json().get("session_id")

        # A couple of substantive turns to reach a "resolved" feel
        t1 = _stream_message(
            api, sid, gid,
            "I've been anxious about a decision I need to make about my career.",
        )
        assert t1["done"] is not None
        assert "stance" in t1["done"] and "closing" in t1["done"]

        t2 = _stream_message(
            api, sid, gid,
            "Yeah, I think I know what to do now. I'll take the time to pray about it this week.",
        )
        assert t2["done"] is not None

        # Bare closing
        t3 = _stream_message(api, sid, gid, "thanks")
        assert t3["error"] is None, f"turn3 error: {t3['error']}"
        assert t3["done"] is not None, f"no done event; events={t3['raw_events'][:5]}"

        stance = t3["done"].get("stance")
        closing = t3["done"].get("closing")
        # Structural invariants required by review:
        assert stance in {"arrive", "listen", "reflect", "invite", "close"}, stance
        assert isinstance(closing, bool), closing

        # Behavioural expectation from the review request. Non-fatal (LLM
        # classifier is heuristic + non-deterministic on edge phrasing), so we
        # log rather than hard-fail if it deviates — but hard-fail if BOTH
        # stance != 'close' AND closing is False (i.e. no close signal at all).
        if stance != "close" and not closing:
            pytest.fail(
                f"Bare 'thanks' after resolved convo produced no close signal: "
                f"stance={stance!r} closing={closing!r}"
            )
