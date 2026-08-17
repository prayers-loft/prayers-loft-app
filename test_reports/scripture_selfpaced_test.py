"""
Playwright test for Scripture tab self-paced progression regression.
Tests 4 scenarios:
  1. Opening tab does NOT advance progress
  2. Mark Complete advances progress (visible after reload)
  3. Save reflection also advances
  4. Guests never write server progress
"""
import asyncio
import json
import os
import uuid
import requests
from playwright.async_api import async_playwright

BACKEND = "https://exodus-build-preview.preview.emergentagent.com"
FRONTEND = "http://localhost:3000/scripture"

results = {}


def register_user():
    email = f"canonprog_{uuid.uuid4().hex[:12]}@prayersloft-qa.com"
    r = requests.post(
        f"{BACKEND}/api/auth/register",
        json={"email": email, "password": "TestPass123!"},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    # Flatten tokens for convenience
    if "tokens" in data:
        data["access_token"] = data["tokens"]["access_token"]
        data["refresh_token"] = data["tokens"]["refresh_token"]
    return email, data


async def seed_auth_localstorage(page, auth_data, email):
    """Write the auth store key to localStorage before app loads."""
    payload = {
        "user": {
            "id": auth_data.get("user", {}).get("id") or auth_data.get("id") or "unknown",
            "email": email,
            "name": auth_data.get("user", {}).get("name"),
            "picture": None,
            "providers": ["email"],
            "createdAt": None,
        },
        "tokens": {
            "access_token": auth_data.get("access_token"),
            "refresh_token": auth_data.get("refresh_token"),
        },
        "provider": "email",
    }
    # If user object is nested differently, try to extract
    user = auth_data.get("user")
    if user:
        payload["user"] = {
            "id": user.get("id"),
            "email": user.get("email", email),
            "name": user.get("name"),
            "picture": user.get("picture"),
            "providers": user.get("providers", ["email"]),
            "createdAt": user.get("created_at") or user.get("createdAt"),
        }
    await page.evaluate(
        """(data) => { window.localStorage.setItem('prayersloft_auth_v1', JSON.stringify(data)); }""",
        payload,
    )
    return payload


async def run_scenario_1(page, token, email):
    """Opening the tab does not advance progress."""
    scenario = {"name": "S1: Opening tab does not advance", "pass": False, "details": []}
    post_completions = []

    def on_request(req):
        if "/api/daily-verse/complete" in req.url and req.method == "POST":
            post_completions.append(req.url)

    page.on("request", on_request)

    await page.goto(FRONTEND, wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="scripture-day-headline"]', timeout=15000)

    for i in range(3):
        headline = await page.text_content('[data-testid="scripture-day-headline"]')
        scenario["details"].append(f"Load {i}: headline={headline!r}")
        if "Day 1" not in (headline or ""):
            scenario["details"].append(f"FAIL: Expected 'Day 1' in headline")
            page.remove_listener("request", on_request)
            results["scenario_1"] = scenario
            return
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="scripture-day-headline"]', timeout=15000)

    # final check
    final = await page.text_content('[data-testid="scripture-day-headline"]')
    scenario["details"].append(f"Final headline={final!r}")

    # Directly call GET /api/daily-verse from browser context with the Bearer token
    resp = await page.evaluate(
        """async (args) => {
            const [backend, tok] = args;
            const r = await fetch(backend + '/api/daily-verse', {
                headers: { 'Authorization': 'Bearer ' + tok }
            });
            return { status: r.status, body: await r.json() };
        }""",
        [BACKEND, token],
    )
    scenario["details"].append(
        f"GET /api/daily-verse: status={resp['status']} day={resp['body'].get('day')} "
        f"last_completed_date={resp['body'].get('progress', {}).get('last_completed_date') if resp['body'].get('progress') else None}"
    )

    day_ok = resp["body"].get("day") == 1
    progress = resp["body"].get("progress") or {}
    lcd_ok = progress.get("last_completed_date") in (None, "")
    no_post = len(post_completions) == 0
    headline_ok = "Day 1" in (final or "")

    scenario["details"].append(f"POST /complete calls during viewing: {len(post_completions)}")
    scenario["pass"] = day_ok and lcd_ok and no_post and headline_ok
    if not scenario["pass"]:
        scenario["details"].append(
            f"day_ok={day_ok} lcd_ok={lcd_ok} no_post={no_post} headline_ok={headline_ok}"
        )
    page.remove_listener("request", on_request)
    results["scenario_1"] = scenario


