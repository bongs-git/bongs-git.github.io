# INDAI for phone, tablet and laptop

The flat (no headset) version of the INDAI command center. Live at **https://bongs-git.github.io/indai/**

It is the same INDAI as the Meta Quest app ([jarvis-command-center](https://github.com/bongs-git/jarvis-command-center)):
same backend, same brain, same voice. Only the screens are different.

## What is here

- Top bar with the market clock and where prices come from (live, delayed or demo).
- Watchlist with sparklines, the main candlestick chart (1, 5, 15 and 30 minutes, 1 and 4 hours, daily and weekly) with VWAP,
  EMA clouds and GEX levels, lead/lag, GEX levels. 30 minutes and longer open with earlier sessions in view; daily and
  weekly go back years (INDAI's backend, plus Twelve Data when a key is saved in Settings).
- Candles kept on the device: the minutes the page receives (regular and extended hours, 45 days) and every daily candle
  are saved in the browser, so yesterday and earlier days are still on the chart after the close, over the weekend and
  when the backend has nothing for them.
- Analyze and Capture: tap Analyze (or pick Capture in the drawing tools), drag a box around candles, and INDAI reads them:
  a picture of the box, the candle patterns by TA-Lib's rules and the six structure proxies of *The Market Pattern Atlas*
  (with the side and the trend/volatility bin the atlas filed them under), shapes, trend, momentum and MACD divergences,
  support, resistance and GEX walls, the bull, bear and range paths with trigger, invalidation and objectives, which
  timeframes to look at next (one tap reads the chart again at that size), and INDAI's own read. A tap reads the whole
  chart. Captures are kept on the device and can be opened again. The atlas's tested numbers for each pattern come from
  the backend once it offers them (`mode:"atlas"` in the brain's status); nothing on the device makes up a probability.
- Ideas strip under the top bar on every screen: each setup alert the moment its candle confirms (and "forming" a minute or
  more before), newest first. Tap one for the reasons, the sized contract, stop, entry and target, what price did next, and
  one tap to rate it or see it on the chart. The day's ideas survive a reload, and ones you missed are caught up quietly.
- A chart you can work on: drag to move it, pinch or scroll to zoom, two quick taps to reset. "Draw" adds trend lines and
  price levels you can move, change and delete; they are kept on the device per ticker.
- Pre-market and after-hours on the chart: once the session is over, its after-hours candles and the next morning's
  pre-market follow it (tinted, a little fainter, no VWAP or EMA), and earlier sessions carry theirs when you scroll
  back. "Ext" in the chart's switches turns them off. Under the price, a second line shows the pre-market or
  after-hours price and its change from the regular close, the way TradingView does; during the session it shows
  the day's high and low. With a Finnhub key in Settings, that price and its candle move trade by trade.
- Drag the price axis or the time axis to stretch or squeeze that scale. Drag the chart back past the open to see
  earlier sessions (as many as the TradingView bridge has stored). "TradingView chart" shows TradingView's own
  chart in the panel for deeper history and their tools.
- Retrospective (button in Ideas, best after the close): how the day's setups did, where they missed most (time of day, kind
  of setup, direction, ticker, entry, stop, target), and what INDAI would change. You apply the changes; she alerts with
  them from then on, and each new day checks whether they held up.
- Back-test of the changes (inside the Retrospective): the kept days with and without the changes, side by side: setups
  alerted, win rate, result, average per setup, dollars at your risk per trade, profit factor, deepest drawdown, longest
  losing run, and each day on its own. "The fair test" judges each day with only what was learned before it.
- TradingView back-test and Bar Replay (`tradingview/`): the same scanner as a TradingView strategy, for months of history
  in the Strategy Tester and candle-by-candle simulation with Bar Replay. The Retrospective copies the changes as one
  line to paste into the strategy's settings.
- Push notifications (Settings): A-plus setups reach the phone with INDAI closed, sent by the backend from the TradingView
  bridge candles. On iPhone, add INDAI to the Home Screen first.
- Access lock: once the backend has an owner passcode, every device shows one screen asking for the access token and nothing
  else until it is right.
- Risk breaker: log wins and losses, loss limit, cooldowns, undo, position sizer and setup checklist.
- INDAI conversation: tap the mic (or hold the space bar) and talk, or type. She answers out loud with the on-device voice,
  keeps listening for a follow-up, learns your mishears ("no, I said …"), remembers what you tell her ("remember that …"),
  and becomes a free conversationalist when the backend's thinking key is set.
- Trade ideas to a red / amber / green verdict card, deep dives, the options profit calculator with strategy presets,
  the morning check-in and game plan, setup alerts with sized contract ideas, practice alerts, the self-test,
  TradingView bridge status and "open in TradingView", and settings.

Scenes, hand gestures and the gesture tutorial are headset-only; ask for them here and INDAI says so.

## Layout

- Phone: one column, bottom tabs (Watch, Chart, INDAI, Plan, More) and a large mic button by your thumb.
- Tablet: chart on top, watchlist and levels beside the conversation, plan and breaker below.
- Laptop: everything on one screen. Analysis, calculator and deep dive open over the chart with INDAI still in view.

## Run it locally

No build step. From the repository root:

```
python3 -m http.server 8000
# open http://localhost:8000/indai/        add ?demo=1 for simulated prices
```

Handy switches: `?demo=1` simulated data, `?nosw=1` skip the service worker, `?nocheckin=1` skip the automatic morning check-in,
`?calc=1`, `?settings=1`, `?selftest=1`.

## Keeping it in step with the Quest app

See [SYNC.md](SYNC.md). `./sync.sh /path/to/jarvis-command-center` re-copies the shared modules and checks the two still fit together.

INDAI's analysis is information, not financial advice. You make every trade.
