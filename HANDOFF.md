# HANDOFF — market-analysis (fresh-session bootstrap)

Read this file first. It restores full project context in one pass.

## Scope
- Work ONLY in `market-analysis/`. Ignore `routine-app/`.
- Live site: https://jaybird0492-rgb.github.io/market-dashboard/
- Local run: `node scripts/hourly.js` (refresh), then `node server.js` → http://localhost:8899
- Today: 2026-09-23. Owner TZ display: Australia/Perth (AWST).

## What it is
- BTC/ETH/SOL/XRP/BNB/HYPE × 1H/4H/1D signal dashboard. Same multi-factor engine
  (`scripts/strategy.js`: trend 40% + RSI momentum 25% + ADX direction 25% + range-breakout 10%,
  score ±100, BUY ≥ +5 / SELL ≤ −5 / else WAIT) with ATR stops and TP1/TP2/TP3 at 1R/2R/3R (40/40/20).
- 1D score sets per-asset bias (LONG/SHORT/NEUTRAL); 1H/4H against bias are flagged "reduce size".
- Backtest verdict (565 signals, `node scripts/setup_backtest.js`): 1D has the edge
  (BTC +3.21%, ETH +5.70% avg); 1H bleeds on stops (BTC −0.09%, ETH −0.22%);
  4H conviction inverted (50+ band loses, 0-20 band wins) — needs recalibration.
- Breakeven-after-TP1 bot idea: viable; 1H SL_AFTER_TP counts (BTC ~54/136, ETH ~47/135)
  would mostly become scratches. Futures (Kraken Futures or Hyperliquid perps) possible
  via an execution adapter; paper-first.

## Data flow
`scripts/fetch.js` (Kraken public OHLC, no key) → `data/raw/*.csv` (gitignored)
→ `scripts/setups.js` (signals + `data/live/setups.json|stamp_state.json|setup_log.json`,
one log entry per closed bar) → `scripts/precompute.js` → `web/data/*.json`
→ `server.js` serves `/api/*` live with static `web/data` fallback.
Hourly: `scripts/hourly.js` = fetch+setups+precompute. CI: `.github/workflows/update.yml`
(cron `:15 * * * *`: fetch → setups → precompute → commit `web/data data/live` → Pages).

## Live-path files (touch only these for signals/UI)
- `scripts/fetch.js` (`KRAKEN_PAIRS`), `ta.js` (`DAILY_FILES`, `NAMES`),
  `setups.js`/`setup_backtest.js`/`precompute.js`/`backfill.js` (`SYMBOLS` — 6 assets).
- `web/index.html` (rules + live cards + aggregate track-record section), `web/app.js` (setups + `track_record.json`), `web/pipeline.js` (`ASSETS`),
  `web/asset.js` (`TV_SYMBOL` — HYPE's `HYPERLIQUID:HYPEUSD` is best-effort, verify render).
- Dead-but-harmless: `/api/equity` + `equity.json` still built (BTC/ETH 55/45 baseline);
  nothing reads them since the index trim. `signals_report.md` is outdated (says 7 assets × 4 TF).
- Legacy research scripts (stocks, portfolio, validate, sim weights) are NOT live path — ignore.

## Current state (2026-09-23)
- 6-asset expansion pushed (`d146f4b`): all biases LONG; SOL/XRP/HYPE 1H/4H/1D BUY,
  BNB 1H WAIT + 4H/1D BUY, BTC/ETH all BUY. New-asset backtest history starts at n=1.
- Prior: index trim + pipeline fix (empty Stocks group, double `/api/setups` fetch, dead
  EXPIRED legend removed); manual data push `49c6b20`.

## Shell gotchas (Windows PowerShell 5.1 tool)
- `npx` is blocked (`npx.ps1` execution policy) → prefix with `cmd /c`, e.g.
  `cmd /c "node scripts/hourly.js"`. For git, run bare (`git status`) — `cmd /c` mangles
  quoted commit messages; use single quotes: `git commit -m 'msg'`.
- NEVER run bare `npx -y opencode-ai` (interactive TUI hangs and gets killed).
  Non-interactive only: `cmd /c "npx -y opencode-ai --help"`.
- `node server.js` never exits → start via
  `Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '<repo>'`,
  verify with `Invoke-WebRequest http://localhost:8899/api/setups`. Restart it after
  editing `scripts/*.js` (Node caches modules — stale code serves 404 for new assets).
- `git rebase --continue` opens an editor and hangs the tool →
  `$env:GIT_EDITOR='true'; git rebase --continue`.
- `server.js` REWRITES `data/live/*.json` on every `/api/*` hit → `git status` gets dirty
  from localhost verification alone; re-`git add` before continuing a rebase.
- Hourly bot commits remotely while you work → `git fetch` + rebase before push;
  on data-file conflicts keep the fresher side (`--theirs` when rebasing onto origin).
- No `head` on Windows; use `Select-Object -First N` / `Select-String`.

## Fresh-session checklist
1. `git fetch origin; git log --oneline -5; git status --short`
2. Compare live vs local: fetch `.../market-dashboard/data/setups.json` +
   `last_updated.json` vs `http://localhost:8899/api/setups`.
3. If stale: discard generated files (`git checkout -- data/live web/data`), pull, run
   `node scripts/hourly.js`, restart server, verify `/api/setups → 200`.
