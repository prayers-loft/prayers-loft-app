# Prayers Loft — End-to-End Test Suite

Production-ready Playwright suite covering every major user journey for the
Prayers Loft mobile (Expo Web) app.

## Run

```bash
cd /app/tests
npm install                 # first time only
npx playwright install chromium   # first time only
./run-tests.sh              # full suite, generates report + coverage summary
./run-tests.sh @smoke       # smoke only
./run-tests.sh @prayer      # any single journey
```

Frontend must be reachable at `http://localhost:3000` (Expo's default).
Override with `PRAYERS_LOFT_URL=https://… ./run-tests.sh`.

## What's covered

| Journey | Spec | Tag |
|---|---|---|
| Smoke (boot, nav, shell) | `01-smoke.spec.ts` | `@smoke` |
| Prayer generation | `02-prayer.spec.ts` | `@prayer` |
| Scripture / daily verse / Q&A | `03-scripture.spec.ts` | `@scripture` |
| Reflections journal | `04-reflections.spec.ts` | `@reflections` |
| Share image generation + Save | `05-share.spec.ts` | `@share` |
| Offline / degraded mode | `06-offline.spec.ts` | `@offline` |
| Guest mode (no auth) | `07-guest-mode.spec.ts` | `@guest-mode` |
| Data persistence (storage) | `08-persistence.spec.ts` | `@persistence` |
| Tab navigation | `09-navigation.spec.ts` | `@navigation` |

## Hard failure gates (any one of these fails a test)

- `console.error` (anything not in `CONSOLE_ALLOWLIST` in `_helpers.ts`)
- Unhandled `pageerror` (uncaught JS exceptions)
- `requestfailed` on any `/api/*` route (except in `@offline` which scopes them out)
- 5xx responses from `/api/*`
- Missing test-IDs / expected DOM nodes (via `expect(...).toBeVisible()`)
- Broken navigation (URL never resolves to the expected route)

All three failure sources are aggregated by `watchFailures(page)` and asserted
at the end of every test via `failures.assertNone()`.

## Reports

- `playwright-report/index.html` — full HTML report with traces / videos / screenshots
- `playwright-report/results.json` — raw machine-readable results
- `coverage-summary.txt` — per-journey pass/fail rollup (printed to stdout)
- `coverage-summary.json` — same rollup for CI consumption

## CI integration

`run-tests.sh` exits non-zero when any journey fails, so it drops straight
into any deployment pipeline:

```yaml
- name: E2E
  run: cd tests && ./run-tests.sh
```
