"""Bible Assistant endpoint tests — feature added on top of the v1.0 P0 fix.

Covers the new /api/bible-assistant route, which replaces /api/theological-question
as the primary entry-point for the Scripture page Discuss section. Two modes:

  - "question"   → free-form Bible / theology / Christian-living Q&A
                    (NOT bound to the current daily verse)
  - "devotional" → structured 5-section devotional generated from a topic

Existing tests for /api/theological-question (legacy endpoint, kept for
backward compat with older mobile builds) live in test_prayers_loft_api.py.
"""

from __future__ import annotations

import os
import pytest
import requests


BASE_URL = os.environ.get("PRAYERS_LOFT_BACKEND_URL", "http://localhost:8001") + "/api"
HAS_LLM = bool(os.environ.get("EMERGENT_LLM_KEY"))


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    s.close()


# ---------------------------------------------------------------------------
# Validation tests (don't require the LLM, can always run)
# ---------------------------------------------------------------------------
class TestValidation:
    def test_empty_input_returns_422(self, session):
        """Pydantic min_length=1 must reject empty strings before reaching the LLM."""
        r = session.post(f"{BASE_URL}/bible-assistant", json={"mode": "question", "input": ""})
        assert r.status_code == 422, f"expected 422 for empty input, got {r.status_code}: {r.text}"

    def test_whitespace_only_input_returns_400(self, session):
        """Inputs that are non-empty syntactically but empty semantically should 400."""
        r = session.post(
            f"{BASE_URL}/bible-assistant", json={"mode": "question", "input": "   \n\t  "}
        )
        # min_length=1 passes (whitespace counts), then our strip() check fires.
        assert r.status_code == 400, f"expected 400 for whitespace input, got {r.status_code}"

    def test_invalid_mode_returns_422(self, session):
        """Literal['question','devotional'] must reject any other mode."""
        r = session.post(f"{BASE_URL}/bible-assistant", json={"mode": "freestyle", "input": "test"})
        assert r.status_code == 422

    def test_missing_mode_returns_422(self, session):
        r = session.post(f"{BASE_URL}/bible-assistant", json={"input": "test"})
        assert r.status_code == 422

    def test_missing_input_returns_422(self, session):
        r = session.post(f"{BASE_URL}/bible-assistant", json={"mode": "question"})
        assert r.status_code == 422

    def test_oversized_input_returns_422(self, session):
        """max_length=500 must reject runaway inputs."""
        r = session.post(
            f"{BASE_URL}/bible-assistant", json={"mode": "question", "input": "x" * 501}
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Happy-path tests (require EMERGENT_LLM_KEY; auto-skip if missing)
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not HAS_LLM, reason="EMERGENT_LLM_KEY not set; LLM tests skipped")
class TestQuestionMode:
    def test_general_bible_question_returns_response(self, session):
        """A Bible question that has nothing to do with the daily verse must still answer.

        This is the core behavior change vs the legacy /api/theological-question
        which was always tied to the current verse.
        """
        r = session.post(
            f"{BASE_URL}/bible-assistant",
            json={"mode": "question", "input": "What does the Bible say about anxiety?"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mode"] == "question"
        # Should contain at least one scripture-ish reference (chapter:verse pattern)
        # and a meaningful body.
        assert len(body["response"]) > 80
        # Common verses on anxiety include Phil 4:6-7, 1 Peter 5:7, Matthew 6:25-34.
        # Don't pin to a specific one — just confirm SOME reference shape exists.
        import re
        assert re.search(r"\b\d?\s?[A-Z][a-zA-Z]+\s+\d+:\d+", body["response"]), \
            f"expected a scripture reference in response, got: {body['response'][:200]}"

    def test_theology_disputed_question_handles_humbly(self, session):
        """Questions on disputed issues should acknowledge disagreement,
        not assert one position with certainty. We don't assert the exact wording,
        just that the response is non-trivial and not zero-length.
        """
        r = session.post(
            f"{BASE_URL}/bible-assistant",
            json={"mode": "question", "input": "Did Saul lose his salvation?"},
            timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["mode"] == "question"
        assert len(body["response"]) > 100


@pytest.mark.skipif(not HAS_LLM, reason="EMERGENT_LLM_KEY not set; LLM tests skipped")
class TestDevotionalMode:
    def test_generic_topic_returns_structured_devotional(self, session):
        """User supplies a topic. Must return Title / Key Scripture / Reflection /
        Practical Application / Prayer in that order."""
        r = session.post(
            f"{BASE_URL}/bible-assistant",
            json={"mode": "devotional", "input": "Anxiety"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mode"] == "devotional"
        text = body["response"]
        # All 5 section labels must appear, each on their own line as defined in the prompt.
        for label in ("Title:", "Key Scripture:", "Reflection:", "Practical Application:", "Prayer:"):
            assert label in text, f"missing section label {label} in:\n{text}"
        # Ordering matters for downstream parsing.
        idx = [text.index(s) for s in ("Title:", "Key Scripture:", "Reflection:", "Practical Application:", "Prayer:")]
        assert idx == sorted(idx), f"sections out of order: {idx}"
        # Prayer should end with Amen (case-insensitive).
        assert "amen" in text.lower()

    def test_single_word_topic_works(self, session):
        """The most common case — a one-word topic chip — should produce a full devotional."""
        r = session.post(
            f"{BASE_URL}/bible-assistant",
            json={"mode": "devotional", "input": "Purpose"},
            timeout=30,
        )
        assert r.status_code == 200
        assert "Title:" in r.json()["response"]


# ---------------------------------------------------------------------------
# Backward compatibility — old /api/theological-question MUST still work
# (older TestFlight builds may still hit it).
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not HAS_LLM, reason="EMERGENT_LLM_KEY not set; LLM tests skipped")
class TestLegacyEndpointStillWorks:
    def test_legacy_theological_question_still_returns_200(self, session):
        r = session.post(
            f"{BASE_URL}/theological-question",
            json={
                "question": "What is grace?",
                "verse": '"For by grace you have been saved" (Eph 2:8)',
                "style": "Devotional",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "response" in body
        assert body["style"] == "Devotional"


# ---------------------------------------------------------------------------
# Existing daily devotional load must NOT regress — sanity check that the
# new endpoint didn't accidentally break anything in the daily-verse path.
# ---------------------------------------------------------------------------
class TestDailyDevotionalUnchanged:
    def test_daily_verse_still_loads(self, session):
        r = session.get(f"{BASE_URL}/daily-verse", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "verse" in body and len(body["verse"]) > 0
        assert "reference" in body and len(body["reference"]) > 0
        assert "devotional" in body and len(body["devotional"]) > 0
