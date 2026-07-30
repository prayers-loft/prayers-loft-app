# Workspace Export — Scripture Journey + Health-Check Fixes

**Diff base:** `release/build-23-sdk55-integration` (`84879b31`)
**Diff head:** `fix/build-26a-critical-fixes` (`4eb4326b` — current workspace)

## 📦 What's in this folder

| File | Size | Contents |
|---|---|---|
| `00-full-workspace-vs-build23.patch` | 18 MB | **Everything** — complete workspace diff (code + reading plan data + emergent scaffolding). Apply this if you want a 1:1 mirror. |
| `01-code-only.patch` | 5.0 MB | Code + tests + build config **only**. Excludes 995-day reading plan JSON assets (see #2) and Emergent-internal cron files. **Recommended if you already have the plan artifact separately.** |
| `02-reading-plan-data.patch` | 13 MB | The static Bible reading plan data — `canonical-web-v1.json` (7.8 MB, 995 days of WEB passages + Claude Haiku summaries), plus build-time report/cache/rewrite-log files. Immutable data — no code. |
| `03-emergent-artifacts-optional.patch` | 69 KB | Emergent workspace scaffolding (`.emergent/cron/*`, `test_reports/iteration_*.json`, `test_result.md`). **Safe to skip** — these are pod-side only. |
| `04-changed-files-tarball.tgz` | 5.4 MB | Fallback: raw current state of every changed/added file, gzipped. Use if `git apply` misbehaves. |
| `DELETED_FILES.txt` | — | 6 obsolete Expo template images to `rm` (only meaningful when applying tarball). |
| `CHANGED_FILES.txt` | — | Human-readable file-by-file diff summary (excludes bulky data). |

## 🔐 Integrity (SHA-256)
```
8dd02f4419...ce24f648  00-full-workspace-vs-build23.patch
7171d5ef5d...b4ec3e96  01-code-only.patch
cc60610c05...539be953  02-reading-plan-data.patch
d4477f99be...726e7c9a  03-emergent-artifacts-optional.patch
fd52939575...c60f213f  04-changed-files-tarball.tgz
```

## 🚀 Recommended apply flow

```bash
# 1. Fresh checkout of the base branch
cd path/to/prayers-loft-app
git fetch origin
git checkout release/build-23-sdk55-integration
git pull

# 2. Create a new branch to receive the diff
git checkout -b release/build-26-canonical-plan

# 3. Verify the patches apply cleanly (dry run — makes NO changes)
git apply --check 01-code-only.patch
git apply --check 02-reading-plan-data.patch

# 4. Apply for real
git apply 01-code-only.patch
git apply 02-reading-plan-data.patch
# (Skip 03 unless you want the .emergent/cron scaffolding on your local machine.)

# 5. Stage and commit
git add -A
git commit -m "feat(scripture): canonical WEB Bible reading plan (995 days, self-paced)

- Immutable reading plan artifact: backend/reading_plans/canonical-web-v1.json
  (995 days · 25-40 verses per day · Claude Haiku overviews · frozen at build time)
- Backend: new /api/daily-verse contract + /api/daily-verse/complete endpoint
- reading_progress collection: per-user, self-paced, day-995 capped, idempotent
- Frontend: rewritten Scripture tab — 'Journey Through Scripture', 'Today's Reading',
  passage overview, key verse card, self-paced 'Mark Today's Reading Complete',
  'Pause & Reflect' journal, %-through-Bible progress indicator, 'Continue Your Walk' sheet
- Tests: 20 canonical-plan pytest cases + updated legacy contract tests
- Health-check fixes: added httpx to requirements.txt, ShareKind payload conforms,
  ios.buildNumber 20 → 21

Diff base: release/build-23-sdk55-integration @ 84879b31"

# 6. Push
git push origin release/build-26-canonical-plan
```

## 🔍 What changed at a glance

**Backend** (`backend/`)
- `server.py` — `/api/daily-verse` rewritten to serve canonical plan; new `/api/daily-verse/complete` endpoint; `reading_progress` collection with index; `_read_reading_progress()` helper (never mutates on GET).
- `reading_plans/` — new module: `loader.py` (in-memory singleton), `canonical-web-v1.json` (frozen), `bible_structure.py`, `AUTHORING_RULES.md`, `CORPUS_ATTRIBUTION.md`.
- `requirements.txt` — added `httpx>=0.28.0` (backend/auth.py + email_service.py import it; was missing).
- `tests/test_canonical_reading_plan.py` — new 20-test suite covering: never-advance-on-GET, complete-once-only, stale/future/duplicate no-ops, day-995 cap, guest isolation, 401 on invalid Bearer, loader cache correctness.
- `tests/test_critical_user_flows.py`, `tests/test_iteration6_health_and_regression.py`, `tests/test_bible_assistant.py`, `tests/test_phase2_auth_release.py` — updated legacy `assert body["devotional"]` (deprecated in canonical plan) to `assert body["summary"] and body["plan_id"]`.

**Frontend** (`frontend/`)
- `app/(tabs)/scripture.tsx` — full rewrite for canonical plan UI (Journey header, day/section chips, 2-min-read, key-verse card, passage overview with Read more, Pause & Reflect journal, explicit "Mark Today's Reading Complete", %-through-Bible label, Continue Your Walk bottom sheet, share via ShareImageModal). Emotion chips removed. Share payload conforms to `ShareKind` union.
- `src/lib/api.ts` — new `DailyVerseResponse` shape (plan_id, passage[], key_verse, summary, progress); new `api.completeDailyReading(day, localDate, tz)`.
- `app.json` — `ios.buildNumber` bumped `"20"` → `"21"` for TestFlight.

**Scripts** (`scripts/` — offline build tools, NOT shipped)
- `plan_boundaries.py` — authored 995 passage boundaries.
- `generate_summaries.py` — Claude Haiku summary generation (frozen, no runtime cost).
- `build_canonical_artifact.py` — assembles final immutable `canonical-web-v1.json`.
- `validate_plan.py` / `validate_boundaries.py` / `summaries_report.py` — CI validation.

## ⚠️ Not included (Emergent-only, don't merge)
- `.emergent/cron/*` — pod-side webhook scaffolding
- `test_reports/iteration_*.json` — Emergent testing_agent output
- `test_result.md` — Emergent handoff notes
- `patches/` — this folder itself

## 🧪 Verify after apply
```bash
# Backend tests (296 pass, 5 skipped in Emergent workspace):
cd backend
EXPO_PUBLIC_BACKEND_URL=https://prayers-loft.preview.emergentagent.com python -m pytest tests/ -q

# Frontend lint:
cd frontend
npx expo lint
```
