"""Iteration 6 backend tests.

Focus: brand-new GET /api/health liveness endpoint + AI/LLM regression +
reflections owner-scoping + auth regression. Per review request, runs
against the LOCAL backend (http://localhost:8001) for determinism, but
falls back to EXPO_PUBLIC_BACKEND_URL if localhost is unreachable.
"""
import os
import re
import time
import uuid
import pytest
import requests

LOCAL_URL = "http://localhost:8001"
PUBLIC_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


def _resolve_base():
    # Prefer localhost for speed and determinism.
    try:
        r = requests.get(f"{LOCAL_URL}/api/health", timeout=5)
        if r.status_code == 200:
            return LOCAL_URL
    except Exception:
        pass
    assert PUBLIC_URL, "Neither localhost:8001 nor EXPO_PUBLIC_BACKEND_URL reachable"
    return PUBLIC_URL


BASE_URL = _resolve_base()
API = f"{BASE_URL}/api"
TIMEOUT = 90  # AI calls can be slow


# ---------------- /api/health (NEW) ----------------
class TestHealth:
    def test_health_returns_ok_true(self):
        r = requests.get(f"{API}/health", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

    def test_health_is_fast(self):
        # Spec: must respond in <500ms (no DB/LLM hit).
        # Take min over a few calls to filter network jitter.
        timings = []
        for _ in range(5):
            t0 = time.perf_counter()
            r = requests.get(f"{API}/health", timeout=5)
            timings.append((time.perf_counter() - t0) * 1000)
            assert r.status_code == 200
        best = min(timings)
        assert best < 500, f"health too slow: best={best:.1f}ms timings={timings}"

    def test_health_does_not_break_catchall_404(self):
        r = requests.get(f"{API}/this-route-definitely-does-not-exist", timeout=10)
        assert r.status_code == 404


# ---------------- Prayer-request (Claude Haiku via Emergent LLM Key) ----------------
class TestPrayerRequestAI:
    def test_prayer_request_non_empty_response(self):
        r = requests.post(
            f"{API}/prayer-request",
            json={"message": "I am anxious about my job"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        text = body.get("response", "")
        assert isinstance(text, str) and len(text) > 50, f"Empty/short response: {text!r}"
        # Per system prompt the response must contain a VERSE: line.
        assert re.search(r"VERSE:\s*", text, re.IGNORECASE), f"No VERSE: line in:\n{text}"


# ---------------- Daily verse ----------------
class TestDailyVerse:
    REQUIRED = ("verse", "reference", "verse_id", "bible_link", "devotional", "local_date")

    def test_daily_verse_default(self):
        r = requests.get(f"{API}/daily-verse", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in self.REQUIRED:
            assert k in body and body[k], f"missing/empty {k}"
        assert "_id" not in body

    def test_daily_verse_with_local_date_and_tz(self):
        r = requests.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-09", "tz": "UTC"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for k in self.REQUIRED:
            assert k in body and body[k], f"missing/empty {k}"
        assert body["local_date"] == "2026-06-09"
        # verse_id format BOOK.CHAPTER.VERSE
        assert re.match(r"^[A-Z0-9]+\.\d+\.\d+$", body["verse_id"]) is not None


# ---------------- Bible Assistant ----------------
class TestBibleAssistant:
    def test_question_mode(self):
        r = requests.post(
            f"{API}/bible-assistant",
            json={"mode": "question", "input": "What does Romans 8:28 mean?"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("mode") == "question"
        assert isinstance(body.get("response"), str) and len(body["response"]) > 50

    def test_devotional_mode(self):
        r = requests.post(
            f"{API}/bible-assistant",
            json={"mode": "devotional", "input": "John 3:16"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("mode") == "devotional"
        assert isinstance(body.get("response"), str) and len(body["response"]) > 50


# ---------------- Reactions ----------------
class TestReactions:
    def test_react_then_get_counts(self):
        vid = f"test-verse-{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/react-to-verse",
            json={"verse_id": vid, "reaction": "pray"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Spec uses 'amen' but server only accepts pray/love/fire/insight.
        assert body["verse_id"] == vid
        assert body["reaction"] == "pray"
        assert body["count"] == 1

        r2 = requests.get(
            f"{API}/get-reaction-counts",
            params={"verse_id": vid},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200
        counts = r2.json()["counts"]
        assert counts == {"pray": 1, "love": 0, "fire": 0, "insight": 0}

    def test_amen_rejected_400(self):
        """The review spec used 'amen' but server.py validates against
        {pray, love, fire, insight}. Document that 'amen' is rejected so the
        main agent can decide whether to add it as an alias."""
        r = requests.post(
            f"{API}/react-to-verse",
            json={"verse_id": "test-verse-1", "reaction": "amen"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400


# ---------------- Reflections CRUD owner scoping (P0 cross-user-leak fix) ----------------
class TestReflectionsOwnerScoping:
    GUEST_A = f"test-guest-A-{uuid.uuid4().hex[:8]}"
    GUEST_B = f"test-guest-B-{uuid.uuid4().hex[:8]}"
    id_A = None

    def _hdr(self, gid):
        return {"Content-Type": "application/json", "X-Guest-Id": gid}

    def test_a_guest_a_create(self):
        r = requests.post(
            f"{API}/reflections",
            json={"text": "guest A note", "emotion": "calm"},
            headers=self._hdr(self.GUEST_A),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["text"] == "guest A note"
        assert body["emotion"] == "calm"
        assert "id" in body
        TestReflectionsOwnerScoping.id_A = body["id"]

    def test_b_guest_a_list_contains_id(self):
        r = requests.get(
            f"{API}/reflections",
            headers=self._hdr(self.GUEST_A),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["reflections"]]
        assert self.id_A in ids

    def test_c_guest_b_list_does_not_contain_a(self):
        r = requests.get(
            f"{API}/reflections",
            headers=self._hdr(self.GUEST_B),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["reflections"]]
        assert self.id_A not in ids, "CROSS-USER LEAK — guest B sees guest A's reflection"

    def test_d_guest_a_can_update(self):
        r = requests.put(
            f"{API}/reflections/{self.id_A}",
            json={"text": "updated"},
            headers=self._hdr(self.GUEST_A),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["text"] == "updated"

    def test_e_guest_b_cannot_update_returns_404(self):
        r = requests.put(
            f"{API}/reflections/{self.id_A}",
            json={"text": "hacked"},
            headers=self._hdr(self.GUEST_B),
            timeout=TIMEOUT,
        )
        # Spec accepts 403 OR 404. Server returns 404 deliberately to avoid
        # leaking existence of foreign ids.
        assert r.status_code in (403, 404), r.text

    def test_f_guest_a_can_delete(self):
        r = requests.delete(
            f"{API}/reflections/{self.id_A}",
            headers=self._hdr(self.GUEST_A),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json() == {"deleted": True, "id": self.id_A}

    def test_g_no_header_returns_401(self):
        r = requests.get(f"{API}/reflections", timeout=TIMEOUT)
        assert r.status_code == 401


# ---------------- Auth regression ----------------
class TestAuthRegression:
    def test_me_without_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", timeout=TIMEOUT)
        assert r.status_code == 401

    def test_register_and_me(self):
        email = f"backend_test_{uuid.uuid4().hex[:8]}@prayersloft-qa.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"email": email, "password": "TestPass123!"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # Token field may be access_token / token / accessToken — be flexible.
        token = (
            body.get("access_token")
            or body.get("accessToken")
            or body.get("token")
            or (body.get("tokens") or {}).get("access_token")
        )
        assert token, f"No access token in register response: {body}"

        me = requests.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT,
        )
        assert me.status_code == 200, me.text
        me_body = me.json()
        # Should reflect the registered email somewhere in the payload.
        flat = str(me_body).lower()
        assert email.lower() in flat, f"Email not echoed in /auth/me: {me_body}"


# ---------------- 404 catch-all ----------------
def test_unknown_route_returns_404():
    r = requests.get(f"{API}/nonexistent-route", timeout=10)
    assert r.status_code == 404
