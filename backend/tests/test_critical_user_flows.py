"""
Critical user-flow regression suite for Prayers Loft v1.0 TestFlight gate.

Covers 7 flows + the P0 cross-user reflection isolation regression.

P0 EXPECTED FAILURES (xfail) — these document the live bug in
/app/backend/server.py:405-451 where /api/reflections endpoints do NOT scope
by user_id/guest_id. Once the patch lands, these xfails should flip to
unexpected passes (XPASSED) — that is the post-fix verification signal.

Run:
  pytest /app/backend/tests/test_critical_user_flows.py -v \
    --junitxml=/app/test_reports/pytest/pytest_critical_user_flows.xml
"""
from __future__ import annotations

import os
import secrets
import time

import pytest
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "https://prayers-loft.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PASSWORD = "TestPass123!"
HTTP_TIMEOUT = 30
LLM_TIMEOUT = 60  # AI calls can take a while


def _rand_email(tag: str = "e2e") -> str:
    return f"TEST_{tag}_{secrets.token_hex(4)}@prayersloft-qa.com"


def _register(email: str, name: str | None = None) -> dict:
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": PASSWORD, "name": name or "Test User"},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def emergent_llm_available():
    return bool(os.environ.get("EMERGENT_LLM_KEY"))


@pytest.fixture(scope="module")
def user_a():
    """A registered user for ownership tests."""
    email = _rand_email("owner_a")
    data = _register(email, name="User A")
    return {
        "email": email,
        "id": data["user"]["id"],
        "access_token": data["tokens"]["access_token"],
    }


@pytest.fixture(scope="module")
def user_b():
    email = _rand_email("owner_b")
    data = _register(email, name="User B")
    return {
        "email": email,
        "id": data["user"]["id"],
        "access_token": data["tokens"]["access_token"],
    }


