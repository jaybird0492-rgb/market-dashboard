# Signal Report — How a Signal Is Generated and What We Concluded Before Posting

## 1. Purpose

Every signal shown on the website is produced by a deterministic pipeline — nothing is manually posted. A signal is only stamped after a full analysis of **closed** price bars, and every signal carries its own entry, stop-loss, take-profits and a plain-English trigger so it is actionable or explicitly "no trade".

## 2. Data layer (what feeds the analysis)

- **Sources:** Yahoo Finance for stocks (AAPL, GOOGL, AMZN, SPY, QQQ), Coinbase for crypto (BTC, ETH).
  - Binance is geo-blocked (HTTP 451) on GitHub Actions runners, so the pipeline automatically falls back to Coinbase.
- **Timeframes:** 1H, 4H, 1D, 1M (we removed 3D/7D — 4 timeframes keep the page readable while covering trade horizon + long-term context).
- **Only closed bars are analyzed.** The stamping logic compares the last bar timestamp against a stored state; a partially-formed bar never produces a signal.

## 3. Per-timeframe analysis (what we measure)

For each symbol × timeframe:

- **Moving averages:** MA20, MA50, MA200 (trend context; price above/below MA200 = long-term bias).
- **Momentum/volatility:** RSI-14, ATR-14 (as % of price), 1-bar / 3-bar / 10-bar changes.
- **Structure (swing logic):** 2-bar swing highs/lows; nearest swing above price = resistance, nearest swing below = support (within the last 60 bars).
- **Trend classification:**
  - both the last swing high AND low higher than earlier ones → **uptrend**
  - both lower → **downtrend**
  - otherwise → **ranging**
- **Verdict per timeframe:** `BUY SETUP`, `WATCH`, or `NO TRADE` with an explanation in plain English.

## 4. Setup generation — the rules (the actual signal)

### Uptrend
- **RSI > 75** → `WAIT`: overbought, no fresh entry; wait for a pullback to MA20.
- Otherwise → **BUY**:
  - Entry = resistance (if one exists — buy the breakout) OR price + 1×ATR (pullback plan toward MA20 when no nearby resistance).
  - Stop = support (if it exists) OR price − 1.5×ATR.
  - Risk R = |entry − stop|.
  - **TP1 = entry + 1R (take 40%) · TP2 = entry + 2R (take 40%) · TP3 = entry + 3R (take 20%)** — scaling out, keeping a runner.
  - Trigger is explicit: "buy when a 1H candle CLOSES above resistance $X" or "buy on pullback toward MA20 $Y".

### Downtrend
- **RSI < 25** → `WAIT`: oversold, no fresh short.
- Otherwise → **SELL**, mirrored: entry = support (breakdown) or price − 1×ATR; stop = resistance or price + 1.5×ATR; TP1/TP2/TP3 = entry − 1R/2R/3R (40/40/20).

### Ranging
- Both support and resistance exist → **RANGE**: no trade until a close above resistance (long plan) or below support (short plan). No entry/SL/TP boxes — deliberately.

### No structure
- **NONE**: not enough swing structure to define levels; check back on the next update.

**Conclusions we made here:**
- RANGE / WAIT / NONE are honest "no trade" signals — we never invent levels to fill a box.
- 40/40/20 partial scaling is deliberate: it locks in profit at 1R and 2R while keeping a runner for 3R.
- A signal is only "real" when the bar **closes** through a level — intra-bar spikes don't trigger anything.

## 5. Validation before posting (stamping + backtest)

- **One signal per closed bar per symbol+timeframe.** A state file (`stamp_state.json`) stores the last stamped bar timestamp; the same bar is never re-posted.
- **Log cap:** the last 60 signals per timeframe are kept.
- **Market hours:** stocks stamp only on real market bars (1H/4H), crypto 24/7.
- **Backtest on every published asset page** (`setup_backtest.js`):
  - Walks bars forward from the signal time; **stop-loss is checked before targets** (conservative — we assume the worst order).
  - 40/40/20 part-sizing: outcome = SL / SL-after-TP / TP3 (full) / PARTIAL / OPEN / PENDING.
  - Reports realized %, MFE, MAE, days held — so each published signal comes with its track record, not just a badge.
  - We **removed replay/seeded data** entirely — only real stamped signals are counted.

## 6. Strategy signal (the dashboard LONG/OUT badge)

Separate from intraday setups:
- Portfolio: 60/25/15 (stocks/crypto), monthly rebalance, skip stocks in September, crypto 252-day momentum + 20-day MA exit, no crypto in June.
- Backtested: CAGR 26.8%, Sharpe 1.39, max drawdown −21%.
- Current live bias (Aug 2026): **AAPL, GOOGL, AMZN, SPY, QQQ LONG · BTC, ETH OUT**.

## 7. Publishing

`precompute.js` builds static JSON (signals, setups, per-asset data with logs + backtest) → hourly GitHub Actions run commits it and deploys to GitHub Pages → the site loads API-first with a static fallback (so it works even when the data server is off). All 7 assets × 4 timeframes are verified to render (chart, reading, setup panel, timeline, backtest) on every deploy.

## 8. Summary of conclusions

1. Signal quality comes from structure (swings) + trend + RSI/ATR, not from price alone.
2. Every tradable signal must have entry, stop, and 3 targets with a named trigger — or it must say "no trade".
3. Slower timeframes are allowed to have fewer signals — 1D/1M only update on their own interval closes.
4. Backtest is conservative (SL-first) and only counts real, closed-bar signals.
5. The site is self-updating hourly; you read the same data on your phone, the laptop, or anywhere.