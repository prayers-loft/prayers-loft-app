"""
Phase 2 auth + migration deep health pytest suite for Prayers Loft.

Covers:
  - /api/auth/register   (success + duplicate)
  - /api/auth/login      (success + wrong pw 401 + 429 brute-force)
  - /api/auth/me         (200 + 401 missing + 401 after logout)
  - /api/auth/refresh    (rotation + reuse revoke)
  - /api/auth/logout     (idempotent)
  - /api/auth/google     (invalid session 401)
  - /api/auth/apple      (503 feature-flag)
  - /api/account/migrate-guest  (insert + idempotent replay + cross-user 409)
  - /api/account/saved-prayers  (read-back after migration)
  - Account linking by email (email user + later google with same email reuses user_id; google with new email creates separate user)
  - Anonymous regressions: /prayer-request, /daily-verse, /reflections (no auth required)
"""

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------------- helpers ----------------
def _unique_email(tag: str = "user") -> str:
    # Avoid reserved TLDs (.test/.example/.invalid/.localhost) which pydantic EmailStr rejects.
    return f"TEST_{tag}_{uuid.uuid4().hex[:10]}@prayersloft-qa.com"


def _register(email: str, password: str = "TestPass123!", name: str = "Test User"):
    return requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=15,
    )


def _login(email: str, password: str):
    return requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )


def _auth_headers(access_token: str):
    return {"Authorization": f"Bearer {access_token}"}


# ---------------- /auth/register ----------------
class TestRegister:
    def test_register_success(self):
        email = _unique_email("reg")
        r = _register(email)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user" in data and "tokens" in data
        # Backend normalizes email to lowercase
        assert data["user"]["email"] == email.lower()
        assert "email" in data["user"]["providers"]
        assert data["tokens"]["access_token"]
        assert data["tokens"]["refresh_token"]
        assert data["tokens"]["token_type"] == "bearer"

    def test_register_duplicate_returns_400(self):
        email = _unique_email("dup")
        r1 = _register(email)
        assert r1.status_code == 200
        r2 = _register(email)
        assert r2.status_code == 400
        assert "already" in r2.json().get("detail", "").lower()


# ---------------- /auth/login + /auth/me ----------------
class TestLoginAndMe:
    def test_login_success_and_me(self):
        email = _unique_email("login")
        pw = "ValidPass123!"
        r = _register(email, pw)
        assert r.status_code == 200

        rl = _login(email, pw)
        assert rl.status_code == 200, rl.text
        tokens = rl.json()["tokens"]

        me = requests.get(f"{API}/auth/me", headers=_auth_headers(tokens["access_token"]), timeout=15)
        assert me.status_code == 200
        assert me.json()["email"] == email.lower()
        assert "email" in me.json()["providers"]

    def test_me_without_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code in (401, 403)  # HTTPBearer auto_error=False -> 401

    def test_me_with_garbage_token_returns_401(self):
        r = requests.get(
            f"{API}/auth/me",
            headers={"Authorization": "Bearer not.a.real.token"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_login_wrong_password_returns_401(self):
        email = _unique_email("wrongpw")
        _register(email, "GoodPass123!")
        r = _login(email, "BadPass123!")
        assert r.status_code == 401

    def test_login_brute_force_returns_429(self):
        email = _unique_email("brute")
        _register(email, "GoodPass123!")
        # 5 failures should trigger 429 on the 6th
        statuses = []
        for _ in range(6):
            r = _login(email, "wrong-pw")
            statuses.append(r.status_code)
        # At least one 429 should appear within 6 attempts
        assert 429 in statuses, f"Expected 429 in attempts, got {statuses}"


# ---------------- /auth/refresh ----------------
class TestRefresh:
    def test_refresh_rotation_and_reuse_revoke(self):
        email = _unique_email("ref")
        r = _register(email)
        tokens = r.json()["tokens"]
        old_refresh = tokens["refresh_token"]

        # rotate
        rr = requests.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh}, timeout=15)
        assert rr.status_code == 200, rr.text
        new_tokens = rr.json()
        assert new_tokens["refresh_token"] != old_refresh
        assert new_tokens["access_token"]

        # new refresh works
        rr2 = requests.post(
            f"{API}/auth/refresh", json={"refresh_token": new_tokens["refresh_token"]}, timeout=15
        )
        assert rr2.status_code == 200

        # reusing old refresh fails AND should revoke the whole session
        reuse = requests.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh}, timeout=15)
        assert reuse.status_code == 401

        # subsequent attempts on the newer refresh should also fail (session-wide revoke)
        after = requests.post(
            f"{API}/auth/refresh",
            json={"refresh_token": new_tokens["refresh_token"]},
            timeout=15,
        )
        assert after.status_code == 401