async def run_scenario_2(page, token):
    """Tap Mark Complete advances progress."""
    scenario = {"name": "S2: Mark Complete advances", "pass": False, "details": []}
    completion_posts = []

    async def on_response(resp):
        if "/api/daily-verse/complete" in resp.url and resp.request.method == "POST":
            try:
                body = await resp.json()
            except Exception:
                body = {}
            completion_posts.append({"status": resp.status, "body": body, "req_body": resp.request.post_data})

    page.on("response", lambda r: asyncio.create_task(on_response(r)))

    await page.goto(FRONTEND, wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="scripture-day-headline"]', timeout=15000)

    # Expand passage
    await page.click('[data-testid="scripture-passage-toggle"]', force=True)
    await page.wait_for_timeout(500)

    # Scroll to and click mark complete
    btn = page.locator('[data-testid="scripture-mark-complete-button"]')
    await btn.scroll_into_view_if_needed()
    await btn.click(force=True)

    # Wait for completion card
    try:
        await page.wait_for_selector('[data-testid="scripture-completion-card"]', timeout=8000)
        scenario["details"].append("Completion card appeared")
    except Exception as e:
        scenario["details"].append(f"Completion card did NOT appear: {e}")
        results["scenario_2"] = scenario
        return

    # Headline still on Day 1
    headline_before_reload = await page.text_content('[data-testid="scripture-day-headline"]')
    scenario["details"].append(f"Headline pre-reload={headline_before_reload!r}")
    day1_stays = "Day 1" in (headline_before_reload or "")

    # Wait for network POST
    await page.wait_for_timeout(2500)
    scenario["details"].append(f"POST /complete calls: {len(completion_posts)}")
    for p in completion_posts:
        scenario["details"].append(f"  status={p['status']} req_body={p['req_body']} resp_body_keys={list(p['body'].keys())[:5]}")

    post_ok = (
        len(completion_posts) == 1
        and completion_posts[0]["status"] == 200
    )
    # Validate req body has day=1
    req_ok = False
    if completion_posts:
        try:
            rb = json.loads(completion_posts[0]["req_body"] or "{}")
            req_ok = rb.get("day") == 1 and "local_date" in rb
            scenario["details"].append(f"req parsed: {rb}")
        except Exception:
            pass

    # Reload — expect Day 2
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="scripture-day-headline"]', timeout=15000)
    headline_after = await page.text_content('[data-testid="scripture-day-headline"]')
    scenario["details"].append(f"Headline post-reload={headline_after!r}")
    day2_after = "Day 2" in (headline_after or "")

    scenario["pass"] = day1_stays and post_ok and req_ok and day2_after
    if not scenario["pass"]:
        scenario["details"].append(
            f"day1_stays={day1_stays} post_ok={post_ok} req_ok={req_ok} day2_after={day2_after}"
        )
    results["scenario_2"] = scenario


