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
- If the app fell back to demo prices because the network was down, it retries and switches back to real data by itself.
- Safari and iOS always listen with the on-device model on WebAssembly (no browser speech recognition, no WebGPU), unless "Browser speech recognition" is picked in Settings.
