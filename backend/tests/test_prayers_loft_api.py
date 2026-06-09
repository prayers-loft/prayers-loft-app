"""Backend API tests for Prayers Loft.

Covers: root, prayer-request (AI), prayer-follow-up (AI), daily-verse (AI/cached),
react-to-verse, get-reaction-counts, theological-question (AI), share-excerpt (AI/cached),
reflections CRUD.
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 90  # AI calls can be slow


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Stable per-session guest_id so reflection endpoints (now ownership-scoped
    # post-v1.0 P0 patch) accept these CRUD test calls. See server.py
    # current_owner() dep and tests/test_critical_user_flows.py for the
    # ownership contract.
    import uuid as _uuid
    s.headers.update({"X-Guest-Id": f"test-loft-api-{_uuid.uuid4().hex[:12]}"})
    yield s
    s.close()


def assert_no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"_id leaked: {obj}"
        for v in obj.values():
            assert_no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            assert_no_mongo_id(v)


# ---------- Basic ----------
def test_root(session):
    r = session.get(f"{API}/", timeout=TIMEOUT)
    assert r.status_code == 200
    assert "Prayers Loft" in r.json().get("message", "")


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
        text = data["response"]
        assert isinstance(text, str) and len(text) > 50
        assert re.search(r"VERSE:\s*", text, re.IGNORECASE), f"No VERSE: line in:\n{text}"
        assert re.search(r"would you like me to pray with you", text, re.IGNORECASE)

    def test_prayer_request_empty_message_rejected(self, session):
        r = session.post(f"{API}/prayer-request", json={"message": "   "}, timeout=TIMEOUT)
        assert r.status_code == 400


# ---------- Daily verse + devotional ----------
class TestDailyVerse:
    def test_daily_verse(self, session):
        r = session.get(f"{API}/daily-verse", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("verse", "reference", "verse_id", "bible_link", "devotional", "local_date"):
            assert k in data and data[k], f"missing/empty {k}"
        assert "/bible/116/" in data["bible_link"], data["bible_link"]
        assert re.match(r"^[A-Z0-9]+\.\d+\.\d+$", data["verse_id"]), data["verse_id"]
        assert_no_mongo_id(data)

    def test_daily_verse_local_date_deterministic(self, session):
        r1 = session.get(f"{API}/daily-verse?local_date=2026-01-15", timeout=TIMEOUT).json()
        r2 = session.get(f"{API}/daily-verse?local_date=2026-01-15", timeout=TIMEOUT).json()
        assert r1["verse_id"] == r2["verse_id"]
        assert r1["devotional"] == r2["devotional"]  # cached
        assert r1["local_date"] == "2026-01-15"


# ---------- Reactions ----------
class TestReactions:
    def test_react_and_get_counts(self, session):
        verse_id = f"TST.{uuid.uuid4().hex[:8]}.1"
        r0 = session.get(f"{API}/get-reaction-counts", params={"verse_id": verse_id}, timeout=TIMEOUT)
        assert r0.status_code == 200
        d0 = r0.json()
        assert d0["counts"] == {"pray": 0, "love": 0, "fire": 0, "insight": 0}

        for reaction, times in [("pray", 2), ("love", 1), ("fire", 1), ("insight", 1)]:
            last = None
            for _ in range(times):
                r = session.post(
                    f"{API}/react-to-verse",
                    json={"verse_id": verse_id, "reaction": reaction},
                    timeout=TIMEOUT,
                )
                assert r.status_code == 200, r.text
                body = r.json()
                assert body["reaction"] == reaction
                assert body["verse_id"] == verse_id
                last = body["count"]
            assert last == times

        counts = session.get(f"{API}/get-reaction-counts", params={"verse_id": verse_id}, timeout=TIMEOUT).json()["counts"]
        assert counts == {"pray": 2, "love": 1, "fire": 1, "insight": 1}

    def test_invalid_reaction_rejected(self, session):
        r = session.post(
            f"{API}/react-to-verse",
            json={"verse_id": "TST.X.1", "reaction": "pizza"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400


# ---------- Theological Q&A ----------
class TestTheologicalQA:
    @pytest.mark.parametrize("style", ["Devotional", "Theologian"])
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
        # No em/en dashes after soften_text
        assert "—" not in data["response"] and "–" not in data["response"]

    def test_invalid_style_rejected(self, session):
        r = session.post(
            f"{API}/theological-question",
            json={"question": "?", "verse": "Psalm 23:1", "style": "Pastoral"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 422

    def test_empty_question_rejected(self, session):
        r = session.post(
            f"{API}/theological-question",
            json={"question": "   ", "verse": "Psalm 23:1", "style": "Devotional"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400


# ---------- Share Excerpt (new feature) ----------
LONG_DEVOTIONAL = (
    "When fear becomes louder than truth, remember that God's faithful love never lets you go. "
    "There are seasons of life when uncertainty presses in from every side, and the soul feels "
    "tossed about by waves of doubt. In those moments, Scripture invites you to do something "
    "surprisingly simple: be still. Stillness is not the absence of struggle but the presence of "
    "trust. It says: I cannot see the path, but I know who walks beside me. Each breath becomes "
    "a quiet act of faith, each tear a prayer that God already understands. The same Lord who "
    "calmed the wind and the waves whispers into your storm: peace, be still. Hold on. The "
    "morning always comes, and His mercies always meet it."
)

LONG_THEOLOGIAN = (
    "The Hebrew verb batach, translated 'trust' in Proverbs 3:5, carries the sense of leaning "
    "the full weight of one's being onto another. It is not intellectual assent but covenantal "
    "dependence. In the wisdom literature, batach is consistently set in contrast with binah, "
    "one's own understanding, suggesting that mature faith resists the temptation to absolutize "
    "human cognition. Augustine echoed this in De Trinitate, noting that the creature is not the "
    "measure of the Creator. To 'lean not on your own understanding' is therefore not "
    "anti-intellectual; it is a confession of finitude before infinite wisdom. Such trust is "
    "embodied, relational, and historically rooted in God's prior covenant faithfulness, what "
    "Israel called hesed."
)


class TestShareExcerpt:
    def test_devotional_excerpt_caching(self, session):
        payload = {"text": LONG_DEVOTIONAL, "style": "Devotional", "question": "How do I trust God when I'm afraid?"}
        r1 = session.post(f"{API}/share-excerpt", json=payload, timeout=TIMEOUT)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert "excerpt" in d1
        assert isinstance(d1["excerpt"], str) and 1 <= len(d1["excerpt"]) <= 300
        assert "—" not in d1["excerpt"] and "–" not in d1["excerpt"]
        # First call may or may not be cached (previous test run), but must be present
        assert "cached" in d1

        # Second call MUST be cached
        r2 = session.post(f"{API}/share-excerpt", json=payload, timeout=TIMEOUT)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["cached"] is True
        assert d2["excerpt"] == d1["excerpt"]

    def test_theologian_excerpt(self, session):
        r = session.post(
            f"{API}/share-excerpt",
            json={"text": LONG_THEOLOGIAN, "style": "Theologian"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["excerpt"], str) and 1 <= len(d["excerpt"]) <= 300

    def test_short_text_still_returns_excerpt(self, session):
        short = "Trust the Lord with all your heart. He guides every step you take."
        r = session.post(
            f"{API}/share-excerpt",
            json={"text": short, "style": "Devotional"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["excerpt"] and len(d["excerpt"]) > 0 and len(d["excerpt"]) <= 300

    def test_empty_text_rejected(self, session):
        r = session.post(
            f"{API}/share-excerpt",
            json={"text": "   ", "style": "Devotional"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    def test_invalid_style_rejected(self, session):
        r = session.post(
            f"{API}/share-excerpt",
            json={"text": "Some text.", "style": "Casual"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 422

    def test_prayer_excerpt_preserves_first_person(self, session):
        prayer = (
            "Heavenly Father,\n"
            "I am tired and my heart feels heavy tonight.\n"
            "Please hold me close and quiet my anxious mind.\n"
            "Help me trust You with what I cannot see.\n"
            "In Jesus' name, Amen."
        )
        r = session.post(
            f"{API}/share-excerpt",
            json={"text": prayer, "style": "Prayer"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        excerpt = d["excerpt"]
        assert isinstance(excerpt, str) and 1 <= len(excerpt) <= 280, f"len={len(excerpt)}: {excerpt}"
        # First-person voice preserved (at least one of these markers).
        lower = excerpt.lower()
        assert any(tok in lower for tok in (" i ", "i ", " my ", " me ", "my ", "me ")), (
            f"Prayer excerpt should preserve first-person voice: {excerpt}"
        )
        assert "—" not in excerpt and "–" not in excerpt

    def test_verse_excerpt(self, session):
        verse_text = (
            "Don't worry about anything; instead, pray about everything. Tell God what you need, "
            "and thank him for all he has done. Then you will experience God's peace, which "
            "exceeds anything we can understand."
        )
        r = session.post(
            f"{API}/share-excerpt",
            json={"text": verse_text, "style": "Verse"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["excerpt"], str) and 1 <= len(d["excerpt"]) <= 300
        assert "—" not in d["excerpt"] and "–" not in d["excerpt"]


# ---------- Reflections CRUD ----------
class TestReflections:
    created_ids = []

    def test_create_reflection(self, session):
        payload = {"text": "TEST_Today I felt the quiet of grace.", "emotion": "Peace", "prompt": "What is bringing you peace?"}
        r = session.post(f"{API}/reflections", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "_id" not in data
        assert data["text"] == payload["text"]
        assert data["emotion"] == "Peace"
        TestReflections.created_ids.append(data["id"])

    def test_list_includes_created(self, session):
        r = session.get(f"{API}/reflections", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
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
        d = r.json()
        assert d["text"] == "TEST_Updated reflection text."
        assert d["emotion"] == "Grateful"

    def test_delete_reflection(self, session):
        rid = TestReflections.created_ids[-1]
        r = session.delete(f"{API}/reflections/{rid}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json() == {"deleted": True, "id": rid}
        # Verify gone
        ids = [x["id"] for x in session.get(f"{API}/reflections", timeout=TIMEOUT).json()["reflections"]]
        assert rid not in ids

    def test_update_nonexistent_returns_404(self, session):
        r = session.put(
            f"{API}/reflections/{uuid.uuid4()}",
            json={"text": "nope"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 404

    def test_delete_nonexistent_returns_404(self, session):
        r = session.delete(f"{API}/reflections/{uuid.uuid4()}", timeout=TIMEOUT)
        assert r.status_code == 404

    def test_create_empty_text_rejected(self, session):
        r = session.post(f"{API}/reflections", json={"text": "   "}, timeout=TIMEOUT)
        assert r.status_code == 400
