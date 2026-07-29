"""Backend tests for the canonical-web-v1 reading plan runtime.

Covers all acceptance criteria for Phase 5 backend integration:
  1. First-time signed-in user receives Day 1.
  2. Repeat requests on the same local day return the same day.
  3. Next local day advances by exactly one.
  4. Skipped calendar days still advance only ONE reading.
  5. Invalid stored progress falls back safely.
  6. Day 995 does not advance beyond the plan.
  7. Two users maintain independent progress.
  8. Asset loading is cached (loader parses the artifact only once).

All tests hit http://localhost:8001 for determinism.
"""
from __future__ import annotations

import os
import sys
import uuid
import time
import pytest
import requests

# Make sure the loader is importable for the caching test.
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE_URL = "http://localhost:8001"
API = f"{BASE_URL}/api"
TIMEOUT = 30


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _register_user() -> tuple[str, str]:
    """Create a fresh signed-in user; return (email, bearer_token)."""
    email = f"canonplan_{uuid.uuid4().hex[:10]}@prayersloft-qa.com"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "TestPass123!"},
        timeout=TIMEOUT,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    body = r.json()
    token = (
        body.get("access_token")
        or body.get("accessToken")
        or (body.get("tokens") or {}).get("access_token")
    )
    assert token, f"no token in {body}"
    return email, token


