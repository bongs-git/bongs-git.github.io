# Keeping the INDAI website in step with the Quest app

The website (this folder, served at https://bongs-git.github.io/indai/) and the Meta Quest command center
([bongs-git/jarvis-command-center](https://github.com/bongs-git/jarvis-command-center)) are one product with two faces.
They share the same backend and the same brains. Only the presentation layer differs.

Synced at commit: `17629cb16fd451d03135d991e0c53b2a68de0be6` (2026-11-19)

## Shared files (copied byte for byte, never edited here)

| File here | Source in jarvis-command-center | What it is |
|---|---|---|
| `js/relay.js` | `js/relay.js` | The only client of the Supabase backend (market data, brain, TradingView, GEX table) |
| `js/feeds.js` | `js/feeds.js` | Market feed: CBOE delayed, Finnhub, TradingView bridge candles, demo simulator |
| `js/market.js` | `js/market.js` | Market clock, holidays, EMA, VWAP |
| `js/analysis.js` | `js/analysis.js` | Technicals, trade idea parsing, the RAG score |
| `js/options.js` | `js/options.js` | Black-Scholes, Monte Carlo, the profit grid |
| `js/signals.js` | `js/signals.js` | Game plan, market temperature, setup scanner, contract sizing |
| `js/store.js` | `js/store.js` | Settings and per-day state in browser storage |
| `js/indai.js` | `js/indai.js` | INDAI herself: commands, conversation, check-in, analysis, self-test, memory |
| `js/voice.js` | `js/voice.js` | Speaking (Kokoro on-device, system voice fallback) and listening |
| `js/speech.js` | `js/speech.js` | What she learns about how you talk |
| `js/workers/voice-worker.js` | `js/workers/voice-worker.js` | The on-device voice and listening models |
| `vendor/ort/*` | `vendor/ort/*` | ONNX runtime (WebAssembly) for those models |
| `brand/indai-logo.png`, `icons/*.png` | same paths | Logo and app icons |

Run `./sync.sh /path/to/jarvis-command-center` to re-copy them. It also checks that the website still provides
everything the shared code imports and calls, and rewrites the "Synced at commit" line above.

## Website-only files (the presentation layer)

| File | Replaces in the Quest app | Notes |
|---|---|---|
| `js/app.js` | `js/main.js` | Builds the same `app` object `indai.js` talks to (feed, settings, day, levelsFor, riskState, selectSymbol, openFocus, closeFocus, openDeepDive, consolidate, restoreAll, logTrade, brief, markDirty, caption, loadCalc, lockPlan, practiceAlert, replayScan and so on). Risk breaker, game plan, setup alerts and level logic are ported line for line from `main.js`: when those change there, port the change here. |
| `js/views.js` | `js/panels.js` (screens), `js/ui.js` | Top bar, watchlist, chart header, levels, lead/lag, risk breaker, today's plan, the conversation, tabs, mic |
| `js/sheets.js` | `js/panels.js` (focus cards), `js/ui.js` | Verdict card, deep dive, calculator, summary, plan editor, self-test, settings |
| `js/chart.js` | `js/panels.js` (canvas drawing) | Candles, VWAP, EMA clouds, GEX lines, sparklines, lead/lag, payoff curve |
| `js/hud.js` | `js/hud.js` | Stand-in: number formatters only. Must keep exporting `fmtPrice`, `fmtMoney` (imported by `indai.js`) |
| `js/panels.js` | `js/panels.js` | Stand-in: label helpers only. Must keep exporting `levelSourceLabel` (imported by `indai.js`) |
| `js/demo.js` | none | Wraps `relay` at run time: fail-fast when the backend is unreachable, and a simulated options chain in demo mode |
| `index.html`, `css/app.css`, `sw.js`, `manifest.webmanifest`, `fonts/` | `index.html`, `sw.js`, `manifest.webmanifest` | Layout, theme, installable app shell (same cross-origin-isolation headers as the Quest service worker) |

Headset-only calls are answered politely instead of doing anything: `setScene`, `cycleScene`, `setGestures`,
`startTutorial`, `recenter`, `enterXR`. `gestures.js`, `scenes.js` and `three` are not shipped here.

## When a feature lands in either app

1. Add a row to `FEATURES.md` in jarvis-command-center (the `web` column says whether the website has it).
2. If it changed a shared file, run `./sync.sh` here and fix anything it flags.
3. If it changed `main.js`, `panels.js` or `ui.js`, port the matching part to `app.js`, `views.js` or `sheets.js`.
4. Test: `python3 -m http.server` in the repo root, open `/indai/?demo=1`, try the phone, tablet and laptop widths.

## Small differences on purpose

- Typed commands do not open the microphone by themselves; tapping the mic brings hands-free follow-ups back.
- A typed command during the morning check-in runs as a command instead of being taken as the answer.
- In demo mode the option chain is simulated from the demo prices (the Quest app shows a "couldn't load the chain" message offline).
- If the app fell back to demo prices because the network was down, it retries and switches back to real data by itself. The fail-fast switch in `demo.js` only applies while on demo prices; on real data every request goes out.
- The automatic morning check-in waits until the mic is closed and nothing is open before she starts asking.
- Undo also takes back a cooldown that the undone loss started; a calculator opened for a ticker with no price yet snaps its strike to the chain.
- Levels in demo mode are always the simulated ones, so they match the simulated prices.
- The service worker also keeps the voice runtime (`voice-worker.js`, `vendor/ort`) in a cache of its own. `sync.sh` renames that cache when those files change.
- The chart and lead/lag fit the session so far (with room to the right) instead of always drawing the full 9:30 to 4:00 width, and chart labels move aside rather than overlap.
- Coming back to the app, or getting signal back, pulls fresh prices at once; a failed quote pull is retried within seconds.
- Thinking budget care (`demo.js`): when the backend answers `429 budget` (or `rate_limited`), she says once in plain words that today's thinking budget is used up until midnight New York time, then keeps working with built-in commands and market-data ratings, with no "couldn't reach my thinking brain" plus "I heard …" pair. She checks again every five minutes, or at once from Settings. Web research that fails twice in a row on the backend (`502 parse` / `upstream`, or a timeout) pauses itself until midnight New York time, because each failed try still spends the budget; Settings has "Turn web research back on".
- Being heard on a phone (`app.js`, no change to `voice.js`): on iPhone and iPad the audio session is set to `playback` so the ring/silent switch does not mute her (a looping silent clip does the same on older iOS), and to `play-and-record` only while the mic is open. The mic is released the moment listening ends instead of 25 seconds later, because iOS plays everything at quiet call volume while it is open. The audio engine is woken on every tap and on coming back to the app (`interrupted`, or `running` with a stalled clock). The phone's own voice is unlocked by the first tap. If the natural voice takes more than about 3.5 seconds to start talking twice in a row on a phone, she uses the phone's own voice for the rest of the visit and says so. Settings shows a Sound line with all of this.
- Safari and iOS always listen with the on-device model on WebAssembly (no browser speech recognition, no WebGPU), unless "Browser speech recognition" is picked in Settings.
