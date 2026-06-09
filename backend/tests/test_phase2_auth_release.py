"""Phase 2 Auth + Release-Readiness Tests for TestFlight v1.0 (build 6).

Covers the 18-point checklist from the test request:
  - Auth: register, login, me (valid + invalid + malformed), duplicate-email
  - Apple Sign-In: 503 when flagged off (not 500)
  - Token persistence across multiple /auth/me calls
  - Error handling: malformed JSON / empty body / oversized body to /prayer-request
  - CORS: backend allows Expo frontend origin
  - Guest migration idempotency (/api/account/migrate-guest)
  - Reflections CRUD via authenticated session
"""
import os
import uuid
import time
import json
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 90


def _rand_email() -> str:
    return f"TEST_release_{uuid.uuid4().hex[:10]}@prayersloft-qa.com"


# ------------------------ Fixtures ------------------------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    # Provide a stable per-session guest_id so reflection (and other
    # owner-scoped) endpoints accept the request. Reflections are now
    # ownership-scoped per the v1.0 P0 patch — see
    # backend/server.py current_owner() — and need either Bearer auth or
    # X-Guest-Id. These tests pre-date that change; the header just
    # gives them an owner namespace so existing CRUD assertions still hold.
    sess.headers.update({"X-Guest-Id": f"test-phase2-{_rand_email().split('@')[0]}"})
    yield sess
    sess.close()


@pytest.fixture(scope="module")
def user_creds():
    return {"email": _rand_email(), "password": "TestPass123!", "name": "Release QA"}


@pytest.fixture(scope="module")
def auth_tokens(s, user_creds):
    r = s.post(f"{API}/auth/register", json=user_creds, timeout=TIMEOUT)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    assert "user" in body and "tokens" in body
    assert "access_token" in body["tokens"]
    return body["tokens"]


