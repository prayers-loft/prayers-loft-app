"""
Unit tests for the Walk V5 discovery-arc classifier (Build 26B, Phase 2).

Coverage:
  - Stance priority order (crisis, close, witness, correction, subject-change,
    advice/theology, interview-avoidance, discern, understand-progression,
    turn-1 default, gathering default).
  - Every stance transition path.
  - The 12 required scenarios enumerated in the Phase 2 approval:
      1.  grief
      2.  confession
      3.  lust/temptation
      4.  marital conflict
      5.  direct theological question
      6.  vague emotional distress
      7.  celebration
      8.  answered prayer
      9.  user asking for immediate practical advice
      10. crisis language
      11. user changing the subject mid-conversation
      12. user correcting the assistant's interpretation

Tests are pure Python; no LLM calls, no database. Execute with:
    cd /app/backend && python -m pytest tests/test_walk_v5_classifier.py -v
"""
from __future__ import annotations

import os
import sys

# Make the backend package importable when running via pytest.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from walk_v5 import (  # noqa: E402
    classify_stance,
    detect_depth_surfaced,
    pick_closing_shape,
    build_variety_hint,
    build_memory_recap,
    STANCE_TOKEN_BUDGET,
    CLOSING_SHAPES,
)


# ---------------------------------------------------------------------------
# 1. PRIORITY: crisis ALWAYS overrides
# ---------------------------------------------------------------------------
class TestCrisisPriority:
    def test_crisis_on_turn_0_overrides_arrive(self):
        stance, s = classify_stance(0, "I want to kill myself tonight")
        assert stance == "crisis"
        assert s["crisis"] is True

    def test_crisis_overrides_closing(self):
        stance, _ = classify_stance(5, "thanks. I might just end my life")
        assert stance == "crisis"

    def test_crisis_overrides_advice_request(self):
        stance, _ = classify_stance(
            3, "what should I do — I keep thinking about suicide"
        )
        assert stance == "crisis"

    def test_crisis_overrides_grief(self):
        stance, _ = classify_stance(
            2, "my dad died and I want to die too"
        )
        assert stance == "crisis"

    def test_crisis_various_wordings(self):
        for msg in [
            "i'm suicidal",
            "there's no reason to live anymore",
            "he hits me every night",
            "i've been hurting myself",
            "i just want to disappear from everything",
        ]:
            stance, _ = classify_stance(2, msg, stance_history=["listen"])
            assert stance == "crisis", f"missed crisis for: {msg}"


# ---------------------------------------------------------------------------
# 2. Turn 0 arrive
# ---------------------------------------------------------------------------
class TestArrivePriority:
    def test_first_turn_is_arrive(self):
        stance, _ = classify_stance(0, "hey")
        assert stance == "arrive"

    def test_first_turn_arrive_even_with_grief(self):
        # Turn 0 = arrive unless crisis. Grief still gets a gentle opening.
        # The next turn will route to witness.
        stance, _ = classify_stance(0, "my grandmother died last week")
        # NB: crisis wins over arrive; grief does not (grief != crisis)
        assert stance == "arrive"


# ---------------------------------------------------------------------------
# 3. Closing signals
# ---------------------------------------------------------------------------
class TestClosePriority:
    def test_bare_thanks_closes(self):
        stance, _ = classify_stance(
            4, "thanks", stance_history=["listen", "explore", "understand"]
        )
        assert stance == "close"

    def test_amen_closes(self):
        stance, _ = classify_stance(5, "amen", stance_history=["offer"])
        assert stance == "close"

    def test_goodnight_closes(self):
        stance, _ = classify_stance(3, "goodnight", stance_history=["listen"])
        assert stance == "close"

    def test_thanks_in_body_does_not_close(self):
        # "thanks for the story about grace" is NOT a close.
        stance, _ = classify_stance(
            3, "thanks for the story about grace — that landed",
            stance_history=["offer"],
        )
        assert stance != "close"

    def test_will_do_that_closes(self):
        stance, _ = classify_stance(
            5, "i'll do that", stance_history=["offer"]
        )
        assert stance == "close"


