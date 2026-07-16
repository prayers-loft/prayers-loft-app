# Walk beta workflow — moving from synthetic to real

**Adopted after V4 review pass.** The prompt engineering phase is closed. From here we improve the companion from real ministry conversations, not hypothetical ones.

## Guiding philosophy (from your Sprint 7 message)

> Real mentors don't have favorite opening phrases. They respond to the person in front of them.

Two consequences we're accepting:

1. **We are no longer maintaining a Do Not Say library.** Any list of banned phrases would eventually create artificial language. `That sounds hard`, `One thing stands out`, `Thank you for trusting me` are all natural phrases. The problem is repetition — and repetition is a signal we can only detect across many real conversations, not one.
2. **We are not optimizing for perfectly structured responses.** Sometimes the right reply is short, unfinished, and simply present: *"That's worth sitting with."* No three-point lesson afterward.

## The beta loop

```
Real user conversations
        ↓
Human transcript review (using export_walk_sessions.py)
        ↓
Pattern identification
        ↓
Small targeted refinement (only if pattern shows up in 3+ real sessions)
        ↓
Repeat
```

No more broad prompt overhauls.

## Tools shipped for the loop

- **`backend/scripts/export_walk_sessions.py`** — pulls recent completed sessions from Mongo, prints as reviewable markdown. Includes each session's summary, extracted memory items, and the full sanitized transcript. Redacts `owner_key` to a short prefix by default so you can distinguish users without exposing IDs.

  Common invocations:
  ```
  # Most recent 30 completed sessions:
  python /app/backend/scripts/export_walk_sessions.py > /tmp/real-walk-sessions.md

  # Only the last 7 days, min 2 user turns:
  python /app/backend/scripts/export_walk_sessions.py --days 7 --min-turns 2

  # One specific user:
  python /app/backend/scripts/export_walk_sessions.py --owner "u:<user_id>"
  ```

- **Existing persistence (already in place):**
  - Every user message is stored in `walk_sessions.messages` (unmodified).
  - Every assistant reply is stored **after the sanitizer runs** — no `Can I ask —` or `Can I share an observation?` in the review data.
  - Every completed session gets an LLM-produced `session_summary` (spiritual movement, not chat transcript).
  - Every session extraction produces `walk_memory` items (commitments, struggles, prayers).
  - All of this is what feeds the "callback hint" and Walk landing greeting for returning users.

## The one review question

When reading exported real conversations, ask ONE question — the same one that gave us signal in V4:

> "If I read these conversations back-to-back, where would I begin recognizing the same speaker?"

That's the only pattern that matters. Individual mask-slip moments in a single conversation are not signal. Patterns visible across users are.

## When to actually change the prompt

Only when a pattern shows up in **3+ real sessions across different users**. Anything else is a one-off and stays untouched. This is deliberately conservative — the risk of tuning against a single conversation is much higher than the risk of leaving a small imperfection in place.

## What NOT to do

- **Do not** grow the Do Not Say library.
- **Do not** run another synthetic 20-scenario harness. Synthetic transcripts have hit their ceiling.
- **Do not** rewrite the SYSTEM_PROMPT. Small targeted patches only.
- **Do not** add "polish this reply" post-processing. The user was clear: too polished is itself the problem.

## What TO do

- Watch for **repetition across users** — same opener across many sessions, same closing template every time, same teaching-preamble structure regardless of what the user brought.
- Watch for the "**three-point lesson**" shape — every reply organized into perfectly balanced paragraphs. Real conversation is messier.
- Watch for **over-completion** — replies that fully explain and resolve everything in one turn. Sometimes the pastoral move is to leave a beat open.

## Beta launch checklist (for the user)

The app is in a shippable state on `feat/discipleship-companion` (commit `8ed935f`). To move to real beta:

1. Pull the bundle to your Mac and push the branch to origin.
2. Click **Publish** in Emergent (top-right).
3. Generate an iOS build via the deploy flow.
4. Distribute the build to your initial beta list.
5. After 1–2 weeks of real usage, run `export_walk_sessions.py --days 14 > review.md` and read straight through.

That's it. No more sprints until we've seen at least ~50 real conversations.
