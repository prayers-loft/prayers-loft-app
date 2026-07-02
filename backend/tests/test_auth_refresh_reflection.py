# Targeted test for the auth refresh + reflection flow that frontend
# Build 13 was broken on. The frontend now performs an interceptor-style
# refresh on 401 from /api/reflections; this test exercises the backend
# half of that contract end-to-end so we never regress it.
#
# Scenarios:
#   1. Stale access token on /api/reflections -> 401 (the trigger).
#   2. POST /api/auth/refresh with the valid refresh_token -> new pair.
#   3. Retry /api/reflections with the new access_token -> 200.
#   4. Calling /api/auth/refresh with a deliberately bogus refresh token
#      -> 401, so the frontend knows to clearAuth() and drop to guest.
#   5. /api/reflections with ONLY X-Guest-Id (no Authorization) -> 200,
#      proving the guest-fallback path the frontend uses after a failed
#      refresh actually works.

import os
import uuid
import pytest
import requests

BASE = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://localhost:8001").rstrip("/")


def _register(email: str | None = None):
    email = email or f"refresh-{uuid.uuid4().hex[:8]}@prayersloft-qa.com"
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": email, "password": "TestPass1234!"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return email, r.json()


def test_refresh_recovers_from_stale_access_token():
    _email, body = _register()
    access = body["tokens"]["access_token"]
    refresh = body["tokens"]["refresh_token"]

    # Sanity: fresh access works on /api/reflections.
    r = requests.get(
        f"{BASE}/api/reflections",
        headers={"Authorization": f"Bearer {access}"},
        timeout=10,
    )
    assert r.status_code == 200, r.text

    # Simulate a stale token by sending a deliberately bad bearer.
    r = requests.get(
        f"{BASE}/api/reflections",
        headers={"Authorization": "Bearer not.a.valid.jwt"},
        timeout=10,
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid token"

    # The valid refresh_token still rotates into a fresh pair.
    r = requests.post(
        f"{BASE}/api/auth/refresh",
        json={"refresh_token": refresh},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    new_access = r.json()["access_token"]
    new_refresh = r.json()["refresh_token"]
    # Access token may briefly equal the original when refresh happens in
    # the same JWT iat second (HS256 iat has 1-second resolution and payload
    # is otherwise identical). The refresh_token, however, is rotated
    # unconditionally — that's the contract we depend on.
    assert new_access
    assert new_refresh and new_refresh != refresh

    # Retry the original call with the new access — should be 200, NOT 401.
    r = requests.get(
        f"{BASE}/api/reflections",
        headers={"Authorization": f"Bearer {new_access}"},
        timeout=10,
    )
    assert r.status_code == 200, r.text


def test_refresh_rejects_bogus_refresh_token():
    """If refresh itself fails, the frontend will drop to guest mode."""
    r = requests.post(
        f"{BASE}/api/auth/refresh",
        json={"refresh_token": "totally-bogus-token-string"},
        timeout=10,
    )
    assert r.status_code == 401, r.text


def test_guest_fallback_reflections_works():
    """After a refresh failure the frontend retries with only X-Guest-Id.
    The backend MUST accept this so users never see a hard error."""
    gid = f"guest-{uuid.uuid4().hex[:12]}"
    # No Authorization header — guest only.
    r = requests.get(
        f"{BASE}/api/reflections",
        headers={"X-Guest-Id": gid},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    assert "reflections" in r.json()


def test_reflection_save_with_refreshed_token_isolates_to_user():
    """After refresh, saving a reflection scopes to the same user_id,
    so My Reflections still shows it."""
    _email, body = _register()
    refresh = body["tokens"]["refresh_token"]

    # Use the refresh path even though access is fresh — proves rotation.
    r = requests.post(
        f"{BASE}/api/auth/refresh",
        json={"refresh_token": refresh},
        timeout=10,
    )
    assert r.status_code == 200
    new_access = r.json()["access_token"]

    # Save a reflection.
    save = requests.post(
        f"{BASE}/api/reflections",
        headers={"Authorization": f"Bearer {new_access}"},
        json={"text": "post-refresh reflection", "emotion": "grateful"},
        timeout=10,
    )
    assert save.status_code == 200, save.text

    # Read it back.
    listed = requests.get(
        f"{BASE}/api/reflections",
        headers={"Authorization": f"Bearer {new_access}"},
        timeout=10,
    )
    assert listed.status_code == 200
    texts = [r["text"] for r in listed.json()["reflections"]]
    assert "post-refresh reflection" in texts


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
