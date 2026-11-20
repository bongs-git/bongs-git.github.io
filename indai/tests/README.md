# Tests for the INDAI website

Browser tests (Playwright, Chromium) and two Node checks. They were written alongside each feature and are kept
here so whoever works on the website next can run them.

```bash
# from the repository root: serve the site, then run a test from this folder
python3 -m http.server 8765 --bind 127.0.0.1 &
cd indai/tests && npm i playwright && npx playwright install chromium
node chart-test.js        # moving, zooming, axes, drawing, earlier sessions, the TradingView panel
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
