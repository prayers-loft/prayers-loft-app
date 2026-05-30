# Prayers Loft — PRD

## Overview
Prayers Loft is a faceless, anonymous spiritual-wellness mobile app (Expo + FastAPI + MongoDB) that helps users pray, meditate on scripture, and journal reflections — all powered by Claude Sonnet 4.5 via Emergent Universal LLM Key.

## Stack
- Frontend: Expo Router (SDK 54) — React Native with deep midnight gradient, ivory cards, gold accents, Crimson Text + Inter fonts.
- Backend: FastAPI with Motor (Mongo), `emergentintegrations` LlmChat library.
- Database: MongoDB collections — `reactions`, `reflections`, `devotional_cache`.
- AI: anthropic / claude-sonnet-4-5-20250929 via EMERGENT_LLM_KEY.

## Tabs (bottom navigation)
1. **Prayer** (default) — scripture-first prayer flow:
   - User shares request → Claude returns empathetic reflection + biblical character + verse w/ Bible.com link + consent question.
   - On "Yes, Pray With Me 🙏" → first-person prayer is generated with **Amen ✨** animation overlay.
   - Save (writes to local AsyncStorage with prefix `prayersloft_`) and Share (native share / clipboard).
   - "Want to sit with this? → Reflections" deep-link.
2. **Scripture Unplugged**:
   - Rotating banner of 5 quotes (5s fade cycle).
   - Daily Bible verse (rotated by day-of-year through 14 curated verses) with Bible.com link.
   - Emoji reactions 🙏 ❤️ 🔥 💡 with counters persisted in Mongo per verse_id.
   - AI devotional (cached per verse per day).
   - Theological Q&A with Devotional / Theologian / Pastoral pill style toggle.
   - "Want to reflect on this?" pre-fills Reflections with verse.
3. **Reflections**:
   - Daily rotating prompt (10 prompts cycled by day).
   - Textarea + 8 emotion chips (Grateful, Hopeful, Anxious, Peaceful, Confused, Joyful, Tired, Seeking).
   - Saved entries from server (CRUD) + saved prayers from local storage shown together with 🕊️ tag.
   - Edit + Delete.

## Ambient sound
Top-right toggle (🔔/🔕) plays a soft royalty-free ambient loop via `expo-audio`; default off, persisted to local storage.

## API endpoints (all `/api/*`)
- `POST /prayer-request` — `{message}` → `{response}`
- `POST /prayer-follow-up` — `{message, consent:true}` → `{prayer}`
- `GET /daily-verse` — `{verse, reference, verse_id, bible_link, devotional}`
- `POST /react-to-verse` — `{verse_id, emoji}` → `{verse_id, emoji, count}`
- `GET /get-reaction-counts?verse_id=X` → `{verse_id, counts:{🙏,❤️,🔥,💡}}`
- `POST /theological-question` — `{question, verse, style}` → `{response, style}`
- `POST /reflections` — `{text, emotion?, prompt?}` → entry
- `GET /reflections` → `{reflections:[...]}`
- `PUT /reflections/{id}` — `{text?, emotion?}` → entry
- `DELETE /reflections/{id}` → `{deleted, id}`

## AI tone
Warm, non-preachy, intimate. Scripture-first. Prayers in first person ending with "In Jesus' name, Amen." Devotionals feel like a quiet morning conversation. Theological responses adapt to the selected style.

## Notes
- No authentication; anonymous usage only (Phase 1 — Guest Mode default).
- All keys live in backend `.env`; `EXPO_PUBLIC_BACKEND_URL` is the only frontend env var.
- MongoDB writes use `id` (UUID) instead of `_id` and all reads project out `_id` for clean JSON.

## Phase 1.5 — Contextual Upgrade Prompts (DONE & verified)
Quiet, non-blocking nudges that invite Guests to back up their journey. **No real auth yet** — CTA opens a "coming soon" dialog (Phase-2 hand-off via `openAuthSheet`).
- **Triggers** (each fires at most once, 24h global cooldown):
  - `settings_backup_button` — manual tap from Settings (Backup variant)
  - `guest_soft_banner` — quiet banner on Prayer home, dismissible 14d (Backup variant)
  - `seven_day_streak` — Reflections streak ≥ 7 (Streak variant)
  - `five_prayers` — ≥ 5 saved prayers (Entries variant)
  - `five_reflections` — ≥ 5 saved reflections (Entries variant)
- **Files**: `src/lib/upgrade-prompts.ts`, `src/components/UpgradePromptSheet.tsx`, `src/components/UpgradePromptHost.tsx`, `src/components/GuestSoftBanner.tsx`.
- **E2E coverage**: tests `11-upgrade-prompts.spec.ts` (3) + `13-guest-soft-banner.spec.ts` (2). Total suite: 47 passing.

## Phase 2 — Authentication (NEXT, pending user kickoff)
Provider Mix B: Apple + Google + Email. Google via Emergent-managed Google Auth.
Guest→Account migration must preserve AsyncStorage data, streaks, saved prayers.

