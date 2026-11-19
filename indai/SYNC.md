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
| `js/ideas.js` | none | Trade ideas as a place of their own: the strip under the top bar, the Ideas list, the new-idea card and the chime. The engine (scan, catch-up, forming, the day's list) is in `app.js` |
| `js/retro.js` | none | Retrospective: replays the day's setups with results (win, loss, R, stop and target variants, pullback entry), groups where it missed, proposes score and stop/target changes from the kept days, and applies them to fresh setups through `app.tune` |
| `js/lock.js` | none | Access lock: when the backend reports an owner passcode, one screen asks for the access token and nothing else runs until the backend accepts it |
| `js/push.js` | none | Push notifications: registers this browser with `indai-push`, keeps the backend's `plan` and `watchlist` profile current; `sw.js` shows the notification |
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
- Trade ideas (`ideas.js`, `app.js`): the setup scanner and its rules are the shared `signals.js`, unchanged. What is different is everything around it. The scan runs the moment new candles land (and every 5 seconds as a backstop) instead of every 15 seconds, and bridge candles are looked for every 2.5 seconds after the minute turns. The day's ideas are kept for the New York day (`localStorage` key `indai.web.ideas.v1`), so a reload never loses them, and setups that confirmed while the page was closed or asleep are replayed from today's candles and listed quietly ("Earlier today"). A setup past the plan's alerts-per-hour limit is listed without an alert instead of being dropped. A setup taking shape on the candle that is still open shows as "Forming" from its second minute (volume projected to the full candle) and confirms or disappears at the close. Out loud she says a short version (ticker, direction, grade, contract, stop, target); the full text is in the conversation. Each idea shows what price did next (target reached, stopped, or still open), and the chart marks every idea with an arrow and draws stop and target for the one in focus. "Skip" on the pinned card only takes it off that card.
- Retrospective (`retro.js`, button in the Ideas list, chip in the strip after the close, "retrospective" typed or spoken): the scanner itself (`signals.js`) is untouched. The website replays every setup the scanner found that day at the plan's score level from the day's candles, measures each against its stop and target on the one-minute candles (R multiples), and keeps finished days on the device (`localStorage` key `indai.web.retro.v1`, last 20 trading days, real data only). From all kept days it proposes changes: points up or down for a time window, kind of setup, direction, ticker or warning (at least 8 setups in the group, 20 overall, pulled toward the average, capped at −10 and +3, total −15 to +8), a higher score line (one 3-point step at a time, only when what it cuts was losing and at least half remain), and a different stop or target distance (30 setups, clearly and consistently better across days). Nothing changes until "Apply"; applied changes go onto each fresh setup in `app.tune` before the score line, with the scanner's own numbers kept on the idea; "Clear what she has learned" undoes it all. The lesson is also saved to backend memory (`kind: rule`). The backend's push scanner does not use these adjustments.
- Access lock (`lock.js`): the backend's `INDAI_PASSCODE` is the lock. When `GET indai-brain` reports `passcode: true`, a device without an accepted token shows only the lock screen: no prices, alerts or voice start behind it. The token is checked by the backend (`mode: memory, op: list` with `x-indai-pass`), kept in `settings.researchPass` (the same field the Quest app uses), and asked for again if the backend stops accepting it. Settings can lock the device again. The market-data, TradingView read and GEX endpoints are not behind the passcode on the backend, and the site's files are public.
- Push (`push.js`, `sw.js`): Settings has "Turn on push notifications" (permission, `GET indai-push` for the key, `pushManager.subscribe`, `POST indai-push {op: subscribe}`), a test and "Turn off". While it is on, `mode: profile, op: put` keeps `plan` (date, aggr, capital, goal, strategies, pnl, goalHit, tripped, cooldownUntil, symbols, manual levels) and `watchlist` current within seconds of a change. The service worker shows each push (quietly if INDAI is on screen) and a tap opens that ticker in Ideas. iPhone and iPad need the Home Screen app.
- Thinking budget care (`demo.js`): when the backend answers `429 budget` (or `rate_limited`), she says once in plain words that today's thinking budget is used up until midnight New York time, then keeps working with built-in commands and market-data ratings, with no "couldn't reach my thinking brain" plus "I heard …" pair. She checks again every five minutes, or at once from Settings. Web research that fails twice in a row on the backend (`502 parse` / `upstream`, or a timeout) pauses itself until midnight New York time, because each failed try still spends the budget; Settings has "Turn web research back on".
- Being heard on a phone (`app.js`, no change to `voice.js`): on iPhone and iPad the audio session is set to `playback` so the ring/silent switch does not mute her (a looping silent clip does the same on older iOS), and to `play-and-record` only while the mic is open. The mic is released the moment listening ends instead of 25 seconds later, because iOS plays everything at quiet call volume while it is open. The audio engine is woken on every tap and on coming back to the app (`interrupted`, or `running` with a stalled clock). The phone's own voice is unlocked by the first tap. If the natural voice takes more than about 3.5 seconds to start talking twice in a row on a phone, she uses the phone's own voice for the rest of the visit and says so. Settings shows a Sound line with all of this.
- Safari and iOS always listen with the on-device model on WebAssembly (no browser speech recognition, no WebGPU), unless "Browser speech recognition" is picked in Settings.
