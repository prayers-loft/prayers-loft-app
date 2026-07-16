#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Reimagine Prayers Loft as a discipleship companion. Keep existing features but add
  a conversational check-in. Build a memory system that remembers prayers,
  reflections, scripture, commitments, and milestones. Have AI ask thoughtful
  follow-ups over time, point back to scripture, help commit to one act of
  obedience, then follow up. Tone: gentle, biblically grounded, mentor not chatbot.
  This iteration = Slice 2 MVP (commits 1–4) — backend + Walk tab + streaming
  companion + explicit memory confirmation + follow-up on next visit. No timeline,
  dashboard, guest→account migration, or full acceptance suite in this pass.

backend:
  - task: "Walk session lifecycle: start, message stream, end"
    implemented: true
    working: true
    file: "backend/walk.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          POST /api/walk/session/start returns opening_message + is_first_session +
          memory_context_count. POST /api/walk/session/{id}/message streams the
          Sonnet 4.5 reply via SSE (litellm direct + emergent proxy). POST
          /api/walk/session/{id}/end runs the extraction pass and returns
          candidates_saved / candidates_pending. Manual curl + Playwright validated
          both first-session opener AND returning-session callback with active
          commitment.

  - task: "Curated memory ledger with explicit confirmation source"
    implemented: true
    working: true
    file: "backend/walk.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          walk_memory collection scoped by owner_key ('u:' or 'g:' prefix).
          confirmation_source ∈ {explicit_user_action, explicit_statement,
          unconfirmed}. Auto-save gate: extraction candidates only save when
          confirmation_source == 'explicit_statement' AND confidence >= 0.6.
          Unconfirmed items surface as candidates_pending for the client to
          confirm via a tap. Kinds limited to prayer / struggle / lesson /
          commitment per spec (milestone + scripture_touchpoint deferred).
          NO 90-day decay in this pass.

  - task: "Sonnet 4.5 system prompt — voice, safeguards, Scripture discipline"
    implemented: true
    working: true
    file: "backend/walk.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          SYSTEM_PROMPT covers: listening-before-interpreting (clarifying
          question only when meaning unclear, not mechanical); optional
          three-voice ('You said' / 'Scripture says' / 'I'm wondering');
          ESV verbatim discipline (no fabrication); optional commitments;
          crisis interrupt with locale-aware referral (988 US/Canada,
          local emergency otherwise); doctrinal disputes summarized fairly
          (no blanket refusal); no divine revelation claims; professional
          care referral for clinical concerns.

  - task: "Ownership scoping — Bearer JWT OR X-Guest-Id"
    implemented: true
    working: true
    file: "backend/walk.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          Reuses the current_owner dependency from server.py. Every walk_memory
          and walk_session doc carries an owner_key string ('u:{user_id}' or
          'g:{guest_id}') so a future guest→account migration is a single
          key-swap. All list/get/patch/delete endpoints scope by owner_key.
          Verified via curl that two different guest IDs see disjoint memory.

frontend:
  - task: "Walk tab landing screen"
    implemented: true
    working: true
    file: "frontend/app/(tabs)/walk.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          Added as the 4th tab (positioned first in the tab bar). Tabs layout
          keeps initialRouteName='prayer' so existing users retain their landing
          behavior. Landing card copy adapts to first-time vs returning
          (memory-driven). Below the hero: active commitments / struggles /
          prayers are surfaced with gentle labels ('You said you'd…', 'Sitting
          with', 'Praying about') — no numeric counts, no gamification. Footer
          note reinforces the boundary ('A companion, not a pastor…').

  - task: "Walk conversation screen with streaming + three-voice rendering"
    implemented: true
    working: true
    file: "frontend/app/walk-conversation.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          Streams via XHR incremental responseText (RN-safe, no new deps).
          Three-voice inline splitter recognizes 'You said', 'Scripture says'
          (with markdown-bold tolerance for '**Scripture says:**'),
          'I'm wondering', 'It sounds like'. Scripture segments get an accent
          left stripe + serif italic body. Segments only render when the model
          actually uses those phrases (no forced 3-block structure). Session
          close triggers extraction and shows two sections: 'Saved for next
          time' (auto-saved) + 'Would you like me to remember these too?'
          (pending). Ended panel is optional — a user may just tap 'Done'.

  - task: "walk-api client (fetch + streaming + memory CRUD)"
    implemented: true
    working: true
    file: "frontend/src/lib/walk-api.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          _walkFetch attaches Bearer + X-Guest-Id (matches api.ts pattern).
          streamWalkMessage returns an abort function; parses SSE frames from
          XHR responseText and calls onChunk/onDone/onError. Uses /api/walk/*
          paths and the BASE resolved by apiUrl.

metadata:
  created_by: "main_agent"
  version: "1.0-walk-slice2"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Walk session lifecycle: start, message stream, end"
    - "Curated memory ledger with explicit confirmation source"
    - "Sonnet 4.5 system prompt — voice, safeguards, Scripture discipline"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Slice 2 of the discipleship companion feature is implemented on
      feat/discipleship-companion (off release/build-17 @ eb0a867). Both
      backend (backend/walk.py, wired in server.py) and frontend
      (frontend/app/(tabs)/walk.tsx, frontend/app/walk-conversation.tsx,
      frontend/src/lib/walk-api.ts) are done and manually validated
      end-to-end via curl AND Playwright screenshots. Please run FOCUSED
      backend tests only for this pass.
  - agent: "testing"
    message: |
      9/9 backend tests PASSED on first run (no fixes applied). Suite at
      /app/backend/tests/test_walk_discipleship.py, JUnit at
      /app/test_reports/pytest/walk_discipleship.xml, JSON report at
      /app/test_reports/iteration_8.json. Verified: session lifecycle
      first-session copy vs returning-session commitment callback, SSE
      streaming discipline + persistence, memory-extraction gate
      (explicit_statement + confidence≥0.6 only), Scripture-attribution
      regex, crisis 988 mention with no Scripture/commitment in reply,
      doctrinal fairness (no blanket refusal, points to pastor),
      ownership isolation guest-A vs guest-B, end-idempotency. Two purely
      defensive suggestions logged, no action items.
  - agent: "main"
    message: |
      Testing complete. Also captured live artifacts for the user handoff:

      FIRST-SESSION TRANSCRIPT (guest artifact-first-session):
        ASSISTANT: "Hi — I'm glad you're here. Take your time. What has
                    been weighing on you, or shaping your walk with God,
                    lately?"
        USER: "I have been struggling with anxiety at my new job. I want
               to commit to reading Psalm 46 tomorrow morning."
        ASSISTANT: "You said you've been struggling with anxiety at your
                    new job, and you want to read Psalm 46 tomorrow
                    morning. That sounds like a good, honest step — Psalm
                    46 meets us right in the middle of fear and
                    uncertainty. 'God is our refuge and strength, a very
                    present help in trouble. Therefore we will not fear...'
                    (Psalm 46:1-2). It's a psalm about God's steadiness
                    when everything else feels shaky. So yes — read it
                    tomorrow morning. Maybe read it slowly, out loud if
                    you can. Notice what word or phrase catches you. I'm
                    wondering — is there a specific moment or situation
                    at the new job that brings the anxiety up most?
                    Sometimes naming the particular fear helps us know
                    how to pray."

      RETURNING-SESSION OPENER (same guest, 2nd session):
        "Welcome back. Last time you said, 'I'm going to read Psalm 46
         tomorrow morning.' How has that been?"

      SAVED MEMORY (verbatim from walk_memory):
        [COMMITMENT] status=active source=explicit_statement
          content: "I'm going to read Psalm 46 tomorrow morning."
          scripture_ref: "Psalm 46 ESV"
        [STRUGGLE] status=active source=explicit_statement
          content: "I'm struggling with anxiety at my new job."
          scripture_ref: null

      OBSERVED UX ISSUES (both minor, not blockers):
        1. Tab-bar label truncation — "Bible Assistant" now shows as
           "Bible Assi..." because the tab bar has to fit 4 tabs in the
           390pt viewport. Pre-existing constraint made tighter by the
           new Walk tab. Fix candidate: shorten label to "Bible" or
           reduce the label font size to 8.5pt.
        2. Model occasionally uses markdown bold ("**Scripture says:**")
           rather than plain-prefix "Scripture says". Client already
           strips markdown before voice-tag detection so the accent
           stripe renders correctly, but if we ever expose the raw text
           (e.g. share-to-journal) we'll want to strip markdown there
           too.

      FAILED TEST CASES: none.
