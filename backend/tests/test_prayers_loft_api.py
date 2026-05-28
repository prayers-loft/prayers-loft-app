"""Backend API tests for Prayers Loft.

Covers: root, prayer-request (AI), prayer-follow-up (AI), daily-verse (AI/cached),
react-to-verse, get-reaction-counts, theological-question (AI), reflections CRUD.
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://prayers-loft.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 90  # AI calls can be slow


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    s.close()


# ---------- Basic ----------
def test_root(session):
    r = session.get(f"{API}/", timeout=TIMEOUT)
    assert r.status_code == 200
    data = r.json()
    assert "message" in data
    assert "Prayers Loft" in data["message"]


def assert_no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"_id leaked: {obj}"
        for v in obj.values():
            assert_no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            assert_no_mongo_id(v)


# ---------- Prayer flow (AI) ----------
class TestPrayerFlow:
    def test_prayer_request_returns_reflection(self, session):
        r = session.post(
            f"{API}/prayer-request",
            json={"message": "I feel anxious about my new job starting Monday."},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "response" in data
        text = data["response"]
        assert isinstance(text, str) and len(text) > 50
        # Should include VERSE: line
        assert re.search(r"VERSE:\s*", text, re.IGNORECASE), f"No VERSE: line in:\n{text}"
        # Should include closing question
        assert re.search(r"would you like me to pray with you", text, re.IGNORECASE), \
            f"Missing closing question:\n{text}"
        assert_no_mongo_id(data)

    def test_prayer_request_empty_message_rejected(self, session):
        r = session.post(f"{API}/prayer-request", json={"message": "   "}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_prayer_follow_up_returns_prayer(self, session):
        r = session.post(
            f"{API}/prayer-follow-up",
            json={"message": "I feel anxious about my new job.", "consent": True},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "prayer" in data
        prayer = data["prayer"].strip()
        assert len(prayer) > 30
        # Must end with the Amen phrase (allow ' or no apostrophe)
        assert re.search(r"In Jesus[''']?\s+name,?\s+Amen\.?\s*$", prayer, re.IGNORECASE), \
            f"Prayer doesn't end with In Jesus' name, Amen.:\n{prayer}"

    def test_prayer_follow_up_without_consent(self, session):
        r = session.post(
            f"{API}/prayer-follow-up",
            json={"message": "Help", "consent": False},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400


# ---------- Daily verse + devotional (AI/cached) ----------
class TestDailyVerse:
    def test_daily_verse(self, session):
        r = session.get(f"{API}/daily-verse", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("verse", "reference", "verse_id", "bible_link", "devotional"):
            assert k in data, f"missing {k}"
            assert data[k], f"empty {k}"
        assert data["bible_link"].startswith("https://www.bible.com/bible/1/")
        assert re.match(r"^[A-Z0-9]+\.\d+\.\d+$", data["verse_id"]), data["verse_id"]
        assert_no_mongo_id(data)


# ---------- Reactions ----------
class TestReactions:
    def test_react_and_get_counts(self, session):
        # Use a unique verse id to avoid polluting other tests
        verse_id = f"TST.{uuid.uuid4().hex[:8]}.1"

        # Initial counts should all be zero
        r0 = session.get(f"{API}/get-reaction-counts", params={"verse_id": verse_id}, timeout=TIMEOUT)
        assert r0.status_code == 200
        d0 = r0.json()
        assert d0["verse_id"] == verse_id
        assert d0["counts"] == {"🙏": 0, "❤️": 0, "🔥": 0, "💡": 0}

        # React twice with 🙏 and once with ❤️
        for emoji, times in [("🙏", 2), ("❤️", 1), ("🔥", 1), ("💡", 1)]:
            last_count = None
            for _ in range(times):
                r = session.post(
                    f"{API}/react-to-verse",
                    json={"verse_id": verse_id, "emoji": emoji},
                    timeout=TIMEOUT,
                )
                assert r.status_code == 200, r.text
                body = r.json()
                assert body["emoji"] == emoji
                assert body["verse_id"] == verse_id
                assert isinstance(body["count"], int) and body["count"] >= 1
                last_count = body["count"]
            assert last_count == times, f"{emoji} count mismatch"

        # Verify via GET
        r = session.get(f"{API}/get-reaction-counts", params={"verse_id": verse_id}, timeout=TIMEOUT)
        assert r.status_code == 200
        counts = r.json()["counts"]
        assert counts == {"🙏": 2, "❤️": 1, "🔥": 1, "💡": 1}

    def test_invalid_emoji_rejected(self, session):
        r = session.post(
            f"{API}/react-to-verse",
            json={"verse_id": "TST.X.1", "emoji": "🍕"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400


# ---------- Theological Q&A ----------
class TestTheologicalQA:
    @pytest.mark.parametrize("style", ["Devotional", "Theologian", "Pastoral"])
    def test_styles(self, session, style):
        r = session.post(
            f"{API}/theological-question",
            json={
                "question": "What does it mean to trust God in uncertainty?",
                "verse": "Proverbs 3:5-6",
                "style": style,
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["style"] == style
        assert isinstance(data["response"], str) and len(data["response"]) > 50

    def test_invalid_style_rejected(self, session):
        r = session.post(
            f"{API}/theological-question",
            json={"question": "?", "verse": "Psalm 23:1", "style": "Casual"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 422  # pydantic Literal


# ---------- Reflections CRUD ----------
class TestReflections:
    created_ids = []

    def test_create_reflection(self, session):
        payload = {"text": "TEST_Today I felt the quiet of grace.", "emotion": "Peace", "prompt": "What is bringing you peace?"}
        r = session.post(f"{API}/reflections", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "_id" not in data
        for k in ("id", "text", "emotion", "prompt", "created_at", "updated_at"):
            assert k in data
        assert data["text"] == payload["text"]
        assert data["emotion"] == "Peace"
        TestReflections.created_ids.append(data["id"])

    def test_list_reflections(self, session):
        r = session.get(f"{API}/reflections", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "reflections" in data
        assert isinstance(data["reflections"], list)
        assert_no_mongo_id(data)
        ids = [x["id"] for x in data["reflections"]]
        assert TestReflections.created_ids[-1] in ids

    def test_update_reflection(self, session):
        rid = TestReflections.created_ids[-1]
        r = session.put(
            f"{API}/reflections/{rid}",
            json={"text": "TEST_Updated reflection text.", "emotion": "Grateful"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "_id" not in data
        assert data["text"] == "TEST_Updated reflection text."
        assert data["emotion"] == "Grateful"

        # Verify via list
        r2 = session.get(f"{API}/reflections", timeout=TIMEOUT)
        found = next((x for x in r2.json()["reflections"] if x["id"] == rid), None)
        assert found and found["text"] == "TEST_Updated reflection text."

    def test_update_nonexistent_returns_404(self, session):
        r = session.put(
            f"{API}/reflections/{uuid.uuid4()}",
            json={"text": "nope"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 404

    def test_delete_reflection(self, session):
        rid = TestReflections.created_ids[-1]
        r = session.delete(f"{API}/reflections/{rid}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json() == {"deleted": True, "id": rid}

        # Verify it's gone
        r2 = session.get(f"{API}/reflections", timeout=TIMEOUT)
        ids = [x["id"] for x in r2.json()["reflections"]]
        assert rid not in ids

    def test_delete_nonexistent_returns_404(self, session):
        r = session.delete(f"{API}/reflections/{uuid.uuid4()}", timeout=TIMEOUT)
        assert r.status_code == 404

    def test_create_empty_text_rejected(self, session):
        r = session.post(f"{API}/reflections", json={"text": "   "}, timeout=TIMEOUT)
        assert r.status_code == 400
