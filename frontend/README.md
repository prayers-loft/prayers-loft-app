# Prayers Loft — Mobile

A quiet place to pray, reflect, and remember. Prayers Loft is a discipleship
companion built with Expo (SDK 55), FastAPI, and MongoDB. This directory
holds the Expo mobile frontend.

## Get started

1. Install dependencies

   ```bash
   yarn install
   ```

2. Start the Metro bundler

   ```bash
   yarn start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- Android emulator or connected device
- iOS simulator or connected device
- Expo Go (limited — some features such as background audio and push
  notifications require a full development build)

## Project layout

- `app/` — screens (file-based routing via `expo-router`)
  - `(tabs)/` — Prayer, Scripture, Bible Assistant, Walk
  - `reflections-history.tsx` — the Journal
  - `settings.tsx`, `privacy.tsx`, `terms.tsx`
- `src/components/` — shared UI (share cards, primer sheets, etc.)
- `src/lib/` — non-UI helpers (auth store, streak ledger, upgrade prompts)
- `src/theme/` — colors, fonts, spacing

## Backend

The FastAPI backend lives in `/app/backend`. The frontend talks to it via
`EXPO_PUBLIC_BACKEND_URL` (see `app.json → expo.extra`). All routes are
prefixed with `/api` so the ingress can route them cleanly.

## Branding

- App name: **Prayers Loft**
- Bundle identifier / Android package: `com.prayersloft.app`
- Icons + splash live in `assets/images/` (leaf & quill mark on
  midnight-blue).
