# Testing `pacman-horror` on Devin

## Project basics

- Build tool: Vite (`npm run build` emits `dist/`).
- Type check / lint: `npm run lint` (runs `tsc --noEmit`).
- Dev server: `npm run dev` on port 5173 (Vite default).
- Preview (prod build served locally): `npm run build && npm run preview -- --host 0.0.0.0 --port 4173`.
- Public preview URL (deployed from `dist/`): https://dist-ogjmsuyy.devinapps.com (same subdomain persists across redeploys).
- CI: **no CI is configured on this repo**. `git(action="pr_checks")` will show `0 passed / 0 failed / 0 pending`. Don't wait on CI; verify locally instead.
- No repo secrets; nothing to set up for auth.

## Running the app locally

```
npm install
npm run dev            # hot-reload dev server
# or
npm run build && npm run preview -- --host 0.0.0.0 --port 4173
```

Open `http://localhost:4173` (preview) or `http://localhost:5173` (dev).

## Testing UI changes end-to-end

### Important: the `google-chrome` command on Devin's VM is a stub

`/home/ubuntu/.local/bin/google-chrome` is a one-line wrapper that does:

```sh
curl -XPUT ... http://localhost:29229/json/new?<url>
```

It opens a URL in the **already-running** DevTools-controlled Chrome at port 29229. It is **not** a browser launcher. If port 29229 is down, the command does nothing and reports `Connection refused` in a way that's easy to mistake for a real browser failure. There is no real Chrome / Chromium binary installed on the VM.

### Use Playwright with its bundled Chromium instead

For any automated testing (touch events, mobile emulation, screenshots, asserting CSS/geometry), use Playwright:

```
playwright install chromium   # one-time, ~150 MB
```

Then in Python:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=False,
        args=["--disable-gpu-sandbox", "--use-gl=swiftshader"],
    )
    context = browser.new_context(
        viewport={"width": 393, "height": 852},    # iPhone 14 Pro
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
        user_agent="Mozilla/5.0 (iPhone; ...)",
    )
    page = context.new_page()
    page.goto("https://dist-ogjmsuyy.devinapps.com", wait_until="networkidle")
```

Run with `DISPLAY=:0 python3 script.py` so the browser shows on the VM screen for screen recording. Headless works too if you only need screenshots and assertions.

### Dispatching real touch events

`page.touchscreen.tap(x, y)` works for simple taps but can't do drag sequences. For joystick testing, use CDP directly:

```python
client = page.context.new_cdp_session(page)
def touch(type_, x, y):
    client.send("Input.dispatchTouchEvent", {
        "type": type_,
        "touchPoints": [{"x": x, "y": y, "id": 1}] if type_ != "touchEnd" else [],
    })
touch("touchStart", cx, cy)
touch("touchMove",  cx + 50, cy - 30)
touch("touchEnd", 0, 0)
```

## Game-specific hooks for testing

- Dev Tools password: `2010`. Stored in `sessionStorage['soulchase.dev.unlocked']` after unlock (NOT persistent across tab close).
- Dev Tools panel is opened via the gear icon `#hud-settings-btn` → Settings → DEV TOOLS tab.
- Useful dev button IDs (see `src/settings.ts:209-299`):
  - `dev-jump-floor` — jump to any floor 1..20 (plays real descent animation).
  - `dev-trigger-cliffhanger` — jumps straight to the floor-20 cutscene + RUN COMPLETE end screen. Fastest way to verify end-screen layout.
  - `dev-kill-player` — triggers the HE FOUND YOU lose screen immediately.
  - `dev-invincible`, `dev-reveal-orbs`, `dev-slow-pacman`, `dev-infinite-stamina` — checkbox toggles on the game state.
- Settings persistence key: `localStorage['soulchase.settings.v1']` (JSON: `renderScale`, `joystickScale`, `hudScale`, `fov`, `masterVol`).

## Software WebGL caveat

The Devin VM doesn't have hardware WebGL. Playwright Chromium + `--use-gl=swiftshader` runs the game, but the 3D scene renders very dim. The game loop, DOM, HUD, settings, dev tools, end screens, and all CSS/geometry assertions are unaffected — only the visual quality of the canvas suffers. If a test reviewer complains the scene looks dark, it's not a regression.

## Minimal regression sanity check

```python
# After any change to CSS, controls, or UI:
#   1. page.goto(preview, wait_until="networkidle")
#   2. click #title-play, pick .diff-btn[data-difficulty="easy"]
#   3. wait #hud to lose .hidden
#   4. tap #hud-settings-btn -> #settings-panel should lose .hidden
#   5. tap .set-tab[data-tab="dev"], type 2010 into #dev-password, click #dev-unlock
#   6. tap #dev-trigger-cliffhanger -> #cliffhanger-screen should appear with .end-title = "RUN COMPLETE"
```

If any of these steps hang, the likeliest cause is the old `#touch-controls` wrapper swallowing taps again (see `src/style.css:269-297`). The wrapper must have `pointer-events: none` and the `.touch-zone` / `#touch-sprint` elements must individually set `pointer-events: auto`.
