"""Build 22 regression — Scripture reading-plan progress persistence.

Guards the server-authoritative progress guarantees for SIGNED-IN users:

  1. Progress persists across app reloads / dev-client restarts — GET
     /api/daily-verse READS current_day and never advances it. A user set to
     Day N stays on Day N no matter how many times the app reloads.
  2. Changing app/build metadata (User-Agent, X-App-Version, cache-busting
     query params) does NOT reset or advance current_day — progression is
     keyed only to (owner_key, plan_id), never to any client/build identity.
  3. Server-backed progress is restored after reinstall/update — a fresh
     login (new session/token) for the same account returns the same Day N.
  4. Progression only advances via the local-calendar-day rule: at most once
     per local calendar day, and only on an explicit matching completion.
     Repeated "Done"/complete calls on the same local day never double-advance,
     and a new local calendar day legitimately advances by exactly one.

Runs against the deployed preview URL (EXPO_PUBLIC_BACKEND_URL). Self-seeding:
registers a unique random user per run (no fixed credentials).
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://exodus-build-preview.preview.emergentagent.com",
).rstrip("/")

PASSWORD = "TestPass1234!"


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _register() -> tuple[str, str, str]:
    """Register a fresh user. Returns (email, password, access_token)."""
    email = f"TEST_e2e_{uuid.uuid4().hex[:8]}@prayersloft-qa.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": PASSWORD, "name": "QA Progress"},
        timeout=20,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:300]}"
    token = r.json()["tokens"]["access_token"]
    assert token
    return email, PASSWORD, token


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    return r.json()["tokens"]["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _get_day(token: str, local_date: str, extra_headers: dict | None = None,
             query: dict | None = None) -> dict:
    headers = _auth(token)
    if extra_headers:
        headers.update(extra_headers)
    params = {"local_date": local_date}
    if query:
        params.update(query)
    r = requests.get(
        f"{BASE_URL}/api/daily-verse", headers=headers, params=params, timeout=20
    )
    assert r.status_code == 200, f"daily-verse failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _complete(token: str, day: int, local_date: str) -> dict:
    r = requests.post(
        f"{BASE_URL}/api/daily-verse/complete",
        headers=_auth(token),
        json={"day": day, "local_date": local_date},
        timeout=20,
    )
    assert r.status_code == 200, f"complete failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _advance_to(token: str, target_day: int, start_date_ordinal: int = 0) -> list[str]:
    """Advance a fresh user to `target_day` by completing one reading per
    distinct local calendar day. Returns the list of local_date strings used.
    Uses far-future deterministic dates so there is no dependence on the real
    'today' and no collision with any prior test run.
    """
    dates: list[str] = []
    for i in range(target_day - 1):
        # e.g. 2031-01-01, 2031-01-02, ...
        ld = f"2031-{((start_date_ordinal + i) // 28) % 12 + 1:02d}-{(start_date_ordinal + i) % 28 + 1:02d}"
        res = _complete(token, day=i + 1, local_date=ld)
        assert res["current_day"] == i + 2, (
            f"expected advance to day {i+2}, got {res}"
        )
        dates.append(ld)
    return dates


# =============================================================================
# 1 + 2 + 3 — persistence across reload, build-metadata change, and reinstall
# =============================================================================
class TestProgressPersistence:
    def test_progress_persists_across_reload_build_change_and_reinstall(self):
        email, password, token = _register()

        # Fresh account starts at Day 1.
        first = _get_day(token, "2031-01-01")
        assert first["day"] == 1, first
        assert first["progress"]["current_day"] == 1

        # Advance the user to Day 4 (three completions on three local days).
        _advance_to(token, target_day=4)

        # --- (1) Reload / dev-client restart: a plain GET must READ Day 4,
        # never advance it. Multiple reloads stay pinned to Day 4. ---
        for _ in range(3):
            d = _get_day(token, "2031-01-03")
            assert d["day"] == 4, f"reload advanced/reset progress: {d['day']}"
            assert d["progress"]["current_day"] == 4

        # --- (2) App/build metadata change must NOT reset or advance day. We
        # simulate a brand-new build: different User-Agent, an app-version
        # header, and cache-busting query params the server does not know. ---
        d = _get_day(
            token,
            "2031-01-03",
            extra_headers={
                "User-Agent": "PrayersLoft/9.9.9 (build 999; iOS 26.0)",
                "X-App-Version": "9.9.9",
                "X-Build-Number": "999",
            },
            query={"_cacheBust": uuid.uuid4().hex, "buildNumber": "999"},
        )
        assert d["day"] == 4, f"build-metadata change changed day: {d['day']}"
        assert d["progress"]["current_day"] == 4

        # --- (3) Reinstall / update: a fresh login (new session + token) for
        # the SAME account restores the server-backed progress (Day 4). ---
        token2 = _login(email, password)
        assert token2 != token, "expected a fresh token from re-login"
        d = _get_day(token2, "2031-01-03")
        assert d["day"] == 4, f"reinstall did not restore progress: {d['day']}"
        assert d["progress"]["current_day"] == 4

        # The original token still works and still sees Day 4 (no divergence).
        d = _get_day(token, "2031-01-03")
        assert d["day"] == 4


# =============================================================================
# 4 — local-calendar-day advancement rule (no double advance; legit next-day)
# =============================================================================
class TestLocalCalendarAdvancement:
    def test_same_local_day_never_double_advances(self):
        _, _, token = _register()

        # Complete Day 1 on local day A → advances to Day 2.
        res = _complete(token, day=1, local_date="2032-06-01")
        assert res["status"] == "advanced"
        assert res["current_day"] == 2

        # Repeated completion on the SAME local day is a no-op (idempotent):
        # attempting to complete Day 2 on the same local day must NOT advance.
        res = _complete(token, day=2, local_date="2032-06-01")
        assert res["status"] == "already_completed", res
        assert res["current_day"] == 2, f"double-advanced on same local day: {res}"

        # A plain GET on the same local day still reads Day 2.
        d = _get_day(token, "2032-06-01")
        assert d["day"] == 2

        # A stale completion (submitting an older day) is a safe no-op.
        res = _complete(token, day=1, local_date="2032-06-01")
        assert res["status"] == "stale", res
        assert res["current_day"] == 2

        # --- Legitimate local-calendar advance: on the NEXT local day the
        # user may advance by exactly one. ---
        res = _complete(token, day=2, local_date="2032-06-02")
        assert res["status"] == "advanced", res
        assert res["current_day"] == 3

        d = _get_day(token, "2032-06-02")
        assert d["day"] == 3


# =============================================================================
# Guest / anonymous callers never carry server progress (control case).
# =============================================================================
class TestGuestNoServerProgress:
    def test_guest_always_day_one_no_progress(self):
        gid = f"guest-{uuid.uuid4().hex[:12]}"
        r = requests.get(
            f"{BASE_URL}/api/daily-verse",
            headers={"X-Guest-Id": gid},
            params={"local_date": "2031-01-03"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["day"] == 1
        assert data["progress"] is None