async def run_scenario_3(page):
    """Save reflection advances."""
    scenario = {"name": "S3: Save reflection advances", "pass": False, "details": []}
    completion_posts = []

    async def on_response(resp):
        if "/api/daily-verse/complete" in resp.url and resp.request.method == "POST":
            try:
                body = await resp.json()
            except Exception:
                body = {}
            completion_posts.append({"status": resp.status, "body": body})

    page.on("response", lambda r: asyncio.create_task(on_response(r)))

    await page.goto(FRONTEND, wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="scripture-day-headline"]', timeout=15000)

    # Type reflection
    ref_input = page.locator('[data-testid="scripture-reflection-input"]')
    await ref_input.scroll_into_view_if_needed()
    await ref_input.fill("This is my thoughtful reflection today.")

    # Click save
    await page.click('[data-testid="scripture-save-reflection-button"]', force=True)

    # Wait for completion card
    try:
        await page.wait_for_selector('[data-testid="scripture-completion-card"]', timeout=10000)
        scenario["details"].append("Completion card appeared")
    except Exception as e:
        scenario["details"].append(f"Completion card did NOT appear: {e}")

    await page.wait_for_timeout(2500)
    scenario["details"].append(f"POST /complete calls: {len(completion_posts)}")
    post_ok = len(completion_posts) == 1 and completion_posts[0]["status"] == 200

    # Reload — expect Day 2
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="scripture-day-headline"]', timeout=15000)
    headline_after = await page.text_content('[data-testid="scripture-day-headline"]')
    scenario["details"].append(f"Headline post-reload={headline_after!r}")
    day2_after = "Day 2" in (headline_after or "")

    scenario["pass"] = post_ok and day2_after
    if not scenario["pass"]:
        scenario["details"].append(f"post_ok={post_ok} day2_after={day2_after}")
    results["scenario_3"] = scenario


