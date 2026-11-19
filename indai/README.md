# INDAI for phone, tablet and laptop

The flat (no headset) version of the INDAI command center. Live at **https://bongs-git.github.io/indai/**

It is the same INDAI as the Meta Quest app ([jarvis-command-center](https://github.com/bongs-git/jarvis-command-center)):
same backend, same brain, same voice. Only the screens are different.

## What is here

- Top bar with the market clock and where prices come from (live, delayed or demo).
- Watchlist with sparklines, the main candlestick chart (1, 5, 15 minute) with VWAP, EMA clouds and GEX levels, lead/lag, GEX levels.
- Ideas strip under the top bar on every screen: each setup alert the moment its candle confirms (and "forming" a minute or
  more before), newest first. Tap one for the reasons, the sized contract, stop, entry and target, what price did next, and
  one tap to rate it or see it on the chart. The day's ideas survive a reload, and ones you missed are caught up quietly.
- Retrospective (button in Ideas, best after the close): how the day's setups did, where they missed most (time of day, kind
  of setup, direction, ticker, entry, stop, target), and what INDAI would change. You apply the changes; she alerts with
  them from then on, and each new day checks whether they held up.
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
