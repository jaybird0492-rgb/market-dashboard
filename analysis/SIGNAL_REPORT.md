# Signal Generation Report — market-analysis v2

Written 2026-11-16 from code (`scripts/`) and published data. Paper-only system; no real orders.

---

## 1. How signals are generated

### The pipeline

GitHub workflow `dashboard-update` runs every 15 minutes (GitHub throttles it to ~4–5
runs/day; the bots replay from scratch each run so no closed bar is ever missed):

1. `fetch_history.js` — pulls Binance public klines (no key): full daily history
   (2017-08-17 → today) and live 1h/4h/1d bars.
2. `v2_paper.js` / `v2_paper4h.js` — replay the portfolio engine over all closed bars
   from each account's start date; recompute positions, fills, stops, equity.
3. `v2_signals.js` — builds the three-layer signal view per coin → `web/data/signals.json`.
4. `v2_events.js` — Fear & Greed, funding/OI, severity-tagged headlines, 1H price shocks
   (context only — never a trade trigger).
5. `v2_verify.js` — CI gate: fails the workflow if the accounting identities drift.
6. Commit + deploy to GitHub Pages.

### The three layers (only closed bars are ever used)

| Layer | Timeframe | Role | Authority |
|---|---|---|---|
| Context | 1D | Regime + daily averages gate | Grants/withholds permission per side |
| Setup | 4H | Donchian breakout triggers | The only layer that opens trades |
| Warning | 1H | Breakout/FAKEOUT/APPROACHING state | Never trades. Information only |

**Context (1D):** SMA50 and SMA200 of daily closes. Regime: TREND UP (price > SMA200 and
SMA50 > SMA200), TREND DOWN (opposite), else TRANSITION.

**Setup (4H):** Donchian 20-bar breakout entries / 10-bar trail exits, a native 4H SMA200
trend filter, and the *dual daily gate*:
- LONG allowed when the last completed daily close is **above daily SMA50**;
- SHORT allowed when it is **below daily SMA200**;
- when price is **between the two averages, both sides are open** (the pullback band —
  the 4H Donchian decides instead of a daily average vetoing).

Effective permission for a side = daily gate AND native 4H SMA200 filter.

**Warning (1H):** a state machine over the 1H 20-bar range: BREAKOUT (last 1H close
outside the range), FAKEOUT (broke within the last 12h and fell back inside), APPROACHING
(within 1% of a level), QUIET. It also counts, over 180 days, how often a 1H break was
confirmed by a 4H close within 24h — currently BTC 53%, ETH 47%.

---

## 2. What triggers a signal

Two entry rules exist. **Nothing fires mid-candle** — the candle must close first, and
the fill happens at the **next bar's open**.

### Daily core (slow layer, `stratA` on 1D, Donchian 55/20)

- **Long signal:** a daily close **above the prior 55-day high** AND above the daily SMA200.
- **Short signal:** a daily close **below the prior 55-day low** AND below the daily SMA200.
- **Exit:** daily close back through the opposite 20-day extreme (close < prior 20-day low
  for longs, > prior 20-day high for shorts).
- **Trigger levels shown on the dashboard** are the *next bar's* thresholds: the extreme of
  the 55 bars *including* the last closed bar. E.g. today BTC shows short trigger 62,006 —
  a close below that fires; the current price has no effect until the bar closes.

### 4H futures layer (trade layer, Donchian 20/10 + G5 dual gate)

- **Long signal:** a 4H close **above the prior 20-bar high**, with close > 4H SMA200, and
  the daily gate allowing longs.
- **Short signal:** a 4H close **below the prior 20-bar low**, with close < 4H SMA200, and
  the daily gate allowing shorts.
- **Exit:** 4H close back through the prior **10-bar** extreme in the adverse direction,
  or the ATR stop, or 360 bars (~60 days) max hold.
- Fill at the next 4H open. One position per coin; no pyramiding (a new same-direction
  breakout while already in is shown as `lastBreakout` but does not trade).

### Timing semantics that must never be forgotten

- Gate and filters are evaluated at the **signal bar's open** using only daily bars fully
  closed before then — conservative, no lookahead, identical in backtest/paper/signals.