# ------------------------ 1. Health ------------------------
def test_01_health(s):
    r = s.get(f"{API}/", timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert body.get("message") == "Prayers Loft API"


# ------------------------ 2. Signup ------------------------
def test_02_signup_returns_token_and_user(s, user_creds, auth_tokens):
    # Fixture already performed registration; verify shape.
    assert auth_tokens["access_token"]
    assert auth_tokens.get("refresh_token")


# ------------------------ 3. Login ------------------------
def test_03_login_with_signup_credentials(s, user_creds):
    r = s.post(
        f"{API}/auth/login",
        json={"email": user_creds["email"], "password": user_creds["password"]},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tokens"]["access_token"]
    assert body["user"]["email"].lower() == user_creds["email"].lower()


# ------------------------ 4. Token validation ------------------------
class TestAuthMe:
    def test_me_with_valid_token(self, s, auth_tokens):
        r = s.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "id" in body
        assert "email" in body
        assert "_id" not in body  # no Mongo id leak

    def test_me_with_invalid_token_401(self, s):
        r = s.get(
            f"{API}/auth/me",
            headers={"Authorization": "Bearer not-a-real-token"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_me_with_malformed_bearer_401(self, s):
        # No "Bearer " prefix at all
        r = s.get(
            f"{API}/auth/me",
            headers={"Authorization": "garbage.value.here"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"

    def test_me_missing_header_401(self, s):
        r = s.get(f"{API}/auth/me", timeout=TIMEOUT)
        # FastAPI HTTPBearer returns 403 if header missing — both 401 and 403 are acceptable
        # for "not authenticated", but never 500.
        assert r.status_code in (401, 403), r.status_code

    def test_me_with_random_jwt_shaped_string_401(self, s):
        bogus = "eyJ" + "a" * 30 + "." + "b" * 30 + "." + "c" * 30
        r = s.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {bogus}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401


# ------------------------ 5. Duplicate email ------------------------
def test_05_duplicate_email_rejected(s, user_creds):
    r = s.post(f"{API}/auth/register", json=user_creds, timeout=TIMEOUT)
    assert 400 <= r.status_code < 500, f"expected 4xx, got {r.status_code}: {r.text}"
    assert r.status_code != 500


# ------------------------ 12. Token persistence (multiple calls) ------------------------
def test_12_token_persistence_multiple_calls(s, auth_tokens):
    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    for i in range(5):
        r = s.get(f"{API}/auth/me", headers=headers, timeout=TIMEOUT)
        assert r.status_code == 200, f"call {i}: {r.status_code} {r.text}"
        time.sleep(0.1)


# ------------------------ 6/7. Prayer generation + follow-up (AI) ------------------------
class TestPrayerAI:
    def test_prayer_request(self, s):
        r = s.post(
            f"{API}/prayer-request",
            json={"message": "I'm anxious about a difficult conversation at work tomorrow."},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "response" in data and isinstance(data["response"], str)
        assert len(data["response"]) > 50

    def test_prayer_follow_up(self, s):
        r = s.post(
            f"{API}/prayer-follow-up",
            json={
                "message": "I'm anxious about a difficult conversation at work tomorrow.",
                "consent": True,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "prayer" in data and isinstance(data["prayer"], str)
        assert len(data["prayer"]) > 30


# ------------------------ 8. Daily devotional (+ tz) ------------------------
class TestDailyVerse:
    def test_default(self, s):
        r = s.get(f"{API}/daily-verse", timeout=TIMEOUT)
        assert r.status_code == 200
        for k in ("verse", "reference", "verse_id", "bible_link", "devotional", "local_date"):
            assert r.json().get(k)

    def test_with_local_date_and_tz(self, s):
        r = s.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-01-20", "tz": "America/Chicago"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["local_date"] == "2026-01-20"
        assert body["verse_id"]


# ------------------------ 9. Reaction counts ------------------------
def test_09_reaction_counts_known_verse(s):
    r = s.get(f"{API}/get-reaction-counts", params={"verse_id": "PSA.34.18"}, timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert "counts" in body
    assert set(body["counts"].keys()) == {"pray", "love", "fire", "insight"}


# ------------------------ 10. Reflections CRUD ------------------------
class TestReflectionsCRUD:
    rid: str = ""

    def test_create(self, s):
        r = s.post(
            f"{API}/reflections",
            json={"text": "TEST_release_reflection", "emotion": "Hope"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["text"] == "TEST_release_reflection"
        assert "_id" not in body
        TestReflectionsCRUD.rid = body["id"]

    def test_list(self, s):
        r = s.get(f"{API}/reflections", timeout=TIMEOUT)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["reflections"]]
        assert TestReflectionsCRUD.rid in ids

    def test_update(self, s):
        r = s.put(
            f"{API}/reflections/{TestReflectionsCRUD.rid}",
            json={"text": "TEST_release_updated", "emotion": "Joy"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json()["text"] == "TEST_release_updated"

    def test_delete(self, s):
        r = s.delete(f"{API}/reflections/{TestReflectionsCRUD.rid}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json() == {"deleted": True, "id": TestReflectionsCRUD.rid}


# ------------------------ 11. Theological Q&A ------------------------
def test_11_theological_question(s):
    r = s.post(
        f"{API}/theological-question",
        json={
            "question": "What does it mean to trust God in uncertainty?",
            "verse": "Proverbs 3:5-6",
            "style": "Devotional",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["response"]) > 50


# ------------------------ 13. Error handling on /prayer-request ------------------------
class TestPrayerErrorHandling:
    """Defensive guarantees: malformed/empty/oversized never produce a 500."""

    def test_malformed_json_body(self, s):
        r = s.post(
            f"{API}/prayer-request",
            data="this is not json",
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text}"

    def test_empty_body(self, s):
        r = s.post(
            f"{API}/prayer-request",
            data="",
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (400, 422), r.status_code

    def test_missing_required_field(self, s):
        r = s.post(f"{API}/prayer-request", json={}, timeout=TIMEOUT)
        assert r.status_code == 422

    def test_empty_message_whitespace(self, s):
        r = s.post(f"{API}/prayer-request", json={"message": "   "}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_oversized_body(self, s):
        # 200KB payload — server should reject cleanly or process; never 500.
        huge = "x" * 200_000
        r = s.post(f"{API}/prayer-request", json={"message": huge}, timeout=TIMEOUT)
        assert r.status_code != 500, f"500 on oversized payload: {r.text[:200]}"
        # Acceptable: 200 (processed), 413 (too large), or 422 (validation)
        assert r.status_code in (200, 400, 413, 422), r.status_code

    def test_wrong_content_type(self, s):
        r = s.post(
            f"{API}/prayer-request",
            data="message=hi",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT,
        )
        assert r.status_code != 500


# ------------------------ 14. CORS ------------------------
def test_14_cors_allows_expo_origin(s):
    # Preflight from the production preview origin
    r = s.options(
        f"{API}/auth/login",
        headers={
            "Origin": "https://prayers-loft.preview.emergentagent.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type, Authorization",
        },
        timeout=TIMEOUT,
    )
    # Should be 200 or 204
    assert r.status_code in (200, 204), r.status_code
    aco = r.headers.get("access-control-allow-origin", "")
    assert aco in ("*", "https://prayers-loft.preview.emergentagent.com"), aco


def test_14b_cors_localhost_origin(s):
    r = s.options(
        f"{API}/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code in (200, 204)
    assert r.headers.get("access-control-allow-origin") in ("*", "http://localhost:3000")


# ------------------------ 15. Apple Sign-In feature-flagged off ------------------------
class TestAppleSignIn:
    def test_apple_returns_503_not_500(self, s):
        r = s.post(
            f"{API}/auth/apple",
            json={"identityToken": "fake.token.here", "nonce": "abc"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 503, f"expected 503 (feature off), got {r.status_code}: {r.text}"
        assert "not enabled" in r.text.lower() or "apple" in r.text.lower()

    def test_apple_missing_field_422_not_500(self, s):
        r = s.post(f"{API}/auth/apple", json={}, timeout=TIMEOUT)
        # Validation happens before feature flag? Either order is acceptable, but never 500.
        assert r.status_code in (422, 503), r.status_code


# ------------------------ 16. Guest migration idempotency ------------------------
class TestGuestMigration:
    """
    /api/account/migrate-guest expects Bearer auth + payload.
    Calling twice with same guest_id must NOT double-migrate.
    """

    def _payload(self, guest_id):
        return {
            "guest_id": guest_id,
            "savedPrayers": [
                {
                    "id": f"clientp-{uuid.uuid4().hex[:8]}",
                    "text": "TEST_guest prayer for release verification",
                    "scripture": "Psalm 34:18",
                    "createdAt": "2026-01-10T10:00:00Z",
                }
            ],
            "savedScriptures": [
                {"verse_id": "PSA.34.18", "savedAt": "2026-01-10T10:00:00Z", "text": "The Lord is near to the brokenhearted."}
            ],
            "reflections": [
                {"text": "TEST_guest reflection", "emotion": "Hope"}
            ],
            "devotionalHistory": [],
            "preferences": {"theme": "candlelight"},
            "streakMeta": {"currentStreak": 1, "longestStreak": 1, "lastReflectionDate": "2026-01-10"},
        }

    def test_first_migration_succeeds(self, s, auth_tokens):
        guest_id = f"guest-{uuid.uuid4().hex[:12]}"
        headers = {
            "Authorization": f"Bearer {auth_tokens['access_token']}",
            "Content-Type": "application/json",
        }
        payload = self._payload(guest_id)
        r1 = s.post(f"{API}/account/migrate-guest", json=payload, headers=headers, timeout=TIMEOUT)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["ok"] is True
        assert d1["migrated_counts"]["prayers"] >= 1

        # Stash on the class for idempotency test
        TestGuestMigration._gid = guest_id
        TestGuestMigration._payload_cached = payload
        TestGuestMigration._first_counts = d1["migrated_counts"]

    def test_second_migration_is_idempotent(self, s, auth_tokens):
        """Replay must set already_migrated=True and echo cached first-pass counts.
        Data must NOT be double-inserted (verified via saved-prayers count).
        """
        assert getattr(TestGuestMigration, "_gid", None), "first migration test must run first"
        headers = {
            "Authorization": f"Bearer {auth_tokens['access_token']}",
            "Content-Type": "application/json",
        }

        # Read saved-prayers count BEFORE replay
        r_before = s.get(f"{API}/account/saved-prayers", headers=headers, timeout=TIMEOUT)
        assert r_before.status_code == 200, r_before.text
        before_count = len(r_before.json().get("prayers", r_before.json().get("saved_prayers", [])))

        r2 = s.post(
            f"{API}/account/migrate-guest",
            json=TestGuestMigration._payload_cached,
            headers=headers,
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["ok"] is True
        # Idempotency marker MUST be set on replay
        assert d2["already_migrated"] is True, f"expected already_migrated=True on replay: {d2}"
        # Counts on replay should equal counts on first pass (cached)
        assert d2["migrated_counts"] == TestGuestMigration._first_counts, (
            f"replay counts diverged from first-pass: {d2['migrated_counts']} vs "
            f"{TestGuestMigration._first_counts}"
        )

        # Read saved-prayers count AFTER replay — must be unchanged
        r_after = s.get(f"{API}/account/saved-prayers", headers=headers, timeout=TIMEOUT)
        assert r_after.status_code == 200
        after_count = len(r_after.json().get("prayers", r_after.json().get("saved_prayers", [])))
        assert after_count == before_count, (
            f"replay double-inserted prayers: before={before_count} after={after_count}"
        )

    def test_migrate_without_auth_401(self, s):
        r = s.post(
            f"{API}/account/migrate-guest",
            json={"guest_id": "anything"},
            timeout=TIMEOUT,
        )
        assert r.status_code in (401, 403), r.status_code

    def test_migrate_empty_guest_id_400(self, s, auth_tokens):
        headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
        r = s.post(
            f"{API}/account/migrate-guest",
            json={"guest_id": "   "},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, r.status_code
