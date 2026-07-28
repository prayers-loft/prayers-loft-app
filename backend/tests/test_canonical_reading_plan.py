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
                "last_view_local_date": last_view_local_date,
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

class TestProgressionContract:
    def test_first_time_signed_in_user_receives_day_1(self):
        _, token = _register_user()
        body = _get_daily(token, "2026-06-01")
        assert body["day"] == 1
        assert body["progress"]["current_day"] == 1
        assert body["progress"]["last_view_local_date"] == "2026-06-01"

    def test_same_local_day_does_not_advance(self):
        _, token = _register_user()
        a = _get_daily(token, "2026-06-02")
        b = _get_daily(token, "2026-06-02")
        c = _get_daily(token, "2026-06-02")
        assert a["day"] == 1 and b["day"] == 1 and c["day"] == 1

    def test_next_local_day_advances_exactly_one(self):
        _, token = _register_user()
        d1 = _get_daily(token, "2026-06-03")
        d2 = _get_daily(token, "2026-06-04")
        d3 = _get_daily(token, "2026-06-05")
        assert d1["day"] == 1
        assert d2["day"] == 2
        assert d3["day"] == 3

    def test_skipped_local_days_still_advance_one(self):
        _, token = _register_user()
        a = _get_daily(token, "2026-06-10")   # day 1
        # jump 40 calendar days forward
        b = _get_daily(token, "2026-07-20")   # should still be day 2 (not 41)
        # jump 200 more days
        c = _get_daily(token, "2027-02-05")   # should be day 3
        assert a["day"] == 1
        assert b["day"] == 2, f"expected day 2, got {b['day']}"
        assert c["day"] == 3

    def test_invalid_stored_progress_falls_back_safely(self):
        email, token = _register_user()
        # First call creates a valid row on today.
        _get_daily(token, "2026-08-01")
        # Corrupt: current_day = "banana" (non-int), plus a stale date so we
        # trigger the advance path where clamp_day is used.
        _set_progress(email, current_day="banana", last_view_local_date="2026-07-30")
        body = _get_daily(token, "2026-08-15")
        # clamp_day("banana") -> 1, then we advance by 1 → day 2
        assert body["day"] == 2, f"expected fallback to day 2, got {body['day']}"

    def test_day_995_does_not_advance_past_end(self):
        email, token = _register_user()
        _get_daily(token, "2026-09-01")
        _set_progress(email, 995, "2026-09-01")  # user is at final day
        body = _get_daily(token, "2026-09-02")   # next day
        assert body["day"] == 995, f"must clamp at 995, got {body['day']}"
        # And one more day still does not advance
        body2 = _get_daily(token, "2026-09-15")
        assert body2["day"] == 995

    def test_two_users_maintain_independent_progress(self):
        _, tok_a = _register_user()
        _, tok_b = _register_user()
        _get_daily(tok_a, "2026-06-01")   # A: day 1
        _get_daily(tok_a, "2026-06-02")   # A: day 2
        _get_daily(tok_a, "2026-06-03")   # A: day 3
        _get_daily(tok_b, "2026-06-01")   # B: day 1
        a_now = _get_daily(tok_a, "2026-06-04")   # A: day 4
        b_now = _get_daily(tok_b, "2026-06-04")   # B: day 2
        assert a_now["day"] == 4
        assert b_now["day"] == 2


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