# ---------------------------------------------------------------------------
# 4. Witness priority — grief / celebration / confession
# ---------------------------------------------------------------------------
class TestWitnessPriority:
    def test_grief_routes_to_witness(self):
        stance, s = classify_stance(
            2, "my dad died three weeks ago and I still feel numb",
            stance_history=["listen"],
        )
        assert stance == "witness"
        assert s["grief"] is True

    def test_celebration_routes_to_witness(self):
        stance, s = classify_stance(
            3, "God did it — she finally said yes and we're getting married",
            stance_history=["listen", "explore"],
        )
        assert stance == "witness"
        assert s["celebration"] is True

    def test_confession_routes_to_witness(self):
        stance, s = classify_stance(
            2, "i lied to my wife about the money. i've been hiding it for months",
            stance_history=["listen"],
        )
        assert stance == "witness"
        assert s["confession"] is True

    def test_answered_prayer_routes_to_witness(self):
        stance, _ = classify_stance(
            3, "my prayer for my mom was answered — she came home yesterday",
            stance_history=["listen", "explore"],
        )
        assert stance == "witness"

    def test_witness_wins_over_advice_request(self):
        # User is confessing AND asking what to do. Witness takes priority
        # THIS turn; next turn (with new signals) may route to offer.
        stance, _ = classify_stance(
            3,
            "i cheated on her. what should i do now",
            stance_history=["listen", "explore"],
        )
        assert stance == "witness"


# ---------------------------------------------------------------------------
# 5. Correction downgrades
# ---------------------------------------------------------------------------
class TestCorrectionDowngrade:
    def test_correction_after_understand_goes_to_explore(self):
        stance, s = classify_stance(
            4, "no, that's not what i meant at all",
            stance_history=["listen", "explore", "discern", "understand"],
        )
        assert stance == "explore"
        assert s["correction"] is True

    def test_correction_after_offer_goes_to_explore(self):
        stance, _ = classify_stance(
            5, "actually, that's not it — you're missing what i'm saying",
            stance_history=["explore", "discern", "understand", "offer"],
        )
        assert stance == "explore"

    def test_correction_after_discern_goes_to_listen(self):
        stance, _ = classify_stance(
            4, "no. it's not that.",
            stance_history=["listen", "explore", "discern"],
        )
        assert stance == "listen"

    def test_no_correction_signal_when_no_prior_interpretation(self):
        # "actually" said early in a conversation is not a correction —
        # there is no interpretation to correct yet.
        stance, s = classify_stance(
            1, "actually i've been thinking about this for a while",
            stance_history=[],
        )
        assert s["correction"] is False


# ---------------------------------------------------------------------------
# 6. Subject change
# ---------------------------------------------------------------------------
class TestSubjectChange:
    def test_subject_change_routes_to_listen(self):
        prior = [
            "i've been feeling anxious at work lately",
            "my manager keeps stacking projects",
        ]
        stance, s = classify_stance(
            3,
            "actually can we talk about my marriage — my wife barely speaks to me anymore",
            prior_user_texts=prior,
            stance_history=["listen", "explore", "explore"],
        )
        # subject_change detection should fire on new nouns; new stance = listen.
        assert stance == "listen"
        assert s["subject_change"] is True

    def test_same_topic_does_not_route_to_listen(self):
        prior = ["i've been feeling anxious at work"]
        stance, s = classify_stance(
            2,
            "anxious is really the word — work has been crushing",
            prior_user_texts=prior,
            stance_history=["listen"],
        )
        assert s["subject_change"] is False


