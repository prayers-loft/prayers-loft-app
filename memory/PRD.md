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

## Phase 2 — Authentication & Guest→Account Migration (DONE & verified)
Provider Mix B: Email/password + Emergent-managed Google + Apple (feature-flagged off).
- **Backend** (`/app/backend/auth.py`): JWT (HS256) access + opaque rotating refresh tokens stored in `refresh_tokens`. `users` collection with embedded `auth_email`, `auth_google`, `auth_apple` identities. Account linking by email at sign-in. Brute-force lockout (5 email / 20 IP failures per 15 min). Indexes auto-ensured on startup.
- **Endpoints**: POST /api/auth/{register,login,refresh,logout,google,apple}, GET /api/auth/me, POST /api/account/migrate-guest, GET /api/account/saved-prayers.
- **Frontend**: `AuthSheet` (Google/Apple-hidden/Email), `AuthHost` (global mount), `auth-store` (expo-secure-store on native, localStorage on web), `auth-client` (single-flight refresh on 401), `account-migration` (idempotent via `guest_id`, fires once on first sign-in, sets `prayersloft_migration_completed_v1`).
- **Guest→Account migration**: idempotent via `(guest_id, user_id)` unique index. Cross-user `guest_id` collision returns 409. Preserves earliest `created_at` on duplicates. Recomputes streak server-side. Returns localized message *"Your spiritual journey has been safely saved."*
- **E2E coverage**: 51 Playwright tests passing (47 prior + 2 phase-2 auth + 1 phase-2 migration + 1 phase-2 guard-update). Backend pytest: 19/19 covering all auth + migration + account-linking + anonymous regressions.

