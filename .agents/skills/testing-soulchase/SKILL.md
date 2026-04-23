# Testing SOULCHASE (Three.js web game)

Triggers: testing this repo end-to-end, verifying UI changes in the browser, checking preview deployments, or reproducing a gameplay bug.

## Running a local preview

```bash
cd /home/ubuntu/repos/pacman-horror
nvm use 22 && npm ci
npm run build  # outputs dist/
npx vite preview --port 4173  # or: python3 -m http.server --directory dist 4173
```

The public preview URL (`dist-ogjmsuyy.devinapps.com`) is rebuilt by `deploy(command="frontend", dir="dist")`. After any code change, **always rebuild + redeploy before testing** — the bundle hash can stay the same even when contents differ, so don't trust the URL alone.

## Chrome on the Devin VM — known gotchas

- The `google-chrome` in `~/.local/bin` is **not** the browser — it's a CDP helper that opens tabs in an already-running Chrome at port 29229. If CDP isn't up, that wrapper silently does nothing.
- The real Chrome binary lives at `/opt/.devin/chrome/chrome/linux-137.0.7118.2/chrome-linux64/chrome`.
- Hardware GL is unavailable in this VM, so Three.js **fails to create a WebGL context** by default. `new Game()` throws and none of the main.ts event listeners get attached (clicks do nothing).
  - Launch with `--use-gl=swiftshader --enable-unsafe-swiftshader --use-angle=swiftshader --disable-gpu-sandbox` to enable software GL. Canvas renders dim but the game loop ticks, HUD works, and all DOM assertions are valid.
- The window manager here doesn't implement `_NET_ACTIVE_WINDOW`, so `xdotool windowactivate` / `wmctrl` fail. The computer-use `console` tool refuses with "Chrome is not in the foreground" and synthetic mouse clicks often miss targets.
- **Workaround**: drive the UI directly via CDP. `/home/ubuntu/cdp_eval.py` (this session) evaluates JS in the active tab via the websocket; build one early and use `document.getElementById('...').click()` to trigger handlers deterministically. The event pipeline is the real one — listeners, game methods, DOM state all update exactly as under a human click.

## Full Chrome launch (copy-paste)

```bash
pkill -9 -f chrome 2>/dev/null; sleep 2
rm -rf /home/ubuntu/.browser_data_dir/Singleton* 2>/dev/null
CHROME_BIN=/opt/.devin/chrome/chrome/linux-137.0.7118.2/chrome-linux64/chrome
DISPLAY=:0 "$CHROME_BIN" \
  --user-data-dir=/home/ubuntu/.browser_data_dir \
  --no-first-run --remote-debugging-port=29229 --window-size=1280,800 \
  --use-gl=swiftshader --enable-unsafe-swiftshader --use-angle=swiftshader --disable-gpu-sandbox \
  https://dist-ogjmsuyy.devinapps.com/ >/tmp/chrome.log 2>&1 &
disown
sleep 5
curl -sS http://localhost:29229/json/version  # sanity
```

## DOM hooks for common test scenarios

All IDs stable across builds (defined in `index.html`).

| Feature | How to trigger programmatically |
|---|---|
| Title → Play flow | `document.getElementById('title-play').click()`, then a `.diff-btn[data-difficulty=easy]` click |
| Open abilities panel | `document.getElementById('title-abilities').click()` |
| Switch abilities tab | `[...document.querySelectorAll('.ab-tab')].find(t=>t.dataset.tier==='big').click()` |
| Open settings from title | `document.getElementById('title-settings').click()` |
| Open settings mid-run | `document.getElementById('hud-settings-btn').click()` |
| Switch settings tab | `[...document.querySelectorAll('.set-tab')].find(t=>t.dataset.tab==='dev').click()` |
| Change a slider (fires handler) | set `.value`, then `dispatchEvent(new Event('input',{bubbles:true}))` |
| Unlock dev tools | set `#dev-password`.value='2010', click `#dev-unlock` |
| Jump to floor N | set `#dev-floor-slider`.value, click `#dev-jump-floor` |
| Trigger cliffhanger | click `#dev-trigger-cliffhanger` (note: `-cliffhanger`, not `-cliff`) |
| Skip cutscene | click `#cutscene-skip` |
| Read game state | `document.getElementById('dev-state-readout').textContent` (needs dev unlocked) |

Element ID that's easy to mistype: lock panel is `#dev-locked` (with 'd'), not `#dev-lock`.

## Persistence

- Settings: `localStorage['soulchase.settings.v1']` — JSON with `renderScale`, `joystickScale`, `hudScale`, `fov`, `masterVol`.
- Dev unlock: `sessionStorage['soulchase.dev.unlocked']` === `'1'` — resets on tab close.
- Clear both with:
  ```js
  localStorage.removeItem('soulchase.settings.v1');
  sessionStorage.removeItem('soulchase.dev.unlocked');
  ```

## Measuring render-scale effect

The render-scale slider calls `renderer.setPixelRatio(dpr * scale)` (clamped). Observable via `document.querySelector('canvas').width` — at 40% it's ~`cssWidth * dpr * 0.4`, at 150% it's ~`cssWidth * dpr * 1.5`. A broken no-op slider would leave canvas.width constant; the ratio 150/40 should be ≈ 3.75× on a dpr=1 display.

## Invincibility test pattern

To prove `setInvincible(true)` actually works in reasonable time:

1. Jump to floor 1 (slow small map, hunter reliably reaches player).
2. Enable **Invincible** AND **Slow Pac-Man**.
3. Close settings, stand still ~10–12 seconds.
4. Assert `#lose-screen` still has class `hidden` and dev state readout shows `invincible  true`.

Without invincibility the same setup ends in `HE FOUND YOU` within a few seconds — making this a real adversarial test, not a tautology.

## Devin secrets needed

None — preview URL is public, no auth required. Dev Tools password is literal `2010` (intentional, client-side only).

## When writing a test report

- Post ONE PR comment with a table of results + `<details>` block for screenshots.
- Attach the annotated recording via `upload_attachment` so the URL can go in the PR comment.
- Always note the swiftshader caveat and the CDP-click caveat so the user understands what's testable on this VM vs what needs a real device.
