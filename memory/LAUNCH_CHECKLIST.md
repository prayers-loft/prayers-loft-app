# Prayers Loft — TestFlight Launch Checklist

Last updated: TestFlight readiness build.

---

## ✅ Code complete

| Item | Status |
|---|---|
| Phase 1 — Guest Mode | ✅ |
| Phase 1.5 — Contextual Upgrade Prompts | ✅ |
| Phase 2 — Email/password auth (bcrypt + JWT + rotating refresh) | ✅ |
| Phase 2 — Emergent-managed Google Auth | ✅ |
| Phase 2 — Apple Sign-In (backend ready, feature-flagged off) | ✅ |
| Phase 2 — Guest→Account migration (idempotent) | ✅ |
| Phase 2 — Account deletion (App Store 5.1.1(v) compliant) | ✅ |
| Phase 2 — Password reset endpoints (Resend-ready, key not yet set) | ✅ |
| TestFlight bundle — Privacy Policy + Terms in-app | ✅ |
| TestFlight bundle — AI disclosure (first-prayer + Settings) | ✅ |
| TestFlight bundle — 3-slide onboarding carousel | ✅ |
| TestFlight bundle — Prayer prompt chips | ✅ |
| TestFlight bundle — Renamed “Theologian” → “Bible Questions” | ✅ |
| TestFlight bundle — Renamed “Backup My Journey” → “Keep My Journey Safe” | ✅ |
| Auth Sheet — full-screen modal premium rewrite | ✅ |
| Settings — Replay Onboarding developer tool | ✅ |
| In-app toast banner system (“Journey Saved”) | ✅ |

## ✅ Quality gates

| Gate | Result |
|---|---|
| Playwright E2E suite | **55/55 passed** |
| Backend pytest suite | **19/19 passed** |
| TypeScript `tsc --noEmit` | **0 errors** |
| axe-core accessibility | **0 blocking** across Prayer / Scripture / Reflections / Settings |

## 🔴 Required actions before submitting to TestFlight

| # | Action | Owner | Time |
|---|---|---|---|
| 1 | Confirm `app.json` has correct **bundle identifier** (e.g., `com.prayersloft.app`), version `1.0.0`, build number incremented | You | 5 min |
| 2 | Confirm `app.json` `expo.ios.infoPlist` has the App Store **privacy purpose strings** for media library + (later) notifications | You | 5 min |
| 3 | App Store Connect listing: short description, screenshots, support URL, privacy nutrition label (see “Tester-facing” below) | You | 30 min |
| 4 | Publish privacy + terms text on a **public URL** that mirrors `/privacy` and `/terms` (App Store requires reachable URLs in the listing) | You | 15 min |
| 5 | Click **Publish** in Emergent → generate iOS build → upload to App Store Connect | You | ~15 min build |

## 🟡 Optional before submission

| Action | Why | Time |
|---|---|---|
| Drop a real `RESEND_API_KEY` into `/app/backend/.env` | Activates real password-reset emails. Anti-enumeration safe with key blank. | 30 sec |
| Flip `APPLE_SIGN_IN_ENABLED=true` + drop Apple credentials | Activates Apple Sign-In. Required by App Store policy whenever Google sign-in ships. → **Required before PUBLIC launch**, optional for TestFlight | 60 sec |
| Gate Developer Tools behind `__DEV__` | Hides Replay Onboarding in App Store builds. Helpful in TestFlight for QA. | See B-011 |
