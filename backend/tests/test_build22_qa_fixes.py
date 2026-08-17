"""Focused regression tests for the Build 22 QA pass.

Covers the Walk memory-integrity fixes (Issues 6/7/9/10) at the unit level —
the pieces that are pure and testable without a live server:

  * Second-person session summaries (Issue 6) — sanitizer accepts "you…",
    rejects third-person "they…/the user…", and the landing hint renders
    "Last time, you were…".
  * Evidence-enforced no-fabrication grounding (Issue 7) — the memory
    grounding block is driven by whether memory was actually retrieved, not
    by prompt wording alone: empty recap => explicit "NO stored record"
    directive; populated recap => "ONLY record" directive.
  * Memory recap returns None when there is no retrieved evidence, so the
    v5 directive routes to the no-record branch.

These run in-process (no network) — walk.py / walk_v5.py import cleanly.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from walk import (  # noqa: E402
    _sanitize_summary,
    _compose_landing_hint,
    _build_session_system_message,
    _format_memory_for_context,
)
from walk_v5 import (  # noqa: E402
    TurnDirective,
    build_memory_recap,
    WALK_VOICE_PROMPT_V5,
)


# =============================================================================
# Issue 6 — second-person "Last time" summaries
# =============================================================================
class TestSecondPersonSummary:
    def test_accepts_second_person(self):
        s = _sanitize_summary("You were wrestling with dryness in prayer.")
        assert s is not None
        assert s.lower().startswith("you ")

    def test_rejects_third_person_they(self):
        assert _sanitize_summary("They were wrestling with dryness in prayer.") is None

    def test_rejects_the_user_or_he_she(self):
        assert _sanitize_summary("He was grieving the loss of his father this week.") is None
        assert _sanitize_summary("She came to peace with an unanswered prayer.") is None

    def test_transcript_style_opener_stripped_but_second_person(self):
        # "You said you avoided…" -> preamble stripped, remains second person.
        s = _sanitize_summary("You said you avoided inappropriate content this week.")
        assert s is not None
        assert "you said" not in s.lower()
        assert s.lower().startswith("you ")

    def test_landing_hint_renders_second_person(self):
        hint = _compose_landing_hint(
            "You were wrestling with dryness in prayer.", [], [], []
        )
        assert hint is not None
        assert hint.startswith("Last time, you were")


# =============================================================================
# Issue 7 — evidence-enforced no-fabrication grounding
# =============================================================================
class TestMemoryGroundingV4:
    def test_empty_memory_context_declares_no_record(self):
        ctx = _format_memory_for_context([])
        assert "NO stored record" in ctx or "no stored record" in ctx.lower()

    def test_system_message_has_grounding_block(self):
        sysmsg = _build_session_system_message([], [], 0, None)
        assert "MEMORY GROUNDING" in sysmsg
        assert "reliable memory" in sysmsg.lower()

    def test_system_message_grounding_present_with_memory(self):
        mem = [{"kind": "struggle", "content": "I'm anxious about work", "scripture_ref": None}]
        sysmsg = _build_session_system_message(mem, [], 1, None)
        assert "MEMORY GROUNDING" in sysmsg
        assert "ONLY record" in sysmsg


class TestMemoryGroundingV5:
    def test_directive_no_record_branch_when_recap_empty(self):
        d = TurnDirective(stance="arrive", length_hint_tokens=220, memory_recap=None)
        rendered = d.render()
        assert "MEMORY GROUNDING" in rendered
        assert "NO stored record" in rendered
        # Must NOT emit the "ONLY record" (has-memory) directive.
        assert "ONLY record" not in rendered

    def test_directive_only_record_branch_when_recap_present(self):
        d = TurnDirective(
            stance="listen",
            length_hint_tokens=380,
            memory_recap="You have walked with this person across 3 conversation(s).",
        )
        rendered = d.render()
        assert "MEMORY GROUNDING" in rendered
        assert "ONLY record" in rendered

    def test_recap_none_when_no_retrieved_evidence(self):
        # No summaries AND no active memory => no recap => no-record branch.
        recap = build_memory_recap(
            session_count=4,
            tenure_hint="the past few weeks",
            recent_summaries=[],
            active_memory=[],
        )
        assert recap is None

    def test_recap_present_when_evidence_exists(self):
        recap = build_memory_recap(
            session_count=2,
            tenure_hint=None,
            recent_summaries=["You were wrestling with a decision about a job change."],
            active_memory=[],
        )
        assert recap is not None
        assert "recent conversations" in recap.lower()

    def test_voice_prompt_has_memory_integrity_invariant(self):
        assert "MEMORY INTEGRITY" in WALK_VOICE_PROMPT_V5
        assert "No evidence in the recap means no memory claim" in WALK_VOICE_PROMPT_V5