- The displayed triggers include the last closed bar (that is the correct next-bar test).
- The daily bot books a fill only when the **next daily bar closes** (fill price = that
  bar's open). A one-day display lag, not a P&L error.
- `pending` state lives at most one bar; it is re-derived by full replay each run.

---

## 3. Stop loss and take profit

**Stop:** set once at entry = fill price ± **2.5 × ATR(14)** of the signal bar (4H ATR for
the 4H layer; the daily core uses its own). Static for the life of the position — it does
not trail. It is a disaster stop; the normal exit is the Donchian trail. Example (live):
4H BTC short entered 74,836.47, stop 76,752.23 (≈ 2.56% away). Stops are simulated as
market exits at the next bar open after the level is crossed — in a violent gap the real
fill could be worse than modeled.

**Take profit: none in the engine.** Exits are the Donchian trail or the stop. That is the
validated design: the big winners that run for many R are what carry the expectancy. The
dashboard now **displays** TP1/TP2/TP3 = 1R/2R/3R from entry (R = stop distance), with ✓
when price has passed a level — explicitly labelled *reference only*. The engine never
acts on them. Real partial exits would be a new strategy requiring a fresh backtest.

**Risk sizing:** 0.75% of that account's equity per trade ($75 on the $10k paper
accounts), no leverage, futures cost model (fee 0.05%/side, slippage 0.02%/side,
funding drag 0.03%/day).

---

## 4. What you actually see on the charts before a signal posts

The pre-signal sequence, using the real 2026-11-08 BTC signal and today's state:

1. **Permission is already visible.** The daily gate card shows "SHORT only — close below
   SMA200" days before any trigger. Today both coins: SHORT-only, TRANSITION regime.
2. **Price drifts toward the trigger level.** The setup card shows the exact 4H trigger and
   distance: BTC short trigger 62,006 (4.8% below the last 4H close), ETH 1,711.08 (6.5%).
   Nothing else matters until a candle closes through it.
3. **The 1H layer heats up first.** As price nears a level, the warning flips
   APPROACHING (currently: BTC 1H 0.4% above its breakdown level, ETH 0.7%). If an hourly
   candle closes through its 20-bar range it becomes BREAKOUT; if it then recovers inside,
   FAKEOUT. Historically ~45–53% of these 1H breaks are confirmed by a 4H close within
   24h — so a 1H BREAKOUT is roughly a coin flip and is never traded.
4. **The decision candle.** At a 4H close, the engine checks: did the close cross the
   trigger? Is the daily gate open for that side? Is price on the right side of the 4H
   SMA200? Only if all three pass does a pending entry appear on the dashboard.
5. **Fill and stop appear at the next 4H open.** Real example — BTC on 2026-11-08 20:00Z:
   4H closed 74,851.44 < trigger 74,888.00, gate open → SHORT filled 74,836.47 at the
   2026-11-09 00:00Z open, stop 76,752.23. It is now +5.4R.

What you will *never* see: a trade from a headline, a shock flag, a Fear & Greed reading,
or a 1H breakout. Those appear on the dashboard as context beside the setup, deliberately
separated from the trade logic.

---

## 5. Performance of current and past signals

### Backtests (same code path as live; costs included; out-of-sample split by entry date)

| Layer | Result |
|---|---|
| Daily core (portfolio, BTC+ETH shared $10k) | n=69, expR **+1.55R ±1.43**, PF 4.40, **+100.2%**, CAGR 7.8%, **maxDD −19.7%**; IS +2.28R / OOS +0.65R; ex-top-3 +0.39R |
| Parameter plateau (entry 40–70 × exit 15–30 × stop 2.0–3.0) | **54/54 combinations** pooled expR > +0.15R and OOS > 0 |
| 4H G5 layer (portfolio) | n=606, win rate 34.5%, expR **+0.44R ±0.23**, PF 1.63, +511.5%, CAGR 21.8%, **maxDD −15.2%**; OOS n=276 +0.39R |

The 4H shape is classic trend following: **~1 in 3 wins, winners several times bigger
than losers.** The historical replay fixture (`preview_4h.json`, a past period replayed
through the live UI) shows 21 closed trades: 6 wins / 15 losses, expR +1.35R, PF 3.35 —
expect long losing streaks between the runs that pay for everything.

### Live paper (both accounts currently 0 closed trades — nothing confirmed yet)

| Account | Since | Equity | Open positions |
|---|---|---|---|
| Daily core | 2026-10-29 | **$10,166.90** (+1.7%) | ETH short +1.17R, BTC short +1.05R |
| 4H futures (G5 reset) | 2026-11-04 | **$10,678.93** (+6.8%) | BTC short +5.42R (MFE 6.7R), ETH short +3.63R (MFE 4.7R) |

