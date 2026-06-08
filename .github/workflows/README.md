# GitHub Actions Workflows

## `e2e.yml` — Playwright End-to-End suite

Runs the full Playwright test suite against a live local stack on every
push to `main` and every pull request targeting `main`. Also triggerable
manually via the **Actions → e2e → Run workflow** button.

### What it does

1. Spins up **MongoDB 7** as a service container.
2. Installs Python deps and starts the **FastAPI backend** on port 8001.
3. Installs Node deps and starts **Expo web** on port 3000.
4. Runs `playwright test` from `tests/`.
5. Uploads HTML report + backend/expo logs on failure (14-day retention).

### Required GitHub Secrets

| Secret | Purpose | If missing |
|---|---|---|
| `EMERGENT_LLM_KEY` | Backend LLM calls for prayer/scripture/reflections | Tests calling LLM endpoints will fail; happy-path prayer specs will skip |

To set: **Settings → Secrets and variables → Actions → New repository secret**.

### Why this exists

v1.0.0 build 5 shipped to TestFlight with a silent API-resolution bug.
The full Playwright suite would have caught it instantly — if it had run
automatically. This workflow ensures no broken code reaches `main` without
the 55+ tests passing first.

### Local equivalent

```bash
# Start backend + mongo + expo (e.g. via supervisor), then:
cd tests
npm install
npx playwright install chromium
PRAYERS_LOFT_URL=http://localhost:3000 npx playwright test
```

### Manual retrigger

If a CI run fails due to flakiness (e.g., MongoDB took >30s to come up):
- **Re-run failed jobs** from the Actions UI, OR
- Push an empty commit: `git commit --allow-empty -m "ci: retrigger"`.

### Timeout budget

Job timeout: **25 min**. Typical wall time: 8–12 min. If runs consistently
approach 25 min, investigate hung specs or shard the suite across parallel
jobs (e.g., split `01-09` and `10-18` into two parallel jobs).