# ---------------------------------------------------------------------------
# 7. Advice / theology priority (with emotional-complexity guard)
# ---------------------------------------------------------------------------
class TestAdvicePriority:
    def test_simple_advice_request_routes_to_offer(self):
        stance, s = classify_stance(
            2,
            "what should i do — should i text her and apologize",
            stance_history=["listen"],
        )
        assert stance == "offer"
        assert s["advice_request"] is True

    def test_advice_in_emotional_complexity_routes_to_explore_first(self):
        stance, s = classify_stance(
            2,
            "should i divorce him — the affair changed everything and i can't stop grieving",
            stance_history=["listen"],
            depth_surfaced_before=False,
        )
        assert stance == "explore"
        assert s["emotional_complexity"] is True

    def test_advice_after_depth_surfaced_and_recent_explore_goes_to_discern(self):
        stance, _ = classify_stance(
            4,
            "so what do you think i should do about this",
            stance_history=["listen", "explore", "explore"],
            depth_surfaced_before=True,
        )
        assert stance == "discern"

    def test_theological_question_routes_to_offer(self):
        stance, s = classify_stance(
            2,
            "what does the bible say about predestination?",
            stance_history=["listen"],
        )
        assert stance == "offer"
        assert s["theological_question"] is True

    def test_theological_question_without_question_mark_is_not_flagged(self):
        # "what the bible says about..." said as a statement, not a question.
        stance, s = classify_stance(
            2,
            "i keep thinking about what the bible says about anxiety.",
            stance_history=["listen"],
        )
        assert s["theological_question"] is False


# ---------------------------------------------------------------------------
# 8. Interview avoidance — chained explore promotes to discern
# ---------------------------------------------------------------------------
class TestInterviewAvoidance:
    def test_two_consecutive_explores_promotes_to_discern(self):
        stance, _ = classify_stance(
            4,
            "yeah i guess it comes up in the evening when the house is quiet",
            stance_history=["listen", "explore", "explore"],
        )
        assert stance == "discern"

    def test_three_explores_still_promotes(self):
        stance, _ = classify_stance(
            5,
            "not sure i can put words to it",
            stance_history=["listen", "explore", "explore", "explore"],
        )
        assert stance == "discern"

    def test_broken_explore_chain_does_not_promote(self):
        # explore -> listen -> explore is NOT chained; safe to explore again.
        stance, _ = classify_stance(
            4,
            "and there's more i've been holding back",
            stance_history=["explore", "listen", "explore"],
        )
        # We're on turn 4 with prior stance = explore (not chained).
        # No depth surfaced this turn, no other trigger. Default => explore.
        # Interview rule needs >=2 consecutive from the end; last consecutive
        # explores count = 1 (just the last one). Does not promote.
        assert stance == "explore"


# ---------------------------------------------------------------------------
# 9. Discern → understand → offer natural progression
# ---------------------------------------------------------------------------
class TestNaturalProgression:
    def test_discern_progresses_to_understand(self):
        stance, _ = classify_stance(
            5,
            "yeah… i think that's part of it",
            stance_history=["listen", "explore", "explore", "discern"],
            depth_surfaced_before=True,
        )
        assert stance == "understand"

    def test_understand_progresses_to_offer(self):
        stance, _ = classify_stance(
            6,
            "that lands. i've never named it that way",
            stance_history=["listen", "explore", "discern", "understand"],
            depth_surfaced_before=True,
        )
        assert stance == "offer"


# ---------------------------------------------------------------------------
# 10. Depth surfacing
# ---------------------------------------------------------------------------
class TestDepthSurfacing:
    def test_first_time_depth_marker_routes_to_discern(self):
        stance, s = classify_stance(
            3,
            "i think honestly i've just been so lonely lately",
            stance_history=["listen", "explore"],
            depth_surfaced_before=False,
        )
        assert stance == "discern"
        assert s["depth_surfaced"] is True

    def test_detect_depth_surfaced_public_helper(self):
        assert detect_depth_surfaced("i just feel so ashamed") is True
        assert detect_depth_surfaced("it's been a tough week") is False


# ---------------------------------------------------------------------------
# 11. Turn 1 default is listen
# ---------------------------------------------------------------------------
class TestTurn1Default:
    def test_turn_1_defaults_to_listen(self):
        stance, _ = classify_stance(1, "hey — just thinking about faith today")
        assert stance == "listen"

    def test_turn_2_defaults_to_explore(self):
        stance, _ = classify_stance(
            2, "yeah kind of hard to explain",
            stance_history=["listen"],
        )
        assert stance == "explore"


# ---------------------------------------------------------------------------
# 12. Non-linear: backward movement on new information
# ---------------------------------------------------------------------------
class TestNonLinearMovement:
    def test_subject_change_walks_back_from_offer(self):
        prior = [
            "i've been anxious about work",
            "my manager is stacking projects",
            "i can't sleep",
        ]
        stance, _ = classify_stance(
            4,
            "so — different thing — my daughter told me she doesn't want to go to church anymore",
            prior_user_texts=prior,
            stance_history=["listen", "explore", "understand", "offer"],
        )
        # New subject → back to listen, not forward to a new offer.
        assert stance == "listen"


