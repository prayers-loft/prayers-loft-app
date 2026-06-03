# Prayers Loft — Known Limitations (TestFlight build)

These are deliberate omissions or known constraints for the TestFlight build. Testers do not need to report these.

---

## Google sign-in branding
- Tapping **Continue with Google** redirects through `auth.emergentagent.com` before reaching Google's consent screen.
- Consent screen reads **"Continue to emergentagent.com"** instead of "Continue to Prayers Loft."
- We're aware. A custom Google OAuth client tied to Prayers Loft is in the backlog (B-001) and will land before public App Store launch.

## Apple Sign-In
- Hidden on this build. Feature-flagged off via `APPLE_SIGN_IN_ENABLED=false`.
- Will appear on the next iOS build after Apple credentials are configured (B-006). Required by App Store policy before public launch.

## Password reset emails
- The "Forgot password?" flow accepts your email and shows a success toast, but **no real email is sent yet**. The `RESEND_API_KEY` is intentionally blank in this build.
- Anti-enumeration safe: API always returns 200 regardless. Real email goes live the moment we drop the key.

## Push notifications
- Not implemented yet. The **Daily reminder** toggle in Settings persists locally but does not schedule an OS-level reminder yet.
- Coming in B-002 after TestFlight (requires Emergent-managed push + Firebase `google-services.json`).

## Bible translation
- Currently a single translation is served. Translation selector (ESV / NIV / KJV) is in P3 backlog (B-014).

## Save image → Photos (iOS / Android)
- Works on native builds but **not in Expo Go web preview**. If a tester is testing via Expo Go, the **Save to Photos** button is best-effort.

## Developer Tools section
- **Replay Onboarding** is intentionally visible in TestFlight so QA + testers can re-view the carousel.
- Will be hidden in App Store production builds via `__DEV__` gate (B-011).

## Daily devotional caching
- The same daily devotional is served all day in your **device's local timezone** (server-side keyed by `local_date:verse_id`). If you change timezones mid-day, the devotional may switch — this is by design.

## Pre-existing tooling notes
- **ESLint** reports a parse-warning on TS `as const` syntax in `reflections.tsx` — cosmetic, doesn't impact runtime. `tsc --noEmit` is clean.
- **`shadow*` style props deprecation warning** from RN-web in dev logs — cosmetic; visual shadows still render correctly on both web and native.

## Legal copy
- Privacy Policy and Terms of Service are written in plain, honest language. They have **not yet been reviewed by counsel**. We'll do this before public launch (B-012).
