# Prayers Loft — EAS / TestFlight Build Workflow

Last updated after the EAS pre-flight check. Follow these steps in order on a Mac (recommended) or Linux machine.

---

## A. Environment variables required for TestFlight

### Frontend (build-time, embedded in iOS bundle via EAS)
| Variable | Where set | Value |
|---|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | `eas.json` → `build.testflight.env` | Your deployed FastAPI URL, e.g. `https://api.prayersloft.app` |

### Backend (runtime, on your deployed FastAPI host)
| Variable | Required for | Notes |
|---|---|---|
| `MONGO_URL` | All DB work | Production Mongo (Atlas free tier works) |
| `DB_NAME` | All DB work | `prayers_loft` |
| `EMERGENT_LLM_KEY` | Claude AI for prayers/devotionals/Q&A | Already configured in dev `.env` |
| `JWT_SECRET` | All auth | **Generate a NEW 32-byte secret for production** — do NOT reuse dev |
| `JWT_ISSUER` | All auth | `prayers-loft` |
| `JWT_AUDIENCE` | All auth | `prayers-loft-mobile` |
| `APPLE_SIGN_IN_ENABLED` | Apple flow | `false` for TestFlight, `true` before public launch |
| `APPLE_TEST_MODE` | E2E only | `false` in production |
| `APPLE_SERVICES_ID` | Apple flow when enabled | `com.prayersloft.app.service` (Apple Developer → Identifiers → Services IDs) |
| `RESEND_API_KEY` | Password reset emails | Blank in TestFlight is OK — endpoint stays anti-enumeration safe |
| `RESEND_FROM` | Password reset emails | `Prayers Loft <onboarding@resend.dev>` or your verified sender |
| `APP_PUBLIC_URL` | Email reset links | `https://your-public-web-domain.com` |

### EAS submit credentials (for `eas submit`)
Collected interactively by `eas submit` or pre-filled in `eas.json`:
- **Apple ID email** (your Apple Developer email)
- **App Store Connect App ID** (numeric, found in App Store Connect → App Information → Apple ID)
- **Apple Team ID** (10-character, Apple Developer Portal → Membership)
- **App-specific password** OR ASC API key (interactive prompt)

---

## B. GitHub push checklist (run from /app on local machine after cloning Emergent code)

```bash
# 1. Verify nothing sensitive is staged
git status
git ls-files | grep -E '\.env$' # MUST return nothing

# 2. Confirm .gitignore covers secrets
grep -E '^\.env|backend/\.env|frontend/\.env|node_modules|\.expo|\.metro-cache|test-results|playwright-report' .gitignore

# 3. Sanity check: no hardcoded preview URLs in source
grep -rn 'prayers-loft.preview.emergentagent.com' frontend/src frontend/app backend/auth.py backend/server.py | grep -v node_modules

# 4. Stage + commit
git add .
git commit -m "Prayers Loft — TestFlight readiness build"
git remote add origin git@github.com:<your-org>/prayers-loft.git
git branch -M main
git push -u origin main
```

### Files that MUST NOT be committed
- `backend/.env` — contains `JWT_SECRET`, `EMERGENT_LLM_KEY`
- `frontend/.env` — contains preview-environment URLs
- `node_modules/`, `.expo/`, `web-build/`, `dist/`
- `test-results/`, `playwright-report/`, `.metro-cache/`
- Any `.p8`, `.p12`, `.mobileprovision`, `.jks`, `.key`

---

## C. Local EAS build command sequence

