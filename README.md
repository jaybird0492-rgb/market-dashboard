# Market Strategy — v2

A daily trend-following research and paper-trading project for **BTC and ETH only**.
Live status page: https://jaybird0492-rgb.github.io/market-dashboard/

**Status (2026-10-29): paper trading. NOT approved for real money.**

## The strategy (candidate A — the only survivor of validation)
- Buy when the daily close breaks the highest price of the last 55 days while
  above the 200-day average. Shorts mirror this in downtrends.
- Exit on a daily close below the last 20 days' lowest price; disaster stop
  at 2.5× ATR. Each trade risks 0.75% of the account; max 2 positions
  (one per coin); no leverage.
- Most days it does nothing. That is the design: it only trades real trends.

## Evidence (2017–2026, Binance data, honest costs, independently code-reviewed)
- BTC+ETH in one shared $10k account: **+100% total, max drawdown −19.7%**,
  69 trades, expectancy +1.55R, profit factor 4.4. Still positive (+0.39R)
  after deleting its 3 best trades.
- Profitable in the untouched 2023–2026 period (+0.65R/trade).
- 54/54 nearby parameter combinations profitable — not a lucky setting.
- 50/50 buy-and-hold over the same period: +388% with −81% drawdown. v2 trades
  return for survivability; know which one you want before choosing.
- **Not proven:** ~69 trades is a small sample; per-coin confidence intervals
  include zero. Full report: `analysis/V2_VALIDATION.md`.

## How it runs
- `scripts/fetch_history.js` — downloads BTC/ETH daily history from Binance
  (public, no key) into `data/history/` (gitignored).
- `scripts/v2_backtest.js` — the backtester + pre-registered candidates.
- `scripts/v2_sensitivity.js` — parameter-plateau check.
- `scripts/v2_portfolio.js` — shared-account portfolio test.
- `scripts/v2_paper.js` — paper bot. Replays from 2026-10-29 on every run
  (state cannot fork), writes `data/v2/paper_state.json` + `web/data/v2.json`.
- GitHub Actions (`.github/workflows/update.yml`) runs fetch → paper → commit
  → deploy daily at 00:30 UTC. Kill switch: delete the schedule or the
  v2_paper step. Paper kill rule: halt if drawdown from peak > 25% or
  15 consecutive losers.
- Local: `node scripts/fetch_history.js --intervals 1d`, then
  `node scripts/v2_paper.js`, then `node server.js` → http://localhost:8899

## History
v1 (multi-factor score, 6 coins × 1H/4H/1D) lost $940 in paper trading and was
deleted entirely on 2026-10-29 — see the validation report for the autopsy.
It remains in git history for reference only. Do not resurrect it.

## Rules for working here
- BTC/ETH only. New coins need individual 2017-style historical validation.
- No parameter tuning after seeing results; register variants before running.
- Every new backtest result gets an independent code review before being
  believed (`.opencode/agents/reviewer.md`). Models: main session Wonder 1.0,
  `runner` subagent Spark 1.3 for mechanical runs.
