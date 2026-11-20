# Tests for the INDAI website

Browser tests (Playwright, Chromium) and two Node checks. They were written alongside each feature and are kept
here so whoever works on the website next can run them.

```bash
# from the repository root: serve the site, then run a test from this folder
python3 -m http.server 8765 --bind 127.0.0.1 &
cd indai/tests && npm i playwright && npx playwright install chromium
node chart-test.js        # moving, zooming, axes, drawing, earlier sessions, the TradingView panel
node capture-test.js      # candle sizes 1m to weekly, Analyze / Capture and its reading, candles kept on the device
node patterns-unit.mjs    # the Capture reading's detectors against TA-Lib 0.8.3 (talib-fixture.json), proxies, anchored candles
node ext-test.js          # pre-market and after-hours candles and the price line (sets its own clock: same result at any hour)
node schwab-test.js       # the Connect Schwab page, and the owner's passcode on price requests (stand-in back end)
node stream-unit.mjs      # Schwab's live stream client against a stand-in socket and clock (no browser)
node stream-test.js       # "Test live stream" on the Connect page, and stream ticks moving the app's price and candle
node flow.js              # the whole app in demo mode, phone and laptop
node mock.js              # against a stand-in backend that follows HANDOFF.md (lib.js is that stand-in)
node ideas-test.js        # ideas strip, list, alerts, catch-up (its catch-up checks need a session that has started today)
node retro-test.js        # Retrospective and back-test screens;  node retro-unit.mjs  for the maths
node lock-test.js; node budget.js; node sound.js; node swpush.js; node extra.js; node bottom.js; node resume.js; node smoke.js
node pine-ref.mjs         # the TradingView strategy's logic against the app's scanner
```

Every test prints PASS or FAIL lines and ends with ALL PASSED. They load the site with `?demo=1` or a mocked
backend, so they need no keys. Paths at the top of a few files (`retro-unit.mjs`, `pine-ref.mjs`) point at a checkout
of both repositories side by side under `/home/claude`; change them to yours. Screenshots are written next to the tests.


## Portable regression checks (November 20)

The PR workflow runs the browser checks in three groups and retains logs/screenshots as Actions artifacts.
Set `INDAI_TEST_URL` to a different local preview base (including its trailing slash); set `CHROMIUM_PATH`
only when using a system Chromium. Tests use an isolated backend fixture by default, never an owner token.
Individual fixtures override that default. The catch-up test fixes the clock inside a trading session, including
when CI runs before the open.

`final-touches.js` covers fresh/stale metadata, missing previous close, options failure messages, drawing
operations, history states, layout at 360/820/1440px, unsupported sync keys and iframe isolation/full screen.
`final-unit.mjs` covers drawing merge/tombstones, cancellation and source labels. `profile-unit.mjs` covers
queued profile saves, offline retries and edits arriving during a request. TradingView network calls use a static vendor-frame fixture; origin isolation and controls are checked.
These fixture checks do not certify
TradingView's live service or real iPhone sound/push delivery.
