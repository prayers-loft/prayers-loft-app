# Prayers Loft — Backlog

Living document. Items grouped by priority. Each item lists: scope, effort, impacted surface, blocker dependencies.

---

## P0 — Required before Public App Store Launch

### B-001 · Custom Google OAuth for Public App Store Launch

**Why**: TestFlight uses Emergent-managed Google Auth which displays "Continue to emergentagent.com" on the consent screen. For a polished spiritual wellness app on the public App Store, the consent screen must read "Continue to Prayers Loft" with your logo and privacy policy.

**Estimated effort**: 2–4 hours of focused work + Google verification turnaround (1–7 days if homepage URL not yet listed).

**Required Google Cloud setup**
1. Create a Google Cloud project “Prayers Loft”.
2. Enable the **People API** (the modern replacement for Google+ API).
3. Configure the OAuth consent screen:
   - User type: External
   - App name: `Prayers Loft`
   - User support email: your support mailbox
   - App logo: 120×120 PNG (transparent background recommended)
   - App domain: your verified domain (e.g., `prayersloft.app`)
   - Authorized domains: same as above
   - Developer contact information
   - Privacy policy URL: must resolve publicly (use the in-app /privacy text mirrored on the web)
   - Terms of service URL: same pattern
   - Scopes: `openid`, `email`, `profile` only (no Drive/Gmail/etc → no verification needed for these basic scopes if userbase ≤ 100 testers; ≥ 100 → brand verification, ~3 business days)
4. Create OAuth 2.0 Client ID credentials:
   - Application type: **Web application** (we use the redirect/code flow on backend, NOT iOS native, because RN+expo-router on web preview needs the redirect path too)
   - Authorized redirect URIs: add `https://<your-backend-domain>/api/auth/google/callback` and a localhost variant for dev
   - Note both the Client ID and Client Secret — drop into backend `.env`
5. (Optional, future) Create an **iOS** OAuth client ID for native sign-in via `@react-native-google-signin/google-signin`. Defer until App Store launch + 1.

**Migration plan** (zero-downtime, additive)
- Backend already issues our own JWT after Google sign-in. Switching the *exchange step* doesn't touch refresh tokens, user records, or any client.
- Add env `GOOGLE_OAUTH_MODE=emergent|custom` (default `emergent`).
- Add three new env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- Add `/api/auth/google/callback` route that:
   1. Receives `code` + `state` from Google
   2. Exchanges code for tokens via `https://oauth2.googleapis.com/token`
   3. Fetches profile via `https://www.googleapis.com/oauth2/v3/userinfo`
   4. Calls the existing `_link_or_create_user(... google_sub=profile.sub ...)` — **no change**
   5. Issues our JWT + refresh as today
- Frontend: when `EXPO_PUBLIC_GOOGLE_OAUTH_MODE=custom`, the `startGoogleSignIn()` redirect points to `https://accounts.google.com/o/oauth2/v2/auth?...` directly instead of `https://auth.emergentagent.com/`. Everything else (session storage, auto-refresh, Settings UI) stays.
- Flip flag, redeploy, smoke-test. Done.

**Impacted auth flows**
- Google sign-in only. Email/password and Apple Sign-In are untouched.
- Existing Google-signed-in users: NO data migration needed. Their `auth_google.google_sub` is the same value Google returns under both flows.

**Risks**
- Google verification delay if our brand-domain isn't already proven — plan a ~1-week buffer before App Store submission.
- Client Secret leakage — keep server-side only, never ship to the mobile bundle.

---

## P1 — First-week-after-launch improvements (from 100-user simulation)

### B-002 · Daily push notification (“Time to breathe”)
Biggest retention lever per the simulation review. Use Emergent-managed push. Effort: 2 days. Requires Firebase `google-services.json`.

### B-003 · Saved-prayer library browser
New screen under Reflections or Settings to revisit past saved prayers. Effort: 1 day.

### B-004 · Verse archive
Last 7 days of daily verses, scrollable. Effort: 1 day.

### B-005 · Weekly digest email (after Resend key is dropped in)
"This week you prayed 4 times, reflected on 3 verses.” Effort: 2 days. Needs `RESEND_API_KEY`.

---

## P2 — Polish & growth

### B-006 · Apple Sign-In go-live
Flip `APPLE_SIGN_IN_ENABLED=true` + drop `APPLE_TEAM_ID` + `APPLE_SERVICES_ID`. Effort: 1 hour. **Required by App Store policy if shipping Google sign-in.** → must land before public launch.

### B-007 · Personalization based on emotion tags
Reflection emotions feed the verse selector. Effort: 2 days.

### B-008 · Soft social proof (“You and 1,247 others prayed for peace today”)
Low-friction connection-feel without compromising privacy. Effort: 1 day.

### B-009 · Share-to-friend flow (verse → SMS/iMessage)
Growth lever. Effort: 1 day.

### B-010 · Style selector for prayer voice (Reverent / Simple / Modern / Lament)
Power-user delight. Effort: 1 day.

### B-011 · Gate Developer Tools section behind `__DEV__`
Hide “Replay Onboarding” in App Store builds. 30 min.

### B-012 · Replace placeholder legal copy with counsel-reviewed text
`src/content/privacy.ts` + `terms.ts` are written in plain language but should be lawyer-reviewed before public launch.

---

## P3 — Nice-to-have

### B-013 · Account-deletion email confirmation via Resend
### B-014 · Bible translation selector (ESV / NIV / KJV)
### B-015 · Weekly themes (Lent / Advent / gratitude week)
### B-016 · "What you missed" recap after 3+ day absence