def _get_daily(token: str | None, local_date: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.get(
        f"{API}/daily-verse",
        params={"local_date": local_date},
        headers=headers,
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"daily-verse failed: {r.status_code} {r.text}"
    return r.json()


def _complete_daily(token: str | None, day: int, local_date: str) -> tuple[int, dict]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.post(
        f"{API}/daily-verse/complete",
        headers=headers,
        json={"day": day, "local_date": local_date},
        timeout=TIMEOUT,
    )
    return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else {})


def _get_mongo_progress(email: str) -> dict | None:
    """Peek into the DB from the test to inspect the stored progress row.

    Uses the same DB the running backend is connected to.
    """
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    async def _run():
        c = AsyncIOMotorClient(mongo_url)
        db = c[db_name]
        # Find the user's id from the users collection by email
        u = await db.users.find_one({"email": email})
        if not u:
            return None
        owner_key = f"user:{u.get('id') or u.get('_id')}"
        doc = await db.reading_progress.find_one(
            {"owner_key": owner_key, "plan_id": "canonical-web-v1"},
            {"_id": 0},
        )
        c.close()
        return doc

    return asyncio.get_event_loop().run_until_complete(_run()) if os.name != "nt" else asyncio.new_event_loop().run_until_complete(_run())


def _set_progress(email: str, current_day: int, last_view_local_date: str) -> None:
    """Directly overwrite reading_progress for a user — used to simulate
    previously-viewed state without waiting for real time to pass."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    async def _run():
        c = AsyncIOMotorClient(mongo_url)
        db = c[db_name]
        u = await db.users.find_one({"email": email})
        assert u, f"user not found: {email}"
        owner_key = f"user:{u.get('id') or u.get('_id')}"
        await db.reading_progress.update_one(
            {"owner_key": owner_key, "plan_id": "canonical-web-v1"},
            {"$set": {
                "owner_key": owner_key,
                "plan_id": "canonical-web-v1",
                "current_day": current_day,
                "last_completed_date": last_view_local_date,
                "updated_at": "2026-07-28T00:00:00Z",
                "created_at": "2026-07-28T00:00:00Z",
            }},
            upsert=True,
        )
        c.close()

    asyncio.new_event_loop().run_until_complete(_run())


# --------------------------------------------------------------------------
# Basic payload contract
# --------------------------------------------------------------------------

class TestPayloadContract:
    def test_daily_verse_returns_canonical_shape(self):
        _, token = _register_user()
        body = _get_daily(token, "2026-01-01")
        # New canonical fields
        assert body["plan_id"] == "canonical-web-v1"
        assert body["plan_version"] == "1.0.0"
        assert body["day"] == 1
        assert body["total_days"] == 995
        assert body["section"] == "Pentateuch"
        assert body["book"] == "GEN"
        assert body["book_name"] == "Genesis"
        assert body["reference"].startswith("Genesis")
        assert isinstance(body["passage"], list) and len(body["passage"]) > 0
        assert body["passage"][0]["text"], "passage verses must have text"
        assert isinstance(body["key_verse"], dict)
        assert body["key_verse"]["text"], "key verse must have text"
        assert isinstance(body["summary"], str) and 8 <= len(body["summary"].split()) <= 60
        # Progress metadata for signed-in user
        assert body["progress"] is not None
        assert body["progress"]["current_day"] == 1
        # Back-compat legacy fields still present
        assert body["verse"], "legacy 'verse' field must exist"
        assert body["reference"], "legacy 'reference' field must exist"
        assert body["verse_id"], "legacy 'verse_id' field must exist"
        assert body["bible_link"].startswith("https://www.bible.com/"), body["bible_link"]
        assert body["devotional"] == ""
        assert body["devotional_structured"] is None


# --------------------------------------------------------------------------
# Progression contract
# --------------------------------------------------------------------------

class TestSelfPacedProgression:
    """Progress advances only on explicit completion — never on view."""

    def test_first_time_signed_in_user_receives_day_1(self):
        _, token = _register_user()
        body = _get_daily(token, "2026-06-01")
        assert body["day"] == 1
        assert body["progress"]["current_day"] == 1
        # last_completed_date must be None on first view (no auto-complete).
        assert body["progress"]["last_completed_date"] is None

    def test_get_never_advances_across_days(self):
        _, token = _register_user()
        d0 = _get_daily(token, "2026-06-01")
        d1 = _get_daily(token, "2026-06-02")
        d2 = _get_daily(token, "2026-06-10")
        d3 = _get_daily(token, "2027-01-15")
        # Every GET must return the same current day (Day 1) because the
        # user has NOT explicitly completed anything.
        assert d0["day"] == d1["day"] == d2["day"] == d3["day"] == 1
        for d in (d0, d1, d2, d3):
            assert d["progress"]["last_completed_date"] is None

    def test_repeat_get_same_day_never_advances(self):
        _, token = _register_user()
        a = _get_daily(token, "2026-06-01")
        b = _get_daily(token, "2026-06-01")
        c = _get_daily(token, "2026-06-01")
        assert a["day"] == b["day"] == c["day"] == 1

    def test_complete_advances_by_exactly_one(self):
        _, token = _register_user()
        assert _get_daily(token, "2026-06-01")["day"] == 1
        status, body = _complete_daily(token, day=1, local_date="2026-06-01")
        assert status == 200 and body["status"] == "advanced"
        assert body["current_day"] == 2
        # Subsequent GET reflects the new current day.
        assert _get_daily(token, "2026-06-01")["day"] == 2

    def test_repeated_complete_same_day_is_idempotent(self):
        _, token = _register_user()
        _get_daily(token, "2026-06-01")
        first = _complete_daily(token, day=1, local_date="2026-06-01")
        second = _complete_daily(token, day=1, local_date="2026-06-01")
        third = _complete_daily(token, day=1, local_date="2026-06-01")
        # First advances 1→2 with status advanced; second/third are stale
        # (submitted day 1 no longer equals current day 2) OR
        # already_completed — either way current_day must not exceed 2.
        assert first[1]["current_day"] == 2
        assert second[1]["current_day"] == 2
        assert third[1]["current_day"] == 2
        assert _get_daily(token, "2026-06-01")["day"] == 2

    def test_stale_completion_does_not_skip_days(self):
        """POSTing a completion for a day the user already left behind must not
        skip the plan forward. This models the case where the client sends a
        delayed completion request from a stale in-memory state."""
        email, token = _register_user()
        # Simulate: user is on day 5.
        _get_daily(token, "2026-06-01")  # creates row
        _set_progress(email, current_day=5, last_view_local_date=None)
        # Client naively posts completion for day 2 (stale).
        status, body = _complete_daily(token, day=2, local_date="2026-06-05")
        assert status == 200
        assert body["status"] == "stale"
        assert body["current_day"] == 5, "stale completion must not skip forward"

    def test_future_day_completion_rejected_or_noop(self):
        email, token = _register_user()
        _get_daily(token, "2026-06-01")
        _set_progress(email, current_day=3, last_view_local_date=None)
        # Client posts completion for day 100 (way ahead).
        status, body = _complete_daily(token, day=100, local_date="2026-06-05")
        assert status == 200
        assert body["status"] == "ahead"
        assert body["current_day"] == 3, "ahead completion must not jump forward"

    def test_day_995_is_capped(self):
        email, token = _register_user()
        _get_daily(token, "2026-07-01")
        _set_progress(email, current_day=995, last_view_local_date=None)
        status, body = _complete_daily(token, day=995, local_date="2026-07-05")
        assert status == 200
        # Stays at 995 forever — user has reached the end of the plan.
        assert body["current_day"] == 995
        assert body["last_completed_date"] == "2026-07-05"
        # Another completion attempt after several days still stays at 995.
        status2, body2 = _complete_daily(token, day=995, local_date="2026-07-10")
        assert body2["current_day"] == 995

    def test_invalid_stored_progress_falls_back_safely(self):
        email, token = _register_user()
        _get_daily(token, "2026-08-01")
        # Corrupt current_day to a non-int value.
        _set_progress(email, current_day="banana", last_view_local_date=None)
        body = _get_daily(token, "2026-08-15")
        assert body["day"] == 1, f"expected fallback to day 1, got {body['day']}"

    def test_two_users_maintain_independent_progress(self):
        _, tok_a = _register_user()
        _, tok_b = _register_user()
        _get_daily(tok_a, "2026-06-01")
        _get_daily(tok_b, "2026-06-01")
        # A completes across three separate calendar days.
        _complete_daily(tok_a, day=1, local_date="2026-06-01")
        _complete_daily(tok_a, day=2, local_date="2026-06-02")
        _complete_daily(tok_a, day=3, local_date="2026-06-03")
        a_now = _get_daily(tok_a, "2026-06-04")
        b_now = _get_daily(tok_b, "2026-06-04")
        assert a_now["day"] == 4
        assert b_now["day"] == 1

    def test_guest_completion_writes_no_server_state(self):
        # No Authorization header: /complete must return a no-op body and NOT
        # create a reading_progress row.
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv(os.path.join(BACKEND_DIR, ".env"))

        r = requests.post(
            f"{API}/daily-verse/complete",
            json={"day": 1, "local_date": "2026-06-01"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "guest"
        assert body["progress"] is None

        async def _count_rows():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = c[os.environ["DB_NAME"]]
            # A pure anonymous completion cannot have created any row keyed
            # to a real user; there is no owner_key to write.
            n = await db.reading_progress.count_documents({"owner_key": None})
            c.close()
            return n

        assert asyncio.new_event_loop().run_until_complete(_count_rows()) == 0


# --------------------------------------------------------------------------
# Guest / anonymous path
# --------------------------------------------------------------------------

class TestGuestPath:
    def test_anonymous_caller_receives_day_1_without_progress(self):
        body = _get_daily(None, "2026-06-01")
        assert body["day"] == 1
        assert body["progress"] is None

    def test_repeated_anonymous_calls_stay_on_day_1(self):
        a = _get_daily(None, "2026-06-01")
        b = _get_daily(None, "2026-06-02")
        assert a["day"] == 1 and b["day"] == 1


# --------------------------------------------------------------------------
# Auth error surfacing — the endpoint must NOT silently fall back to Day 1
# when a Bearer token is present but invalid/expired/malformed/revoked.
# --------------------------------------------------------------------------

class TestAuthErrorSurfacing:
    def test_malformed_bearer_returns_401(self):
        r = requests.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-01"},
            headers={"Authorization": "Bearer not-a-real-jwt"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text

    def test_expired_bearer_returns_401(self):
        # Forge an expired JWT with the real secret so we exercise the
        # jwt.decode() expiry branch (not the malformed branch).
        from jose import jwt as _jwt
        from dotenv import load_dotenv
        load_dotenv(os.path.join(BACKEND_DIR, ".env"))
        import time as _time
        payload = {
            "sub": "user-that-does-not-exist",
            "sid": "session-that-does-not-exist",
            "iss": os.environ.get("JWT_ISSUER"),
            "aud": os.environ.get("JWT_AUDIENCE"),
            "iat": int(_time.time()) - 3600,
            "exp": int(_time.time()) - 1800,  # expired 30 min ago
        }
        expired = _jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")
        r = requests.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-01"},
            headers={"Authorization": f"Bearer {expired}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text

    def test_revoked_session_returns_401(self):
        """A token whose backing user_sessions row is missing/revoked must 401."""
        from jose import jwt as _jwt
        from dotenv import load_dotenv
        load_dotenv(os.path.join(BACKEND_DIR, ".env"))
        import time as _time
        payload = {
            "sub": f"user-{uuid.uuid4().hex[:8]}",
            "sid": f"session-that-was-never-persisted-{uuid.uuid4().hex[:8]}",
            "iss": os.environ.get("JWT_ISSUER"),
            "aud": os.environ.get("JWT_AUDIENCE"),
            "iat": int(_time.time()),
            "exp": int(_time.time()) + 3600,
        }
        forged = _jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")
        r = requests.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-01"},
            headers={"Authorization": f"Bearer {forged}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text

    def test_missing_authorization_still_serves_day_1(self):
        # Sanity check the other side of the contract — genuine anonymity
        # (no Authorization header at all) still returns 200 with Day 1.
        r = requests.get(
            f"{API}/daily-verse",
            params={"local_date": "2026-06-01"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json()["day"] == 1
        assert r.json()["progress"] is None


# --------------------------------------------------------------------------
# Loader caching
# --------------------------------------------------------------------------

class TestLoaderCaching:
    def test_loader_reads_artifact_only_once(self):
        from reading_plans import loader as reading_plan_loader
        # Access several times through the API; the loader is a module singleton.
        for _ in range(3):
            requests.get(f"{API}/daily-verse", timeout=TIMEOUT)
        # And access directly from Python-land twice more
        reading_plan_loader.plan_metadata()
        reading_plan_loader.plan_metadata()
        # The loader tracks a load counter; the total in this process should be
        # exactly 1 (backend process is separate, but this module-local counter
        # asserts our loader semantics — that repeated calls do NOT reload).
        # We reset and access once to verify one-load semantics deterministically.
        reading_plan_loader.reset_cache_for_tests()
        before = reading_plan_loader.load_count_for_tests()
        reading_plan_loader.plan_metadata()
        reading_plan_loader.plan_metadata()
        reading_plan_loader.get_day(1)
        reading_plan_loader.get_day(500)
        after = reading_plan_loader.load_count_for_tests()
        assert after - before == 1, (
            f"loader parsed the artifact {after - before} times; expected exactly 1"
        )

    def test_loader_is_fast_on_repeat_access(self):
        from reading_plans import loader as reading_plan_loader
        # First access might warm the cache; subsequent are pure dict lookups.
        reading_plan_loader.plan_metadata()
        start = time.perf_counter()
        for _ in range(2000):
            reading_plan_loader.get_day(1 + (_ % 995))
        elapsed = time.perf_counter() - start
        # 2000 dict lookups must finish well under 1 second.
        assert elapsed < 1.0, f"cached loader too slow: {elapsed:.3f}s"