# =============================================================================
# 13. The 12 required scenarios (Phase 2 approval checklist)
# =============================================================================
class TestRequiredScenarios:
    def test_scenario_1_grief(self):
        stance, s = classify_stance(
            2,
            "my mom died three weeks ago and i can't stop crying at random times of day",
            stance_history=["arrive", "listen"] if False else ["listen"],
        )
        assert stance == "witness"
        assert s["grief"] is True

    def test_scenario_2_confession(self):
        stance, s = classify_stance(
            2,
            "i cheated on my wife. no one knows. i've been carrying it for months",
            stance_history=["listen"],
        )
        assert stance == "witness"
        assert s["confession"] is True

    def test_scenario_3_lust_temptation(self):
        # A person opens with lust/temptation. Turn 2 with no depth
        # markers yet. Should be explore (gather what's underneath).
        stance, _ = classify_stance(
            2,
            "i keep falling into porn on sunday nights. i don't know why i can't stop",
            stance_history=["listen"],
        )
        assert stance == "explore"

    def test_scenario_3b_lust_temptation_with_depth(self):
        # Same, but the user has already surfaced depth ("lonely").
        stance, _ = classify_stance(
            3,
            "honestly i think it's because i'm just so lonely on those nights",
            stance_history=["listen", "explore"],
            depth_surfaced_before=False,
        )
        # Depth surfacing THIS turn → discern.
        assert stance == "discern"

    def test_scenario_4_marital_conflict(self):
        # Marital conflict AND advice request. Emotionally complex.
        # Depth not yet surfaced → explore, not offer.
        stance, _ = classify_stance(
            2,
            "my wife and i haven't really spoken in weeks. should i be the one to break the silence",
            stance_history=["listen"],
            depth_surfaced_before=False,
        )
        assert stance == "explore"

    def test_scenario_5_direct_theological_question(self):
        stance, _ = classify_stance(
            2,
            "what does scripture say about baptism — is it required for salvation?",
            stance_history=["listen"],
        )
        assert stance == "offer"

    def test_scenario_6_vague_emotional_distress(self):
        # Vague, no specific advice ask, no closing/crisis/grief. Turn 2.
        # Should be explore — we don't know enough yet.
        stance, _ = classify_stance(
            2,
            "i don't know, i've just been off lately",
            stance_history=["listen"],
        )
        assert stance == "explore"

    def test_scenario_7_celebration(self):
        stance, s = classify_stance(
            2,
            "praise God — i finally got the promotion after two years of praying",
            stance_history=["listen"],
        )
        assert stance == "witness"
        assert s["celebration"] is True

    def test_scenario_8_answered_prayer(self):
        stance, s = classify_stance(
            2,
            "the prayer i've been carrying for my brother was finally answered — he came home",
            stance_history=["listen"],
        )
        assert stance == "witness"
        assert s["celebration"] is True

    def test_scenario_9_immediate_practical_advice(self):
        # Simple, actionable, low-emotional-complexity ask.
        stance, _ = classify_stance(
            2,
            "should i text my brother to apologize tonight or wait till morning",
            stance_history=["listen"],
        )
        assert stance == "offer"

    def test_scenario_10_crisis(self):
        stance, _ = classify_stance(
            2,
            "i've been planning how to end my life and i don't know why i'm telling you",
            stance_history=["listen"],
        )
        assert stance == "crisis"

    def test_scenario_11_subject_change_mid_conversation(self):
        prior = [
            "i've been struggling with anger toward my dad",
            "he was never around growing up",
        ]
        stance, s = classify_stance(
            3,
            "so different topic — i've also been really doubting whether my church is healthy",
            prior_user_texts=prior,
            stance_history=["listen", "explore"],
        )
        assert stance == "listen"
        assert s["subject_change"] is True

    def test_scenario_12_user_corrects_interpretation(self):
        stance, s = classify_stance(
            4,
            "no — that's not quite it. it isn't about my dad. it's more about who i became to survive him",
            stance_history=["listen", "explore", "discern", "understand"],
        )
        assert stance == "explore"
        assert s["correction"] is True