```bash
# Prereqs (one-time, on Mac or Linux)
npm install -g eas-cli       # 0.5 min
cd frontend
npm install                  # ~3 min, installs all deps

# Login to Expo
eas login                    # interactive, uses your Expo account

# Link the project (creates extra.eas.projectId in app.json)
eas init --id <existing-eas-project-id>   # if you already have one
# OR
eas init                     # creates a new EAS project; copy the projectId back into app.json's "extra.eas.projectId"

# Also fill app.json "owner" with your Expo username

# IMPORTANT: edit eas.json and replace REPLACE-WITH-YOUR-DEPLOYED-BACKEND.example.com
# with your live FastAPI URL (e.g. https://api.prayersloft.app)

# Verify config is healthy
npx expo-doctor             # ~30 sec
npx expo prebuild --no-install --platform ios  # dry-run; aborts before mutating

# Trigger the TestFlight build (uploads to Expo's cloud)
eas build --platform ios --profile testflight
# Expo will:
#  - ask for Apple credentials interactively (first run only)
#  - generate/use distribution certificate + provisioning profile
#  - build .ipa on Expo's macOS workers (~15-25 minutes)
#  - email you when done with a download link

# Submit to App Store Connect / TestFlight
eas submit --platform ios --profile production --latest
# Or use --path ./build.ipa if you downloaded the .ipa
# This uploads via Apple's Transporter API in ~5-10 minutes
# Then App Store Connect processes the build (~10-30 minutes)
# After processing: invite testers from App Store Connect → TestFlight tab
```

---

## D. Blockers to fix BEFORE iOS build (already fixed in this pre-flight)

| # | Item | Status |
|---|---|---|
| 1 | `app.json` missing `ios.bundleIdentifier` | ✅ fixed → `com.prayersloft.app` |
| 2 | `app.json` missing `ios.buildNumber` | ✅ fixed → `"1"` |
| 3 | `app.json` name `"frontend"` instead of `"Prayers Loft"` | ✅ fixed |
| 4 | `app.json` slug `"frontend"` (Expo URL slug) | ✅ fixed → `prayers-loft` |
| 5 | `app.json` scheme `"frontend"` (deep-link) | ✅ fixed → `prayersloft` |
| 6 | `splash-icon.png` referenced but file missing | ✅ fixed — created from `splash-image.png` |
| 7 | `ITSAppUsesNonExemptEncryption` missing (App Store will prompt) | ✅ added → `false` (we don't use custom encryption) |
| 8 | Android `package` missing (parity with iOS bundle id) | ✅ fixed |
| 9 | `expo-secure-store` and `expo-web-browser` not in plugins list | ✅ added |
| 10 | `extra.eas.projectId` placeholder | ⚠️ **you must fill after `eas init`** |
| 11 | `owner` placeholder | ⚠️ **you must fill with your Expo username** |
| 12 | `eas.json` placeholder backend URL | ⚠️ **you must fill with your deployed FastAPI URL** |

---

## E. Common pitfalls (read before first build)

1. **Bundle ID mismatch** — Apple Developer → Identifiers must contain `com.prayersloft.app` AND App Store Connect → App Information must point to the same Bundle ID. Both must exist BEFORE `eas submit`.
2. **Backend URL** — if you build with the placeholder URL still in `eas.json`, the iOS bundle will hard-fail all API calls. The fix is to redeploy backend FIRST, paste its URL, then build.
3. **Push notifications not implemented** — do NOT add `expo-notifications` to plugins yet. Adding it without entitlements will trigger Apple capability checks. (Documented as B-002 backlog.)
4. **Missing usage descriptions** — if you ever add camera/contacts/location, add the corresponding `NS*UsageDescription` in `ios.infoPlist` BEFORE building, or Apple will reject.
5. **Signing certificate quota** — Apple Developer allows max 2 distribution certs. If EAS asks to revoke an existing one, that's normal.
6. **expo-doctor warnings** — most are advisory; only red-text errors block the build.
7. **Build number must monotonically increase** for each TestFlight upload. `eas.json` profiles have `"autoIncrement": "buildNumber"` so EAS handles this automatically across submits.
8. **Apple's 2-factor auth** — first `eas submit` will prompt for an app-specific password (Apple ID → Sign-In & Security → App-Specific Passwords). Generate one labeled "EAS" and paste when asked.

---

## F. After a successful build — TestFlight invite path

1. App Store Connect → your app → **TestFlight** tab
2. Wait for the build status to flip from **Processing** → **Ready to Test** (5–30 min)
3. Click your build → add it to a **Beta Group** (create one called "Friends & Family")
4. Add testers by email (or send them a public TestFlight link)
5. Apple will email each tester an invite; they install TestFlight app and tap **Accept**