async def run_scenario_4(page):
    """Guest never writes server progress."""
    scenario = {"name": "S4: Guest never writes progress", "pass": False, "details": []}
    completion_posts = []

    async def on_response(resp):
        if "/api/daily-verse/complete" in resp.url and resp.request.method == "POST":
            try:
                body = await resp.json()
            except Exception:
                body = {}
            completion_posts.append({"status": resp.status, "body": body})

    page.on("response", lambda r: asyncio.create_task(on_response(r)))

    await page.goto(FRONTEND, wait_until="domcontentloaded")
    # Ensure no auth
    await page.evaluate("() => window.localStorage.removeItem('prayersloft_auth_v1')")
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="scripture-day-headline"]', timeout=15000)

    headline = await page.text_content('[data-testid="scripture-day-headline"]')
    scenario["details"].append(f"Guest headline={headline!r}")
    subtitle_ok = False
    try:
        prog = await page.text_content('[data-testid="scripture-progress-label"]')
        scenario["details"].append(f"progress_label={prog!r}")
        subtitle_ok = "journey has begun" in (prog or "").lower()
    except Exception:
        pass

    headline_ok = "Day 1" in (headline or "")

    # Tap passage toggle
    toggle = page.locator('[data-testid="scripture-passage-toggle"]')
    await toggle.scroll_into_view_if_needed()
    await page.wait_for_timeout(500)
    # Try multiple click strategies (RN web pressable can be finicky)
    try:
        await toggle.click(force=True)
    except Exception:
        pass
    await page.wait_for_timeout(1500)
    mark_present = await page.locator('[data-testid="scripture-mark-complete-button"]').count()
    if mark_present == 0:
        scenario["details"].append("First toggle click did not expand; dispatching JS click")
        await page.evaluate("""() => {
            const el = document.querySelector('[data-testid=\"scripture-passage-toggle\"]');
            if (el) {
                const rect = el.getBoundingClientRect();
                ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => {
                    el.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, clientX: rect.left+5, clientY: rect.top+5}));
                });
            }
        }""")
        await page.wait_for_timeout(2000)
    try:
        await page.wait_for_selector('[data-testid="scripture-mark-complete-button"]', timeout=8000, state="attached")
    except Exception as e:
        await page.screenshot(path="/app/test_reports/screenshots/s4_no_mark.jpg", quality=40, full_page=False, type="jpeg")
        ids = await page.evaluate("""() => Array.from(document.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid'))""")
        scenario["details"].append(f"visible testIDs after toggle: {ids}")
        raise
    btn = page.locator('[data-testid="scripture-mark-complete-button"]')
    await btn.scroll_into_view_if_needed()
    await page.wait_for_timeout(300)
    try:
        await btn.click(force=True)
    except Exception:
        await page.evaluate("""() => {
            const el = document.querySelector('[data-testid=\"scripture-mark-complete-button\"]');
            if (el) {
                const rect = el.getBoundingClientRect();
                ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => {
                    el.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, clientX: rect.left+5, clientY: rect.top+5}));
                });
            }
        }""")

    try:
        await page.wait_for_selector('[data-testid="scripture-completion-card"]', timeout=8000)
        scenario["details"].append("Completion card appeared (guest)")
        card_ok = True
    except Exception as e:
        scenario["details"].append(f"Completion card did NOT appear: {e}")
        card_ok = False

    await page.wait_for_timeout(2500)
    scenario["details"].append(f"POST /complete calls: {len(completion_posts)}")
    guest_body_ok = False
    if completion_posts:
        b = completion_posts[0]["body"]
        scenario["details"].append(f"resp body: status={b.get('status')} progress={b.get('progress')}")
        guest_body_ok = b.get("status") == "guest" and b.get("progress") is None

    # Fetch GET /api/daily-verse without auth from browser
    resp = await page.evaluate(
        """async (backend) => {
            const r = await fetch(backend + '/api/daily-verse');
            return { status: r.status, body: await r.json() };
        }""",
        BACKEND,
    )
    guest_progress = resp["body"].get("progress")
    scenario["details"].append(f"GET /daily-verse guest progress={guest_progress}")
    server_no_progress = guest_progress is None

    scenario["pass"] = headline_ok and subtitle_ok and card_ok and guest_body_ok and server_no_progress
    if not scenario["pass"]:
        scenario["details"].append(
            f"headline_ok={headline_ok} subtitle_ok={subtitle_ok} card_ok={card_ok} "
            f"guest_body_ok={guest_body_ok} server_no_progress={server_no_progress}"
        )
    results["scenario_4"] = scenario


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # ---- Scenario 1 & 2: signed-in user #1 ----
        email1, auth1 = register_user()
        token1 = auth1["access_token"]
        print(f"User1: {email1}")
        ctx1 = await browser.new_context(viewport={"width": 390, "height": 844})
        page1 = await ctx1.new_page()
        # Seed localStorage BEFORE app load: navigate to blank/index first
        await page1.goto(FRONTEND.replace("/scripture", "/"), wait_until="domcontentloaded")
        await seed_auth_localstorage(page1, auth1, email1)

        try:
            await run_scenario_1(page1, token1, email1)
        except Exception as e:
            results["scenario_1"] = {"name": "S1", "pass": False, "details": [f"exception: {e}"]}
        try:
            await run_scenario_2(page1, token1)
        except Exception as e:
            results["scenario_2"] = {"name": "S2", "pass": False, "details": [f"exception: {e}"]}
        await ctx1.close()

        # ---- Scenario 3: fresh signed-in user #2 ----
        email2, auth2 = register_user()
        print(f"User2: {email2}")
        ctx2 = await browser.new_context(viewport={"width": 390, "height": 844})
        page2 = await ctx2.new_page()
        await page2.goto(FRONTEND.replace("/scripture", "/"), wait_until="domcontentloaded")
        await seed_auth_localstorage(page2, auth2, email2)
        try:
            await run_scenario_3(page2)
        except Exception as e:
            results["scenario_3"] = {"name": "S3", "pass": False, "details": [f"exception: {e}"]}
        await ctx2.close()

        # ---- Scenario 4: guest / no auth ----
        ctx3 = await browser.new_context(viewport={"width": 390, "height": 844})
        page3 = await ctx3.new_page()
        try:
            await run_scenario_4(page3)
        except Exception as e:
            results["scenario_4"] = {"name": "S4", "pass": False, "details": [f"exception: {e}"]}
        await ctx3.close()

        await browser.close()

    print("\n\n===== RESULTS =====")
    for k, v in results.items():
        status = "PASS" if v["pass"] else "FAIL"
        print(f"\n[{status}] {v['name']}")
        for d in v["details"]:
            print(f"  - {d}")

    # Write JSON
    with open("/app/test_reports/scripture_selfpaced_results.json", "w") as f:
        json.dump(results, f, indent=2)


if __name__ == "__main__":
    asyncio.run(main())
