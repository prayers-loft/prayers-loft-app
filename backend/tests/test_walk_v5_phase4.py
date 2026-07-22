"""
Unit tests for Walk V5 Phase 4 — dynamic openers and closings.

Coverage (the exact list required by the Phase 4 approval):
  - first-ever session
  - returning user with no usable memory
  - returning user after grief
  - returning user after celebration
  - returning user with unfinished commitment
  - user saying "thanks" mid-conversation (closing gate)
  - user clearly saying goodnight
  - user closing after grief (closing gate)
  - multiple sessions verifying closing shapes do not repeat mechanically
  - no false claims of memory or continuity

Pure Python. Execute with:
    cd /app/backend && python -m pytest tests/test_walk_v5_phase4.py -v
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from walk_v5 import (  # noqa: E402
    derive_opener_context,
    should_gate_closing,
    classify_stance,
    pick_closing_shape,
    CLOSING_SHAPES,
    WALK_VOICE_PROMPT_V5,
    _OPENER_CONTEXT_GUIDANCE,
    build_v5_messages,
    TurnDirective,
)


# =============================================================================
# 1. Opener context detection
# =============================================================================
class TestOpenerContext:
    def test_first_ever_session(self):
        ctx = derive_opener_context(
            session_count=0, last_session_summary=None, active_memory=[]
        )
        assert ctx == "first_ever"

    def test_returning_no_memory(self):
        # Prior sessions exist but no usable summary and no active memory.
        ctx = derive_opener_context(
            session_count=3, last_session_summary=None, active_memory=[]
        )
        assert ctx == "returning_no_memory"

    def test_returning_no_memory_empty_string_summary(self):
        # Empty-string summary is also treated as no-memory (never fake recall).
        ctx = derive_opener_context(
            session_count=3, last_session_summary="   ", active_memory=[]
        )
        assert ctx == "returning_no_memory"

    def test_returning_after_grief(self):
        ctx = derive_opener_context(
            session_count=2,
            last_session_summary="Grieving the death of a father three weeks ago; feeling numb rather than angry.",
            active_memory=[],
        )
        assert ctx == "returning_after_grief"

    def test_returning_after_celebration(self):
        ctx = derive_opener_context(
            session_count=4,
            last_session_summary="Rejoicing over answered prayer and coming to peace with waiting.",
            active_memory=[],
        )
        assert ctx == "returning_after_celebration"

    def test_returning_with_open_commitment(self):
        ctx = derive_opener_context(
            session_count=5,
            last_session_summary="Turning toward confession instead of hiding after a difficult week.",
            active_memory=[
                {"kind": "commitment", "content": "text my accountability friend on Sundays", "status": "active"},
            ],
        )
        assert ctx == "returning_with_open_commitment"

    def test_crisis_summary_takes_priority_over_grief(self):
        # Safety-first: crisis-flavor summary wins even if grief keywords also present.
        ctx = derive_opener_context(
            session_count=2,
            last_session_summary="Suicidal thoughts named openly; encouraged to reach a person tonight.",
            active_memory=[],
        )
        assert ctx == "returning_after_crisis"

    def test_returning_general_when_summary_is_neutral(self):
        ctx = derive_opener_context(
            session_count=3,
            last_session_summary="Wrestling with a decision about a job change and asking for wisdom.",
            active_memory=[],
        )
        assert ctx == "returning_general"


# =============================================================================
# 2. Turn-0 directive rendering — first-message-as-witness/offer, no LLM
#    opener call, no assistant message stored before user speaks
# =============================================================================
class TestTurnZeroDirective:
    def _build(self, user_text, **kwargs):
        """Helper — build messages/stance for a first-turn user message."""
        defaults = dict(
            session_count=kwargs.pop("session_count", 0),
            tenure_hint=kwargs.pop("tenure_hint", None),
            recent_summaries=kwargs.pop("recent_summaries", []),
            active_memory=kwargs.pop("active_memory", []),
            recent_closing_shapes=[],
            recent_assistant_messages=[],
            owner_key="u:t0-test",
            transcript_block="",
            stance_history=[],
            prior_user_texts=[],
            depth_surfaced_before=False,
            last_session_summary=kwargs.pop("last_session_summary", None),
            prior_stance=None,
        )
        defaults.update(kwargs)
        return build_v5_messages(user_text=user_text, turn_index=0, **defaults)

    def test_first_ever_grief_classifies_as_witness(self):
        msgs, stance, _, _ = self._build("my mom died last month")
        assert stance == "witness"
        assert "OPENER CONTEXT — FIRST-EVER SESSION" in msgs[1]["content"]

    def test_first_ever_confession_classifies_as_witness(self):
        msgs, stance, _, _ = self._build(
            "i cheated on my wife and no one knows"
        )
        assert stance == "witness"

    def test_first_ever_celebration_classifies_as_witness(self):
        msgs, stance, _, _ = self._build(
            "praise God — i finally got the job i was praying for"
        )
        assert stance == "witness"

    def test_first_ever_crisis_classifies_as_crisis(self):
        msgs, stance, _, _ = self._build(
            "i've been thinking about ending my life"
        )
        assert stance == "crisis"

    def test_first_ever_theological_question_offers_direct_answer(self):
        msgs, stance, _, _ = self._build(
            "what does scripture say about baptism — is it required for salvation?"
        )
        assert stance == "offer"

    def test_first_ever_normal_checkin_arrives(self):
        msgs, stance, _, _ = self._build("hey — just thought i'd check in")
        assert stance == "arrive"

    def test_returning_grief_still_witness_with_grief_context(self):
        # Returning user opens with grief. Stance = witness, opener_context
        # = returning_after_grief.
        msgs, stance, _, _ = self._build(
            "my dad is gone",
            session_count=2,
            recent_summaries=["Grieving the death of a father three weeks ago."],
            last_session_summary="Grieving the death of a father three weeks ago.",
        )
        assert stance == "witness"
        assert "RETURNING AFTER GRIEF" in msgs[1]["content"]

    def test_returning_neutral_first_message_arrives_with_returning_context(self):
        msgs, stance, _, _ = self._build(
            "hey — just checking in today",
            session_count=3,
            recent_summaries=["Wrestling with a decision about a job change."],
            last_session_summary="Wrestling with a decision about a job change.",
        )
        assert stance == "arrive"
        # Returning-general context should be surfaced.
        content = msgs[1]["content"].upper()
        assert "RETURNING" in content

    def test_returning_no_memory_directive_forbids_fake_recall(self):
        # Returning user with prior sessions but no summary → no_memory context.
        msgs, stance, _, _ = self._build(
            "hey",
            session_count=3,
            recent_summaries=[],
            last_session_summary=None,
        )
        assert stance == "arrive"
        content = msgs[1]["content"].lower()
        assert "returning with no usable memory" in content
        assert "do not invent" in content or "cannot honestly" in content
        # Must not contain a memory recap section (nothing substantive).
        assert "WHAT YOU KNOW ABOUT THIS PERSON" not in msgs[1]["content"]

    def test_opener_context_renders_on_witness_stance(self):
        # Turn 0 grief → witness stance BUT opener_context still fires.
        msgs, stance, _, _ = self._build(
            "my mom died",
            session_count=1,
            recent_summaries=["Grieving the loss of a mother; feeling numb."],
            last_session_summary="Grieving the loss of a mother; feeling numb.",
        )
        assert stance == "witness"
        # Opener context guidance must appear even though stance != arrive.
        assert "RETURNING AFTER GRIEF" in msgs[1]["content"]


# =============================================================================
# 3. Opener directive rendering — check guidance content
# =============================================================================
class TestOpenerDirectiveContent:
    def test_first_ever_directive_forbids_prior_reference(self):
        directive_content = _OPENER_CONTEXT_GUIDANCE["first_ever"]
        # First-ever must forbid inventing prior sessions.
        assert "no prior sessions" in directive_content.lower() or \
               "there are none" in directive_content.lower()

    def test_no_memory_directive_forbids_fake_recall(self):
        directive_content = _OPENER_CONTEXT_GUIDANCE["returning_no_memory"]
        # Must explicitly warn against inventing continuity.
        assert "do not invent" in directive_content.lower() or \
               "cannot honestly" in directive_content.lower()

    def test_grief_return_directive_is_gentle(self):
        directive_content = _OPENER_CONTEXT_GUIDANCE["returning_after_grief"]
        assert "gently" in directive_content.lower() or \
               "quiet" in directive_content.lower()
        assert "not force" in directive_content.lower() or \
               "let them speak first" in directive_content.lower()

    def test_celebration_return_directive_matches_warmth(self):
        directive_content = _OPENER_CONTEXT_GUIDANCE["returning_after_celebration"]
        assert "not force" in directive_content.lower() or \
               "if it fits" in directive_content.lower() or \
               "light acknowledgement" in directive_content.lower()

    def test_open_commitment_directive_forbids_auditing(self):
        directive_content = _OPENER_CONTEXT_GUIDANCE["returning_with_open_commitment"]
        assert "audit" in directive_content.lower()

    def test_no_opener_directive_contains_hardcoded_greeting(self):
        # V4 hardcoded phrases must not leak into V5 opener guidance.
        for ctx_key in _OPENER_CONTEXT_GUIDANCE:
            guidance = _OPENER_CONTEXT_GUIDANCE[ctx_key]
            assert "Hi. I'm glad you're here" not in guidance
            assert "It's good to see you again" not in guidance
            assert "continue where we left off" not in guidance


# =============================================================================
# 3. Closing gate — do not force close on unresolved contexts
# =============================================================================
class TestClosingGate:
    def test_thanks_after_normal_conversation_closes(self):
        # Ordinary conversation, no unresolved markers, no crisis → close.
        stance, s = classify_stance(
            5,
            "thanks",
            prior_user_texts=[
                "i've been thinking about the sermon on grace",
                "yeah that framing helps",
                "makes sense",
            ],
            stance_history=["listen", "explore", "understand", "offer"],
            depth_surfaced_before=False,
        )
        assert s["closing"] is True
        assert stance == "close"

    def test_thanks_mid_grief_does_not_close(self):
        # User says "thanks" but context is unresolved grief and no offer
        # has been reached — the gate must hold this back from closing.
        stance, s = classify_stance(
            3,
            "thanks",
            prior_user_texts=[
                "my mom died last week",
                "i just feel numb",
            ],
            stance_history=["listen", "witness"],
            depth_surfaced_before=True,
        )
        assert s["closing"] is True
        # Gate should hold; assistant continues in witness rather than closing.
        assert stance == "witness"

    def test_thanks_after_confession_shame_gate_holds(self):
        # Confession + shame + no offer reached → do not close on "thanks".
        stance, _ = classify_stance(
            3,
            "thanks",
            prior_user_texts=[
                "i cheated on my wife",
                "i've been hiding it and i'm ashamed",
            ],
            stance_history=["listen", "witness"],
            depth_surfaced_before=True,
        )
        assert stance == "witness"

    def test_thanks_after_crisis_gate_holds(self):
        stance, _ = classify_stance(
            3,
            "thanks",
            prior_user_texts=[
                "i've been thinking about ending my life",
                "just wanted to tell someone",
            ],
            stance_history=["listen", "crisis"],
            depth_surfaced_before=True,
        )
        # Crisis in stance_history's tail → gate holds; not close.
        assert stance != "close"

    def test_goodnight_after_resolution_closes(self):
        # Normal resolved conversation → goodnight closes.
        stance, _ = classify_stance(
            6,
            "goodnight",
            prior_user_texts=[
                "i've been anxious about work",
                "it's the deadlines",
                "yeah",
                "that framing helps",
                "i'll try it",
            ],
            stance_history=["listen", "explore", "discern", "understand", "offer"],
            depth_surfaced_before=True,
        )
        assert stance == "close"

    def test_goodnight_after_grief_gate_holds(self):
        # Even a clear "goodnight" holds when grief is still raw.
        stance, _ = classify_stance(
            3,
            "goodnight",
            prior_user_texts=[
                "we lost the baby last night",
                "i don't know how to sleep",
            ],
            stance_history=["listen", "witness"],
            depth_surfaced_before=True,
        )
        # Gate holds — remains in witness rather than sending them off raw.
        assert stance == "witness"

    def test_should_gate_closing_helper_direct(self):
        # Direct helper tests for auditability.
        # 1. Unresolved grief + no offer → gate.
        assert should_gate_closing(
            prior_user_texts=["my mom died three weeks ago", "still numb"],
            stance_history=["listen", "witness"],
            depth_surfaced_before=True,
        ) is True
        # 2. Resolution reached → no gate.
        assert should_gate_closing(
            prior_user_texts=["my mom died three weeks ago"],
            stance_history=["listen", "witness", "witness", "understand", "offer"],
            depth_surfaced_before=True,
        ) is False
        # 3. Crisis in recent history → gate.
        assert should_gate_closing(
            prior_user_texts=["im really struggling"],
            stance_history=["listen", "crisis"],
            depth_surfaced_before=True,
        ) is True
        # 4. Empty/normal conversation → no gate.
        assert should_gate_closing(
            prior_user_texts=["hi", "just checking in"],
            stance_history=["listen"],
            depth_surfaced_before=False,
        ) is False


# =============================================================================
# 4. Closing-shape rotation — cross-session, no mechanical repeats
# =============================================================================
class TestClosingShapeRotation:
    def test_rotation_avoids_repeats(self):
        # After 4 sessions, we should have seen 4 distinct shapes.
        owner = "u:rotation-test"
        recent: list = []
        picked = []
        for i in range(4):
            shape = pick_closing_shape(recent, owner)
            picked.append(shape)
            recent.append(shape)
        # All 4 must be distinct (rotation avoids last 3).
        assert len(set(picked)) == 4, f"expected all distinct, got {picked}"

    def test_shapes_available_gt_ban_window(self):
        # We have >3 closing shapes, so rotation always has a candidate.
        assert len(CLOSING_SHAPES) > 3

    def test_multiple_sessions_no_mechanical_repeat(self):
        # 8 rotations for one owner — no shape appears twice in a row nor
        # 3-in-a-row.
        owner = "u:beta-user-1"
        recent: list = []
        picked = []
        for i in range(8):
            shape = pick_closing_shape(recent, owner)
            picked.append(shape)
            recent.append(shape)
        # Guarantee: no consecutive repeats.
        for i in range(1, len(picked)):
            assert picked[i] != picked[i-1], f"consecutive repeat at {i}: {picked}"
        # Guarantee: no shape appears 3 times in a rolling 3-window.
        for i in range(2, len(picked)):
            trio = picked[i-2:i+1]
            assert len(set(trio)) == 3, f"triple appeared at {i}: {picked}"


# =============================================================================
# 5. No false continuity — safety guards
# =============================================================================
class TestNoFalseContinuity:
    def test_first_ever_directive_contains_no_prior_reference(self):
        directive = _OPENER_CONTEXT_GUIDANCE["first_ever"]
        # First-ever must NOT hint at prior conversations.
        lc = directive.lower()
        assert "last time" not in lc
        assert "when we talked" not in lc
        assert "we discussed" not in lc

    def test_no_memory_directive_forbids_last_time(self):
        directive = _OPENER_CONTEXT_GUIDANCE["returning_no_memory"]
        lc = directive.lower()
        # Must explicitly warn against fake continuity.
        assert "do not" in lc or "cannot" in lc
        assert "invent" in lc or "honestly" in lc

    def test_returning_general_does_not_prescribe_recall(self):
        # Returning general should NOT force the model to open with a recall.
        directive = _OPENER_CONTEXT_GUIDANCE["returning_general"]
        lc = directive.lower()
        # Should mention using memory as mental model, not recital.
        assert "mental model" in lc or "not as something to recite" in lc

    def test_opener_context_for_no_summary_and_no_memory_is_no_memory(self):
        # Real edge case: user has prior sessions but everything got wiped
        # or their sessions had no user turns. Must return no_memory, not
        # invent something.
        ctx = derive_opener_context(
            session_count=5, last_session_summary=None, active_memory=[]
        )
        assert ctx == "returning_no_memory"


# =============================================================================
# 6. Integration smoke — build a full turn-0 payload end-to-end
# =============================================================================
class TestTurnZeroPayloadIntegration:
    def test_first_ever_neutral_payload_structure(self):
        msgs, stance, _, mt = build_v5_messages(
            user_text="hey there",
            turn_index=0,
            prior_stance=None,
            session_count=0,
            tenure_hint=None,
            recent_summaries=[],
            active_memory=[],
            recent_closing_shapes=[],
            recent_assistant_messages=[],
            owner_key="u:new-user",
            transcript_block="",
        )
        assert len(msgs) == 3
        assert msgs[0]["role"] == "system"
        assert msgs[1]["role"] == "system"
        assert msgs[2]["role"] == "user"
        assert msgs[2]["content"] == "hey there"
        # Voice message contains identity, not a fictional character.
        assert "Prayers Loft" in msgs[0]["content"]
        assert "not a person" in msgs[0]["content"].lower()
        # Turn directive contains ARRIVE stance and FIRST-EVER context.
        assert "ARRIVE" in msgs[1]["content"]
        assert "FIRST-EVER" in msgs[1]["content"]
        assert stance == "arrive"
        # max_tokens stays tight for arrive.
        assert 150 <= mt <= 400

    def test_returning_after_grief_first_message_has_recap(self):
        msgs, stance, _, _ = build_v5_messages(
            user_text="hey",
            turn_index=0,
            prior_stance=None,
            session_count=3,
            tenure_hint="the past few weeks",
            recent_summaries=[
                "Grieving the loss of a father three weeks ago.",
                "Wrestling with numbness and the exhaustion of mourning.",
            ],
            active_memory=[],
            recent_closing_shapes=[],
            recent_assistant_messages=[],
            owner_key="u:grief-user",
            transcript_block="",
            last_session_summary="Grieving the loss of a father three weeks ago.",
        )
        # Memory recap should be present in the directive.
        assert "WHAT YOU KNOW ABOUT THIS PERSON" in msgs[1]["content"]
        # Grief-return opener context guidance is present.
        assert "GRIEF" in msgs[1]["content"]
        assert stance == "arrive"