# =============================================================================
# 14. Supporting utilities
# =============================================================================
class TestSupportingUtils:
    def test_stance_token_budget_covers_all_stances(self):
        stances = ["arrive", "listen", "explore", "discern", "understand",
                   "offer", "witness", "close", "crisis"]
        for s in stances:
            assert s in STANCE_TOKEN_BUDGET, f"missing budget for {s}"

    def test_closing_shape_rotator_avoids_recent(self):
        recent = ["blessing", "silence", "one_line_prayer"]
        shape = pick_closing_shape(recent, "u:test-user-1")
        assert shape not in recent

    def test_closing_shape_rotator_deterministic_per_owner(self):
        # Same input → same output.
        a = pick_closing_shape([], "u:owner-x")
        b = pick_closing_shape([], "u:owner-x")
        assert a == b
        # Different owners MAY produce different shapes.
        c = pick_closing_shape([], "u:owner-y")
        # Not an assertion of inequality — just verify determinism per owner.
        d = pick_closing_shape([], "u:owner-y")
        assert c == d

    def test_variety_hint_detects_repeated_shape(self):
        h = build_variety_hint([
            "One thing that stands out to me is that this pattern loops.",
            "One thing I've noticed is that you feel exhausted.",
        ])
        assert h is not None
        assert "vary" in h.lower() or "shape" in h.lower()

    def test_variety_hint_none_when_no_repetition(self):
        h = build_variety_hint([
            "That must be exhausting to carry.",
            "It sounds like the weight has become quiet in you.",
        ])
        assert h is None

    def test_memory_recap_first_ever_returns_none(self):
        assert build_memory_recap(0, None, [], []) is None

    def test_memory_recap_composes_prose(self):
        r = build_memory_recap(
            session_count=5,
            tenure_hint="the past few weeks",
            recent_summaries=[
                "Wrestling with dryness in prayer and quietly wondering if God still notices them.",
            ],
            active_memory=[
                {"kind": "struggle", "content": "I'm struggling with lust on Sunday nights"},
            ],
        )
        assert r is not None
        assert "wrestling with dryness" in r.lower()
        assert "lust on sunday nights" in r.lower()


# =============================================================================
# 15. Regression guards — behaviors we DO NOT want
# =============================================================================
class TestRegressions:
    def test_advice_request_does_not_skip_witness_for_grief(self):
        # User asks for advice AND is grieving. Grief takes priority.
        stance, _ = classify_stance(
            3,
            "my father died last month — what should i do about the funeral leftovers",
            stance_history=["listen", "explore"],
        )
        # Grief is a stronger signal than advice request. Witness wins.
        assert stance == "witness"

    def test_arrive_does_not_repeat_after_turn_0(self):
        stance, _ = classify_stance(1, "hi again", stance_history=["arrive"])
        # After turn 0, arrive should not recur unless we explicitly reset.
        assert stance != "arrive"

    def test_bare_question_mark_does_not_trigger_theology(self):
        # Emotional venting phrased as a question is NOT a theological ask.
        stance, s = classify_stance(
            2,
            "why is this so hard for me?",
            stance_history=["listen"],
        )
        assert s["theological_question"] is False

    def test_emotional_complexity_accumulates_across_turns(self):
        # The user established complexity in turn 0 (spouse mention) and
        # asks a short advice question in turn 2. Complexity must persist
        # across the conversation — a user cannot bypass the safeguard by
        # asking their question in a short follow-up.
        prior = [
            "my wife and i have been distant for months",
            "i don't know how to reach her anymore",
        ]
        stance, s = classify_stance(
            2,
            "should i suggest counseling?",
            prior_user_texts=prior,
            stance_history=["listen"],
            depth_surfaced_before=False,
        )
        assert s["emotional_complexity"] is True
        assert stance == "explore"


