# Prayers Loft — Full QA Pass

**Run date:** 2026-05-30  
**Build under test:** Phase 1.5 (Guest-Mode foundation + contextual upgrade prompts)  
**Backend:** FastAPI + MongoDB + Claude Haiku 4.5 via Emergent LLM key  
**Frontend:** Expo SDK (mobile-chrome / Pixel 7 viewport 393×852)

---

## 1. Summary

| | Count |
|---|---|
| Total automated tests run | **41** |
| Passed | **41** |
| Failed | **0** |
| Blocked | **0** |
| Wall-clock runtime | 4 min 7 s |

By user journey (all green):

| Journey | Result |
|---|---|
| Smoke — boot, navigation, shell | 3 / 3 |
| Prayer generation | 3 / 3 |
| Scripture / daily verse / Q&A | 6 / 6 |
| Reflections journal | 4 / 4 |
| Share image generation + save | 7 / 7 |
| Data persistence (local storage) | 3 / 3 |
| Tab navigation | 3 / 3 |
| Offline / degraded mode | 2 / 2 |
| Guest mode (no-auth invariants) | 2 / 2 |
| Guest settings & preferences | 5 / 5 |
| Upgrade prompts (Phase 1.5) | 3 / 3 |

Hard failure gates in place during every test:

- `console.error` (curated allow-list)
- Unhandled `pageerror`
- `requestfailed` on any `/api/*` route (scoped out only in offline tests)
- 5xx responses from `/api/*`
- Missing test-IDs / DOM nodes
- Broken navigation

Reports: `playwright-report/index.html`, `coverage-summary.txt`, `coverage-summary.json`.

---

## 2. Critical bugs — *none*

There are no beta-blockers.

---

## 3. High-priority issues — *none*

All core spiritual flows (prayer generation, daily verse, devotional, Theologian Q&A, reflections, share/save, settings, upgrade prompts) are working end-to-end with no console / network regressions.

---

## 4. Medium-priority issues

| # | Issue | Impact | Recommended action |
|---|---|---|---|
| M1 | The Save Image action on **web** does not produce a `download` event when triggered programmatically against a data-URI; native Save-to-Photos on iOS/Android remains the source of truth and is not exercised by this suite. | Web users hitting "Save Image" get the file but the suite can't assert it deterministically — currently falls back to a soft check. | Verify Save-to-Photos manually on a physical iOS device once before beta. |
| M2 | Carried-over deprecation warnings (allow-listed): `useNativeDriver` (Animated on web), `pointerEvents` prop, `shadow*` / `textShadow*` StyleSheet props, expo-audio SDK version pin. None affect functionality. | Future SDK upgrade noise. | Single cleanup pass before SDK 53 bump. |
| M3 | The Phase 1.5 upgrade-prompt **7-day-streak** and **5+ entry** triggers are wired and analytics-tagged, but exercising them in automated tests requires populating real reflection / prayer data and time travel — not currently in the suite. | Triggers verified manually + smoke-tested via the Settings entry point (same code path). | Add a backend-seeded fixture for streak / entry-count tests in a follow-up. |
| M4 | Empty-state assertion on Reflections is soft (data is shared on the server). | Visual-only edge case. | Move text reflections to local-first storage in Phase 3, then re-enable a hard empty-state assertion. |

---

## 5. Low-priority issues

| # | Issue | Recommended action |
|---|---|---|
| L1 | Ambient audio CDN (Pixabay) occasionally returns 403 in CI — allow-listed, never user-facing. | No action required. |
| L2 | The guest soft banner uses a 14-day suppression cookie. Borderline cases (e.g. system clock drift) untested. | Acceptable for beta. |
| L3 | No `@accessibility` axe-core scan yet. Visual contrast, tap-target sizing, and dynamic-text resilience all spot-checked manually and verified by the on-screen UI rewrite. | Add `@axe-core/playwright` in a follow-up. |
| L4 | Old orphaned components (`PrayerImageCard.tsx`, `ScriptureShareCard.tsx`) were removed in the iteration-2 cleanup; some files still reference them in git history. | None — already removed. |

---

## 6. Screens tested

- **Splash overlay** (cold launch only, ~1.85s; respects Reduce Motion)
- **Prayer tab** — input, Begin, reflection card, Pray With Me, prayer card, Save, Share, soft banner
- **Scripture tab** — verse card, rotating banner, reactions row, devotional card, Q&A (Devotional + Theologian), Share buttons (verse / devotional / Q&A), Reflect-on-verse CTA
- **Reflections tab** — input, save, edit-and-resave, show-more, prayer-saved cards (with Share + Remove), streak block
- **Settings screen** — Account hero, Notifications, Appearance, Data & Sync (Export backup, Cloud sync coming-soon), Privacy (analytics opt-in, Erase local data), About
- **Share modal** — preview, aspect selector (Post / Square / Story), template selector, two-tier action layout (Save Image / Share Image / Copy text), Cancel
- **Upgrade prompt sheet** — backup / streak / entries variants, Backup My Journey CTA, Not Now dismissal, backdrop dismissal
- **Guest soft banner** — Prayer home, dismissible

---

## 7. Devices / viewports tested

- **Mobile Chrome / Pixel 7 — 393 × 852** (primary CI viewport)
- Geometry validated previously across **iPhone SE (375)**, **iPhone 15 Pro (393)**, **iPhone 15 Pro Max (430)**, and **Pixel 7 (412)** — all three tab cells render mathematically equal-width on every viewport (constraint-based layout)
- Splash animation captured at 4 timestamps (600 ms / 1.3 s / 2.1 s / 2.8 s) and confirmed clean reveal

---

## 8. Final verdict

# ✅ **READY FOR BETA**

The core Guest-Mode spiritual experience is reliable, fast, and polished:

- ✅ A brand-new user can install Prayers Loft, hit the splash, and immediately begin praying, reading Scripture, or reflecting with **zero login wall**
- ✅ All AI-driven flows (Prayer Assistant, Daily Devotional, Theologian Q&A, share-excerpt) return within Claude latency budgets and never crash the UI on failure
- ✅ Share / Save / Copy actions are premium and consistent across all four card types (Prayer, Verse, Devotional, Theologian)
- ✅ Settings + upgrade prompts feel like protection, not permission — every prompt is dismissible, never interrupts an active write, and analytics-tagged with `trigger_source`
- ✅ Offline & degraded-mode handling never hard-crashes the shell
- ✅ Guest data persists across reloads (locally-stored prayers + preferences + cached devotional; server-stored reflections)
- ✅ 41 / 41 automated end-to-end tests pass; no console regressions; no broken navigation
- ✅ No medium-priority issue is a beta-blocker; all are tracked for a follow-up polish pass

**Recommendation:** ship to beta. Schedule Phase 2 (real auth + migration) and an accessibility pass (axe-core) as the next milestones.