# ===========================================================================
# FLOW 1 — SIGNUP
# ===========================================================================
class TestFlow1Signup:
    """POST /api/auth/register — happy + edges."""

    def test_signup_success_returns_jwt_and_user(self, api_client):
        email = _rand_email("signup_ok")
        r = api_client.post(
            f"{API}/auth/register",
            json={"email": email, "password": PASSWORD, "name": "Signup OK"},
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Token shape
        assert "tokens" in body and body["tokens"].get("access_token")
        assert body["tokens"].get("refresh_token")
        # User shape
        u = body["user"]
        assert u["id"] and isinstance(u["id"], str)
        assert u["email"] == email.lower()
        assert "email" in (u.get("providers") or [])
        assert u.get("name") == "Signup OK"

    def test_signup_duplicate_email_returns_400_not_500(self, api_client):
        email = _rand_email("dup")
        _register(email)
        r = api_client.post(
            f"{API}/auth/register",
            json={"email": email, "password": PASSWORD, "name": "Dup"},
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"
        assert r.status_code != 500

    def test_signup_weak_password_rejected(self, api_client):
        # password constraint is min_length=8 (Pydantic). 7-char password → 422.
        r = api_client.post(
            f"{API}/auth/register",
            json={"email": _rand_email("weak"), "password": "short7!", "name": "Weak"},
            timeout=HTTP_TIMEOUT,
        )
        assert 400 <= r.status_code < 500, r.text
        assert r.status_code != 500

    def test_signup_invalid_email_format_rejected(self, api_client):
        r = api_client.post(
            f"{API}/auth/register",
            json={"email": "not-an-email", "password": PASSWORD},
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 422, r.text

    def test_signup_missing_fields_returns_422(self, api_client):
        r = api_client.post(f"{API}/auth/register", json={}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 422


# ===========================================================================
# FLOW 2 — LOGIN
# ===========================================================================
class TestFlow2Login:
    """POST /api/auth/login + GET /api/auth/me."""

    @pytest.fixture(scope="class")
    def fresh_user(self):
        email = _rand_email("login")
        data = _register(email)
        return {"email": email, "id": data["user"]["id"], "token": data["tokens"]["access_token"]}

    def test_login_success_returns_jwt(self, api_client, fresh_user):
        r = api_client.post(
            f"{API}/auth/login",
            json={"email": fresh_user["email"], "password": PASSWORD},
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["tokens"].get("access_token")
        assert body["user"]["id"] == fresh_user["id"]

    def test_login_wrong_password_returns_401(self, api_client, fresh_user):
        r = api_client.post(
            f"{API}/auth/login",
            json={"email": fresh_user["email"], "password": "WrongPass999!"},
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 401, r.text
        assert r.status_code != 500

    def test_login_nonexistent_email_returns_401(self, api_client):
        r = api_client.post(
            f"{API}/auth/login",
            json={"email": _rand_email("ghost"), "password": PASSWORD},
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 401
        assert r.status_code != 500

    def test_me_with_token_returns_user(self, api_client, fresh_user):
        r = api_client.get(
            f"{API}/auth/me",
            headers=_auth_header(fresh_user["token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json()["id"] == fresh_user["id"]

    def test_me_token_persists_across_3_calls(self, api_client, fresh_user):
        for i in range(3):
            r = api_client.get(
                f"{API}/auth/me",
                headers=_auth_header(fresh_user["token"]),
                timeout=HTTP_TIMEOUT,
            )
            assert r.status_code == 200, f"call {i+1} got {r.status_code}: {r.text}"
            assert r.json()["id"] == fresh_user["id"]


# ===========================================================================
# FLOW 3 — GENERATE PRAYER
# ===========================================================================
class TestFlow3GeneratePrayer:
    """POST /api/prayer-request."""

    def test_generate_prayer_happy(self, api_client, emergent_llm_available):
        if not emergent_llm_available:
            pytest.skip("EMERGENT_LLM_KEY not set — skipping AI-dependent test")
        start = time.time()
        r = api_client.post(
            f"{API}/prayer-request",
            json={"message": "a brief prayer for peace"},
            timeout=LLM_TIMEOUT,
        )
        latency = time.time() - start
        assert r.status_code == 200, r.text
        text = r.json().get("response", "")
        assert "VERSE:" in text, f"expected VERSE: marker in response, got: {text[:200]}"
        assert len(text) >= 200, f"response too short ({len(text)} chars)"
        assert latency < 25, f"latency {latency:.1f}s exceeded 25s budget"

    def test_generate_prayer_empty_message_4xx(self, api_client):
        r = api_client.post(
            f"{API}/prayer-request", json={"message": "   "}, timeout=HTTP_TIMEOUT
        )
        assert 400 <= r.status_code < 500, r.text
        assert r.status_code != 500

    def test_generate_prayer_missing_field_422(self, api_client):
        r = api_client.post(f"{API}/prayer-request", json={}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 422

    def test_generate_prayer_oversized_payload_not_500(self, api_client):
        # >10KB message — must not 500. Server should accept (returns 200) or
        # reject with 4xx, but never crash.
        big = "peace " * 3000  # ~18KB
        r = api_client.post(
            f"{API}/prayer-request", json={"message": big}, timeout=LLM_TIMEOUT
        )
        assert r.status_code != 500, f"server 500ed on oversized payload: {r.text[:200]}"


# ===========================================================================
# FLOW 4 — DEVOTIONAL LOAD
# ===========================================================================
class TestFlow4DevotionalLoad:
    """GET /api/daily-verse."""

    def test_daily_verse_default(self, api_client):
        r = api_client.get(f"{API}/daily-verse", timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("verse") and isinstance(body["verse"], str)
        assert body.get("reference")
        assert body.get("verse_id")
        assert body.get("devotional")

    def test_daily_verse_with_tz_chicago(self, api_client):
        r = api_client.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-09", "tz": "America/Chicago"},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("local_date") == "2026-06-09"

    def test_daily_verse_with_tz_kolkata(self, api_client):
        r = api_client.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-09", "tz": "Asia/Kolkata"},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_daily_verse_caching_same_date_same_verse(self, api_client):
        # Same local_date should be deterministic across calls (caching contract).
        params = {"local_date": "2026-06-09", "tz": "America/Chicago"}
        r1 = api_client.get(f"{API}/daily-verse", params=params, timeout=LLM_TIMEOUT)
        r2 = api_client.get(f"{API}/daily-verse", params=params, timeout=LLM_TIMEOUT)
        assert r1.status_code == 200 and r2.status_code == 200
        b1, b2 = r1.json(), r2.json()
        assert b1["verse_id"] == b2["verse_id"]
        assert b1["reference"] == b2["reference"]
        assert b1["devotional"] == b2["devotional"], "devotional cache not honored"

    def test_daily_verse_invalid_tz_handled_gracefully(self, api_client):
        r = api_client.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-09", "tz": "Not/A/Zone"},
            timeout=LLM_TIMEOUT,
        )
        # tz is stored for telemetry only; should not affect verse computation.
        assert r.status_code == 200, r.text
        assert r.status_code != 500


# ===========================================================================
# FLOW 5 — CREATE REFLECTION
# ===========================================================================
class TestFlow5CreateReflection:
    """POST /api/reflections."""

    def test_create_reflection_success(self, api_client, user_a):
        r = api_client.post(
            f"{API}/reflections",
            json={"text": "TEST_critical_flow_5 reflection content"},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("id")
        assert body.get("created_at")
        assert body.get("updated_at")
        assert body.get("text") == "TEST_critical_flow_5 reflection content"

    def test_create_reflection_empty_text_4xx(self, api_client, user_a):
        r = api_client.post(
            f"{API}/reflections",
            json={"text": "   "},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert 400 <= r.status_code < 500
        assert r.status_code != 500

    def test_create_reflection_missing_text_422(self, api_client, user_a):
        r = api_client.post(
            f"{API}/reflections",
            json={},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 422

    def test_created_reflection_is_tagged_with_user_id(self, api_client, user_a):
        """
        Server contract: a reflection created via an authenticated request
        MUST carry the caller's user_id so subsequent reads can scope properly.

        Verification: create as User A, then list reflections — the new item
        should include `user_id == user_a.id`. Current code at
        /app/backend/server.py:405-420 ignores auth entirely and does not set
        user_id, so this test is EXPECTED TO FAIL until the patch lands.
        """
        r = api_client.post(
            f"{API}/reflections",
            json={"text": "TEST_ownership_tag_check"},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200
        created = r.json()
        # The endpoint should echo back the tagging field on the created object.
        assert created.get("user_id") == user_a["id"], (
            f"created reflection missing user_id tag: {created}"
        )


# ===========================================================================
# FLOW 6 — EDIT REFLECTION
# ===========================================================================
class TestFlow6EditReflection:
    """PUT /api/reflections/{id}."""

    @pytest.fixture
    def reflection_owned_by_a(self, api_client, user_a):
        r = api_client.post(
            f"{API}/reflections",
            json={"text": "TEST_edit_flow_original"},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200
        return r.json()

    def test_edit_reflection_success(self, api_client, user_a, reflection_owned_by_a):
        rid = reflection_owned_by_a["id"]
        r = api_client.put(
            f"{API}/reflections/{rid}",
            json={"text": "TEST_edit_flow_UPDATED"},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("text") == "TEST_edit_flow_UPDATED"

    def test_edit_nonexistent_returns_404(self, api_client, user_a):
        r = api_client.put(
            f"{API}/reflections/does-not-exist-{secrets.token_hex(4)}",
            json={"text": "ghost"},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 404, r.text

    def test_edit_empty_body_not_500(self, api_client, user_a, reflection_owned_by_a):
        rid = reflection_owned_by_a["id"]
        r = api_client.put(
            f"{API}/reflections/{rid}",
            json={},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        # Acceptable: 200 (no-op), 400, or 422. NEVER 500.
        assert r.status_code != 500, r.text
        assert r.status_code in (200, 400, 422), r.text

    def test_user_b_cannot_edit_user_a_reflection(
        self, api_client, user_a, user_b, reflection_owned_by_a
    ):
        rid = reflection_owned_by_a["id"]
        r = api_client.put(
            f"{API}/reflections/{rid}",
            json={"text": "TEST_hijack_by_user_b"},
            headers=_auth_header(user_b["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        # Must refuse cross-user edit.
        assert r.status_code in (403, 404), (
            f"cross-user edit was allowed (got {r.status_code}): {r.text}"
        )


# ===========================================================================
# FLOW 7 — DELETE REFLECTION
# ===========================================================================
class TestFlow7DeleteReflection:
    """DELETE /api/reflections/{id}."""

    @pytest.fixture
    def reflection_owned_by_a(self, api_client, user_a):
        r = api_client.post(
            f"{API}/reflections",
            json={"text": "TEST_delete_flow_target"},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200
        return r.json()

    def test_delete_reflection_success(self, api_client, user_a, reflection_owned_by_a):
        rid = reflection_owned_by_a["id"]
        r = api_client.delete(
            f"{API}/reflections/{rid}",
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code in (200, 204), r.text
        # Verify gone
        r2 = api_client.delete(
            f"{API}/reflections/{rid}",
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r2.status_code == 404

    def test_delete_nonexistent_returns_404(self, api_client, user_a):
        r = api_client.delete(
            f"{API}/reflections/missing-{secrets.token_hex(4)}",
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 404

    def test_user_b_cannot_delete_user_a_reflection(
        self, api_client, user_a, user_b, reflection_owned_by_a
    ):
        rid = reflection_owned_by_a["id"]
        r = api_client.delete(
            f"{API}/reflections/{rid}",
            headers=_auth_header(user_b["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code in (403, 404), (
            f"cross-user delete was allowed (got {r.status_code})"
        )


# ===========================================================================
# P0 REGRESSION — cross-user reflection isolation
# ===========================================================================
class TestP0CrossUserIsolation:
    """
    Dedicated P0 regression: User A's reflections must NOT appear in
    User B's GET /api/reflections response.

    Current /api/reflections (server.py:423-429) runs `db.reflections.find({})`
    with no filter → ALL reflections returned to ALL users. This test is
    EXPECTED TO FAIL right now; that failure is the baseline the user wanted
    documented before the fix ships.
    """

    def test_user_b_list_does_not_contain_user_a_reflection(
        self, api_client, user_a, user_b
    ):
        # Step 1: User A creates a reflection
        unique_marker = f"TEST_P0_isolation_marker_{secrets.token_hex(6)}"
        r = api_client.post(
            f"{API}/reflections",
            json={"text": unique_marker},
            headers=_auth_header(user_a["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r.status_code == 200
        a_reflection_id = r.json()["id"]

        # Step 2: User B lists their reflections
        r2 = api_client.get(
            f"{API}/reflections",
            headers=_auth_header(user_b["access_token"]),
            timeout=HTTP_TIMEOUT,
        )
        assert r2.status_code == 200
        items = r2.json().get("reflections", [])

        # Step 3: User B's list MUST NOT include User A's reflection
        ids_visible_to_b = [item.get("id") for item in items]
        texts_visible_to_b = [item.get("text") for item in items]
        assert a_reflection_id not in ids_visible_to_b, (
            f"P0 LEAK: User A reflection id {a_reflection_id} visible to User B"
        )
        assert unique_marker not in texts_visible_to_b, (
            f"P0 LEAK: User A reflection text visible to User B"
        )