# =============================================================================
# 16. Witness continuation — do not rush from witness to understand
# =============================================================================
class TestWitnessContinuation:
    def test_grief_yeah_remains_witness(self):
        # After witness (grief), a short "yeah..." must stay in witness.
        stance, _ = classify_stance(
            3,
            "yeah…",
            prior_user_texts=[
                "my mom died three weeks ago",
                "i can't stop crying at random moments",
            ],
            stance_history=["listen", "witness"],
            depth_surfaced_before=False,
        )
        assert stance == "witness"

    def test_grief_i_know_remains_witness(self):
        stance, _ = classify_stance(
            3, "i know",
            prior_user_texts=[
                "my grandmother died last week",
                "the funeral is tomorrow",
            ],
            stance_history=["listen", "witness"],
        )
        assert stance == "witness"

    def test_grief_still_hurts_remains_witness(self):
        stance, _ = classify_stance(
            4, "still hurts",
            prior_user_texts=[
                "we lost the baby",
                "i don't know how to face people",
                "it's been two months",
            ],
            stance_history=["listen", "witness", "witness"],
        )
        assert stance == "witness"

    def test_grief_i_dont_know_remains_witness(self):
        stance, _ = classify_stance(
            3, "i don't know",
            prior_user_texts=[
                "my dad passed last month",
                "everyone says it gets easier",
            ],
            stance_history=["listen", "witness"],
        )
        assert stance == "witness"

    def test_grief_new_specific_detail_routes_to_listen(self):
        # Substantial new content after witness with NO grief keywords in
        # the current turn → listen (hear it out) via the witness
        # continuation rule.
        stance, _ = classify_stance(
            3,
            "the hardest part is i keep expecting the phone to ring on sunday mornings and then i just remember",
            prior_user_texts=[
                "my mom died three weeks ago",
                "i just feel numb most of the time",
            ],
            stance_history=["listen", "witness"],
        )
        assert stance == "listen"

    def test_confession_short_shame_remains_witness(self):
        # After confession-witness, a short "yeah i'm ashamed" continues
        # the same emotional context and stays in witness (very_short rule).
        stance, _ = classify_stance(
            3, "yeah",
            prior_user_texts=[
                "i cheated on my wife six months ago",
                "no one knows",
            ],
            stance_history=["listen", "witness"],
        )
        assert stance == "witness"

    def test_confession_short_shame_with_depth_marker_goes_to_discern(self):
        # If a NEW depth marker surfaces after confession witness, discern
        # (sit with the new layer) — this is the correct escalation, not
        # a premature understand jump.
        stance, s = classify_stance(
            3,
            "i just feel so ashamed of myself i can barely look in the mirror",
            prior_user_texts=[
                "i lied to my wife about the money",
                "i've been hiding it for months",
            ],
            stance_history=["listen", "witness"],
            depth_surfaced_before=False,
        )
        assert s["depth_surfaced"] is True
        assert stance == "discern"

    def test_celebration_more_positive_detail_remains_witness(self):
        # User celebrating and adding more good news → witness re-fires via
        # priority 4 (celebration keywords still present).
        stance, s = classify_stance(
            3,
            "and God did it — the doctor called with the clean results",
            prior_user_texts=[
                "praise God — the surgery went well",
                "we were praying for months",
            ],
            stance_history=["listen", "witness"],
        )
        assert s["celebration"] is True
        assert stance == "witness"

    def test_witness_then_direct_advice_can_route_to_offer(self):
        # Simple advice ask after witness → offer path (no complexity gate
        # fires because there's no accumulated complexity marker beyond
        # the celebration context).
        stance, _ = classify_stance(
            3,
            "should i tell my mom the news tonight or wait till sunday",
            prior_user_texts=[
                "praise God — she said yes",
                "i finally proposed after a year of praying about it",
            ],
            stance_history=["listen", "witness"],
        )
        assert stance == "offer"

    def test_witness_then_advice_with_complexity_still_gated(self):
        # Same witness→advice pattern but complexity has accumulated (marital
        # context) → complexity gate holds even after witness. Must explore.
        stance, _ = classify_stance(
            3,
            "so should i just leave her",
            prior_user_texts=[
                "i cheated on my wife",
                "she found out yesterday",
            ],
            stance_history=["listen", "witness"],
            depth_surfaced_before=False,
        )
        # confession + advice + complexity → priority 7 gate holds.
        assert stance == "explore"