# ---------------- /auth/logout ----------------
class TestLogout:
    def test_logout_revokes_session_and_me_401(self):
        email = _unique_email("logout")
        r = _register(email)
        tokens = r.json()["tokens"]
        access = tokens["access_token"]

        me1 = requests.get(f"{API}/auth/me", headers=_auth_headers(access), timeout=15)
        assert me1.status_code == 200

        lo = requests.post(
            f"{API}/auth/logout", json={"refresh_token": tokens["refresh_token"]}, timeout=15
        )
        assert lo.status_code == 200
        assert lo.json().get("ok") is True

        me2 = requests.get(f"{API}/auth/me", headers=_auth_headers(access), timeout=15)
        assert me2.status_code == 401

    def test_logout_without_token_is_idempotent_200(self):
        r = requests.post(f"{API}/auth/logout", json={}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------------- /auth/google (error path) ----------------
class TestGoogle:
    def test_google_invalid_session_returns_401(self):
        r = requests.post(
            f"{API}/auth/google",
            json={"session_id": "obviously-not-a-real-session"},
            timeout=20,
        )
        # Emergent returns non-200 -> our handler 401. Provider unreachable -> 502.
        assert r.status_code in (401, 502), r.text


# ---------------- /auth/apple feature flag ----------------
class TestApple:
    def test_apple_disabled_returns_503(self):
        r = requests.post(
            f"{API}/auth/apple",
            json={"identityToken": "TEST.sub123.user@apple.test"},
            timeout=15,
        )
        assert r.status_code == 503


# ---------------- /account/migrate-guest ----------------
class TestMigration:
    def _fresh_user_tokens(self, tag="mig"):
        email = _unique_email(tag)
        r = _register(email)
        return email, r.json()["tokens"]

    def test_migrate_and_replay_idempotent(self):
        _, tokens = self._fresh_user_tokens("migA")
        access = tokens["access_token"]
        guest_id = f"guest-{uuid.uuid4().hex[:12]}"
        # Use unique client_ids per test invocation so prior test runs don't poison the global
        # reflection lookup-by-id (auth.py reflection migration falls back to {id:client_id} OR
        # {user_id,client_id}).
        suffix = uuid.uuid4().hex[:8]
        p1, p2 = f"p1-{suffix}", f"p2-{suffix}"
        r1 = f"r1-{suffix}"
        payload = {
            "guest_id": guest_id,
            "savedPrayers": [
                {"id": p1, "text": "Lord help me", "scripture": "Isaiah 41:10", "createdAt": "2026-01-01T10:00:00Z"},
                {"id": p2, "text": "Thank you", "scripture": None, "createdAt": "2026-01-02T10:00:00Z"},
            ],
            "savedScriptures": [
                {"verse_id": f"PSA.23.1.{suffix}", "savedAt": "2026-01-01T10:00:00Z", "text": "The Lord is my shepherd"}
            ],
            "reflections": [
                {"id": r1, "text": "Today I felt peace", "emotion": "peaceful", "created_at": "2026-01-01T20:00:00Z"}
            ],
            "devotionalHistory": [],
            "preferences": {"theme": "warm"},
            "streakMeta": {"currentStreak": 0, "longestStreak": 0, "lastReflectionDate": None},
        }
        r1 = requests.post(
            f"{API}/account/migrate-guest", json=payload, headers=_auth_headers(access), timeout=20
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["ok"] is True
        assert d1["already_migrated"] is False
        assert d1["migrated_counts"]["prayers"] == 2
        assert d1["migrated_counts"]["scriptures"] == 1
        assert d1["migrated_counts"]["reflections"] == 1

        # Replay same payload — must be already_migrated and preserve counts
        r2 = requests.post(
            f"{API}/account/migrate-guest", json=payload, headers=_auth_headers(access), timeout=20
        )
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["already_migrated"] is True
        assert d2["migrated_counts"]["prayers"] == 2

        # Read-back saved-prayers
        rb = requests.get(
            f"{API}/account/saved-prayers", headers=_auth_headers(access), timeout=15
        )
        assert rb.status_code == 200
        prayers = rb.json()["prayers"]
        ids = sorted(p["client_id"] for p in prayers if p["client_id"] in {p1, p2})
        assert ids == sorted([p1, p2])

    def test_cross_user_guest_id_returns_409(self):
        # User A migrates a guest_id
        _, tokens_a = self._fresh_user_tokens("crossA")
        _, tokens_b = self._fresh_user_tokens("crossB")
        guest_id = f"guest-{uuid.uuid4().hex[:12]}"
        payload = {
            "guest_id": guest_id,
            "savedPrayers": [{"id": "px", "text": "Hello", "createdAt": "2026-01-01T10:00:00Z"}],
            "savedScriptures": [],
            "reflections": [],
            "devotionalHistory": [],
            "preferences": {},
            "streakMeta": {"currentStreak": 0, "longestStreak": 0, "lastReflectionDate": None},
        }
        rA = requests.post(
            f"{API}/account/migrate-guest",
            json=payload,
            headers=_auth_headers(tokens_a["access_token"]),
            timeout=20,
        )
        assert rA.status_code == 200

        # Same guest_id by user B → 409
        rB = requests.post(
            f"{API}/account/migrate-guest",
            json=payload,
            headers=_auth_headers(tokens_b["access_token"]),
            timeout=20,
        )
        assert rB.status_code == 409

    def test_migrate_requires_auth(self):
        r = requests.post(
            f"{API}/account/migrate-guest",
            json={"guest_id": "x", "savedPrayers": [], "savedScriptures": [], "reflections": []},
            timeout=15,
        )
        assert r.status_code in (401, 403)


# ---------------- Account linking by email ----------------
class TestAccountLinking:
    """
    Linking semantics (per backend/auth.py _link_or_create_user):
      - google_sub lookup first; falls back to email lookup; else create new.
      - Two distinct google_subs with different emails => two separate users.
    We cannot stub a real Emergent google session in this environment, so we
    only verify the negative-path code (already covered above) and ensure that
    a second register on the same email is rejected (uniqueness guard).
    """

    def test_email_uniqueness_enforced(self):
        email = _unique_email("link")
        r1 = _register(email)
        assert r1.status_code == 200
        r2 = _register(email)
        assert r2.status_code == 400


# ---------------- Anonymous regression ----------------
class TestAnonymousRegression:
    def test_daily_verse_no_auth(self):
        r = requests.get(f"{API}/daily-verse?local_date=2026-01-15", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "verse" in d and "reference" in d and "verse_id" in d

    def test_prayer_request_no_auth(self):
        r = requests.post(
            f"{API}/prayer-request", json={"message": "I feel anxious about tomorrow"}, timeout=60
        )
        assert r.status_code == 200
        assert "response" in r.json()
        assert len(r.json()["response"]) > 0

    def test_reflection_create_list_no_auth(self):
        rc = requests.post(
            f"{API}/reflections",
            json={"text": "TEST_anon reflection " + uuid.uuid4().hex[:6], "emotion": "calm"},
            timeout=15,
        )
        assert rc.status_code == 200
        rid = rc.json()["id"]

        rl = requests.get(f"{API}/reflections", timeout=15)
        assert rl.status_code == 200
        assert any(x["id"] == rid for x in rl.json()["reflections"])

        # cleanup
        requests.delete(f"{API}/reflections/{rid}", timeout=15)
