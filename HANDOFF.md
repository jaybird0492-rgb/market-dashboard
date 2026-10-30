# HANDOFF — market-analysis (fresh-session bootstrap)

Read this file first. It restores full project context in one pass.

## Current state (2026-10-29) — v1 DELETED, v2 in research
- v1 (multi-factor score engine, 6 coins × 1H/4H/1D, paper bot) FAILED its
  readiness exam (paper −$939.74/113 trades, BTC+ETH 1D October win rate 0%,
  verdict STOP) and was **deleted entirely**: strategy/setups/paper/autopsy/
  readiness/precompute/ta/fetch scripts, all web pages except a static v2
  status page, `data/live/*`, and `web/data/*` are gone. Do not resurrect it.
  Full investigation: conversation of 2026-10-29 + `analysis/V2_VALIDATION.md`.
- Universe is **BTC and ETH only** (owner decision 2026-10-29). SOL/XRP/BNB
  local history files were deleted; XRP failed validation, HYPE never had
  enough history. Do not re-add coins without individual historical validation.
- Live site: https://jaybird0492-rgb.github.io/market-dashboard/ — now a static
  v2 status page, deploys on push only (`.github/workflows/update.yml`).
  Local run: `node server.js` → http://localhost:8899 (static only).
- Legacy research scripts (stocks: analyze/backtest/portfolio/sim/etc.) remain
  in `scripts/` but are NOT live path — ignore them.

## v2 — the only candidate
- Strategy A (Donchian daily): buy close > prior 55d high while above SMA200,
  exit close < prior 20d low, disaster stop 2.5×ATR, size = 0.75% equity at
  risk, no leverage. Long+short mirror under test. BTC+ETH.
- Code: `scripts/v2_backtest.js` (engine + pre-registered candidates A/B/C in
  its header, with correction log), `scripts/v2_sensitivity.js` (plateau),
  `scripts/fetch_history.js` (Binance klines → `data/history/`, gitignored).
- Validation status (`analysis/V2_VALIDATION.md`): A passed IS/OOS split,
  profit factor, and a 54/54 parameter plateau on BTC+ETH pooled; FAILED the
  ≥150-trades-per-coin gate (only ~69 pooled trades since 2017; per-coin CIs
  include zero). B (pullback) decays OOS, C (4H) is noisier — do not re-tune
  them to rescue them.
- Portfolio test DONE 2026-10-29 (`scripts/v2_portfolio.js`, reviewed):
  shared account LS +100.2%, maxDD −19.7%, n=69, exTop3 +0.39. Sizing kept
  at the tested 0.75% risk/trade — do not raise it casually.
- **Paper bots LIVE since 2026-10-29**: daily core (`scripts/v2_paper.js`)
  + 4H futures layer (`scripts/v2_paper4h.js`; rules upgraded 2026-10-30 to
  F3 = Donchian 20/10 + daily SMA50 gate per `scripts/v2_fast.js`, simulated
  perps/funding), both replay-derived from PAPER_START, shared $10k each,
  BTC+ETH. State: `data/v2/*_state.json`; public: `web/data/v2.json`,
  `web/data/v2_4h.json`, `web/data/signals.json`, `web/data/events.json`
  (Fear&Greed, funding/OI, severity-tagged headlines, 1H shock detector —
  context only, never trade triggers). Workflow every 30 min UTC:
  fetch -> both papers -> signals -> events -> commit -> deploy.
  Kill rule (both): DD from peak > 25% or 15 consecutive losers → halt + review.
- **Verdict: NOT approved for real money.** Remaining: paper review after
  4–6 weeks (execution fidelity vs backtest), then a fresh real-money
  decision. Nothing about the paper run auto-approves real trading.

## Model setup (project-local, `.opencode/agents/`)
- Main session: Muse Wonder 1.0 (design, judgement, final verification).
- `runner` subagent: Muse Spark 1.3 — downloads, backtest runs, raw numbers only.
- `reviewer` subagent: Muse Wonder 1.0, read-only — audits backtest code for
  lookahead/accounting/statistical errors. It caught 4 real bugs in v2 run #1;
  keep using it before believing any new result.

## Shell gotchas (Windows PowerShell 5.1 tool)
- `npx` is blocked → prefix with `cmd /c`. For git use bare commands and
  single-quoted commit messages.
- `python3` is NOT installed (Microsoft Store stub) — use `node -e` for data checks.
- Hourly bot commits no longer happen (v1 pipeline deleted); still
  `git fetch` before pushing.
