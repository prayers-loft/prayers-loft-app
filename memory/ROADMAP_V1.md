# Prayers Loft — v1.0 Roadmap (post-TestFlight → Public App Store launch)

Goal: TestFlight closed-beta → polished public 1.0 in ~3–4 weeks.

---

## Week 1 (TestFlight live)
Focus: **observe**, do not over-react.

- Ship TestFlight build (this build)
- Recruit 25–50 testers across the persona buckets from the 100-user simulation (devout / new believer / curious / older / Gen Z)
- Set up basic usage observability: read backend logs daily for sign-in counts, prayer-request counts, share-excerpt calls
- Collect TestFlight feedback channel for 7 days before triaging
- **No code changes** in week 1 unless something is actually broken

## Week 2 (close obvious gaps)
Focus: act on top 3–5 themes from tester feedback. Likely candidates:
- B-011 — Gate Developer Tools behind `__DEV__`
- Drop `RESEND_API_KEY` → password reset goes live
- Minor copy + spacing tweaks discovered in real use
- Fix anything testers report as broken on physical devices that wasn't caught by Playwright on web

## Week 3 (production-grade auth)
Focus: **B-001 — Custom Google OAuth** + **B-006 — Apple Sign-In on**.
- Set up Prayers Loft Google Cloud project + OAuth consent screen
- Add `/api/auth/google/callback` + flip `GOOGLE_OAUTH_MODE=custom`
- Drop Apple `TEAM_ID` + `SERVICES_ID`, flip flag, test on real iOS device
- Re-run full E2E suite + manual auth smoke on real device
- Update Tester Instructions to reflect new branded consent screen

## Week 4 (App Store submission + safety net)
Focus: ship + protect.
- B-012 — Counsel-reviewed legal copy in `privacy.ts` + `terms.ts`
- Mirror Privacy + Terms on a public web URL (App Store listing requires this)
- App Store Connect listing: screenshots, description, keywords, support URL, privacy nutrition label
- Submit to App Store review
- Begin B-002 (daily push notifications) in parallel — ready to ship as 1.0.1 the week after approval

---

## v1.1 themes (first 6 weeks after public launch)

Driven by post-1.0 metrics. Top candidates from the 100-user simulation:
- B-002 — Daily push notification (single biggest retention lever)
- B-003 — Saved-prayer library browser
- B-004 — Verse archive (last 7 days)
- B-005 — Weekly digest email
- B-010 — Prayer voice style selector (Reverent / Simple / Modern / Lament)
- B-014 — Bible translation selector

## v1.2 themes (8–12 weeks after launch)
- B-007 — Personalization based on emotion tags
- B-008 — Soft social proof
- B-009 — Share-to-friend flow
- B-015 — Weekly themes (Lent / Advent / gratitude week)
- B-016 — "What you missed" recap

---

## Non-goals for 1.0
These are deliberately out of scope to keep the launch focused:
- Multi-language support
- Community / social features
- Audio prayer playback
- Subscription / paid tier
- Watch / web companion

---

## Definition of “Ready for Public App Store”

All of:
- ✅ Custom Google OAuth live (B-001)
- ✅ Apple Sign-In live (B-006)
- ✅ Counsel-reviewed legal copy (B-012)
- ✅ Developer Tools hidden in production builds (B-011)
- ✅ RESEND_API_KEY configured + password reset E2E-tested on a real device
- ✅ No P0 bugs from TestFlight feedback open longer than 48 hours
- ✅ App Store Connect listing complete with public Privacy + Terms URLs