All four are the same trade — short — riding the November collapse from ~$75k/2,150 to
~$64k/1,800. Open risk $300 total, ~1.4–1.5% of each sleeve. Exits sit far above
(BTC 4H close > 10-bar high ~66k region; stops 76,752 / 2,215 on 4H).

### Past records worth remembering

- **v1 (multi-factor score engine):** retired 2026-10-29 after paper **−$939.74** over 113
  trades, BTC/ETH 1D win rate 0% in October. Deleted; never resurrect.
- **First F3 4H trades (2026-10-30 → 11-02):** 2 trades, **−0.80R** (shorted into the
  Binance-hack crash, stopped/signal-exited). The account was then reset with G5.
- **Pre-paper backtest streak:** 8 consecutive 4H trades at **−6.1R** before the paper
  reset — the whipsaw cost of this design in chop.
- **Signal audits (2026-11-13 and 2026-11-16):** independent recomputation of every
  published signal field matched exactly. The math is not the weak point.

---

## 6. Worrisome — read this honestly

1. **The live system has zero confirmed evidence.** 0 closed trades on both accounts; all
   profit is unrealized and one correlated short. The 6-week 4H review clock restarts
   2026-11-04; earliest meaningful review is **mid-December 2026**. Do not conclude
   anything before ~10 closed trades (the dashboard enforces this).
2. **The 4H edge is thin.** expR +0.44R with OOS ex-top-3 of only +0.06R/+0.05R per coin.
   Fees, slippage, or a regime change can erase that. The daily core is the statistically
   stronger layer; the 4H layer is a trade-frequency bet.
3. **G5 was chosen with hindsight** (after a live gate failure was identified). Its paper
   period is the real out-of-sample test — which is still running.
4. **BTC and ETH are one bet.** 247 of 606 backtest entries overlapped. Right now four
   open positions are the same short; a squeeze hits both accounts simultaneously.
5. **This month flatters the system.** A violent trend makes any Donchian follower look
   brilliant. The same design lost −6.1R over 8 trades in chop weeks earlier. Judge it
   across regimes.
6. **Staleness invites human override.** Data can be 4+ hours old (GitHub throttling). The
   engine replays and misses nothing — but a stale trigger panel can tempt a manual trade
   on numbers the engine hasn't confirmed. If it isn't on the engine, it isn't a trade.
7. **Gap risk through stops.** Stops are stop-market orders simulated at next-bar open; in
   a crash the real fill can be materially worse than −1R (the model charges slippage
   0.02%, a real gap can be 2%+). Also, funding drag is an average — it spikes in extremes.
8. **The current APPROACHING state is bait.** BTC 1H is 0.4% above its breakdown level,
   but the 4H short trigger is ~4% lower. A 1H break would NOT fire a trade. Resist acting
   on the 1H layer — that is what its "never trades" label means.

---

## 7. Retain — invariants and rules that must not drift

**Never change without a pre-registered test + fresh review:**
- Signal at bar **close**, fill at **next bar open**, closed bars only.
- Triggers include the last closed bar (correct next-bar test); gate evaluated at the
  signal bar's open on fully closed daily bars.
- 0.75% risk per trade. Do NOT raise it to chase buy-and-hold returns — drawdown scales
  with it (−19.7% at 0.75% ⇒ roughly −35%+ at 1.5%).
- Universe is BTC/ETH only. XRP/HYPE/SOL/BNB are out by owner decision.

**Kill rule (written 2026-10-29, before any trade):** HALT if drawdown from peak > 25% or
15 consecutive losing closed trades. Halting = remove the workflow step; replay makes
resuming trivial and auditable.

**Structural facts:**
- One position per coin, no pyramiding; `lastBreakout` while in a position is informational.
- 1H and events never trigger trades. 1H confirm stats are heuristic context.
- v1 is deleted; never quote v1's or F3's first-run numbers as if they were results.
- Every run is a full replay from account start — state cannot fork.
- The dashboard suppresses performance conclusions below 10 closed trades (by design).
- The CI verifier (equity = start + closed P&L + open unrealized, etc.) gates every deploy.

**Review milestones:**
- 4H G5 paper review: after 4–6 weeks from 2026-11-04 → earliest mid-Dec 2026.
- Real money is a separate, fresh decision — minimum size, written kill rule, only after
  the paper review passes. Nothing here is approved for real money yet.
