# Dashboard plan — positions & strategy performance

Status: **implemented 2026-11-06** (all four phases; schema v3 live). Owner:
build session. This file is now the contract + build record. Deviations from the
original draft are listed in §11.

## 1. Why this exists

The site already has `Open Positions` and `Closed Trades` sections, but they
cannot answer "is the strategy working?" today:

- Both paper accounts are **flat with 0 closed trades** (daily since 2026-10-29,
  4H since 2026-11-04). There is nothing to display yet, so the page shows only
  an empty state.
- The open-position row exposes entry/stop/mark/unrealized but **not size, risk,
  distance to stop, unrealized R, or time held** — the numbers needed to judge a
  live trade.
- There is **no equity curve, no live win rate / expectancy / profit factor, no
  max drawdown from the paper account, and no trade-duration or R distribution**.
  The only performance numbers on the page are backtest results.
- `closed` is capped at the last 50 trades; stats are not computed from the full
  history. Fine for 6 weeks, wrong as a permanent record.
- The dashboard cannot show what an open position *will* look like, so the
  layout is untested until the first real fill.

The 4H layer is currently 0.2–0.5% from a short trigger on both coins. The first
fill could happen at the next 4H close, so this should ship before then.

## 2. Goal

One screen that answers, in order:

1. **Do I have risk on right now?** (open positions, size, stop, unrealized R)
2. **What is the account doing?** (equity, P&L, drawdown, open risk)
3. **Is the edge showing up?** (win rate, expectancy R, PF, R distribution, with
   an explicit sample-size warning)
4. **What happened trade by trade?** (full journal with entry/exit/fees/reason)

Non-goals: new strategy rules, new coins, real orders, changing risk per trade.

## 3. Current baseline (2026-11-06 15:40Z)

| | Daily core | 4H futures |
|---|---|---|
| Equity | $10,000 | $10,000 |
| Open / closed | 0 / 0 | 0 / 0 |
| DD / streak | 0% / 0 | 0% / 0 |
| Start | 2026-10-29 | 2026-11-04T16:00Z |

Market: BTC $75,393, ETH $2,216. Daily gate BOTH; effective SHORT only because
price is below the 4H SMA200 (BTC 81,346 / ETH 2,421). Short triggers: BTC
75,208 (0.22% below live), ETH 2,206 (0.48% below live).

## 4. Data contract (v3)

Both `web/data/v2.json` and `web/data/v2_4h.json` get the same shape. The bots
already replay the full history from their start date on every run, so no new
database is needed — just export more of what the engine already knows.

```jsonc
{
  "schema": 3,
  "updatedAt": "2026-11-06T15:40:00Z",
  "paperStart": "2026-11-04T16:00:00Z",
  "startEquity": 10000,
  "equity": 10000,                // realized + open unrealized
  "realizedEquity": 10000,
  "openRiskUsd": 0,               // Σ |entry-stop| * qty
  "openRiskPct": 0,
  "drawdownFromPeak": 0,
  "losingStreak": 0,
  "halted": false,

  "open": [{
    "sym": "BTC", "side": "SHORT",
    "entry": 75250.00, "stop": 77100.00, "mark": 75393.00,
    "qty": 0.0271, "notionalUsd": 2040.00,
    "riskUsd": 50.10, "riskPct": 0.50,
    "stopDistPct": 2.46, "pctToStop": 2.27,
    "unrealUsd": -3.90, "unrealR": -0.08,
    "openedAt": "2026-11-06T16:00:00Z",
    "barsHeld": 1, "holdHours": 4,
    "mfeR": 0.20, "maeR": -0.10
  }],

  "pending": [{ "sym": "ETH", "side": "SHORT",
                "signalAt": "...", "fillsAt": "..." }],

  "closed": [{                    // ALL trades, newest last
    "id": "BTC-20261106-1600",
    "sym": "BTC", "side": "SHORT",
    "entry": 75250.00, "exit": 74000.00,
    "openedAt": "...", "closedAt": "...",
    "holdHours": 38, "barsHeld": 9,
    "pnlUsd": 45.20, "feesUsd": 2.10, "fundingUsd": 0.90,
    "r": 0.90, "mfeR": 1.30, "maeR": -0.15,
    "reason": "donchian_exit",
    "equityAfter": 10045.20
  }],

  "stats": {
    "closed": 0, "open": 0, "wins": 0, "losses": 0,
    "winRatePct": null,
    "avgWinR": null, "avgLossR": null,
    "expectancyR": null, "profitFactor": null,
    "totalPnlUsd": 0, "maxDDPct": 0,
    "currentStreak": 0, "bestR": null, "worstR": null,
    "avgHoldHours": null,
    "since": "2026-11-04T16:00:00Z", "lastTradeAt": null,
    "sampleStatus": "insufficient"   // <10 | building 10-29 | usable >=30
  },

  "equityCurve": [                  // from engine curve, downsampled to <=500 pts
    { "t": "2026-11-04T16:00:00Z", "equity": 10000, "kind": "start" },
    { "t": "2026-11-06T15:40:00Z", "equity": 10000, "kind": "mark" }
  ],

  "reference": {                    // existing backtest block, unchanged
    "trades": 606, "expectancyR": 0.44, "profitFactor": 1.35,
    "maxDDPct": -15.2, "oosExpR": 0.39
  }
}
```

Rules:
- `qty` is exported explicitly. The UI's current fallback
  (`75 / |entry-stop|`) is a guess and must go.
- `unrealR = unrealUsd / riskUsd`.
- `equity == startEquity + Σ closed.pnlUsd + Σ open.unrealUsd` (±$0.01).
- `sampleStatus` is pre-registered: **no performance conclusion below 10
  closed trades**, badge "building" 10–29, "usable" ≥30.

## 5. UI plan

### Section A — Account snapshot (top, replaces/extended `Accounts`)
Per account: equity, net P&L since start, open risk, DD from peak, trades,
streak, `Day X of 42` (6-week clock), halted badge.
Flat state must say **"Flat — no open risk"**, not just an empty table.

### Section B — Open positions (upgraded)
One row per open position:

`Layer | Asset | Side | Size (notional) | Entry | Mark (live) | Stop | To stop |
Unrealized $ | Unrealized R | Risk $ | Held | Opened`

- Mark uses live browser price, labelled **LIVE / display only**; decisions stay
  on closed bars.
- Color by sign; show `unrealR` prominently.
- Pending rows stay, with "fills at next bar open".
- Empty state: "Flat since <date>. Next 4H decision in Xh Ym." plus a compact
  next-trigger table (asset, long trigger, short trigger, which side is allowed).

### Section C — Strategy performance (new)
- KPI row: trades, win rate, expectancy R, profit factor, max DD, avg hold,
  best/worst R. Nulls render as `—` with a "n<10, not meaningful yet" note.
- Equity curve canvas (start → now), with a dashed `startEquity` line.
- R-multiple bar chart, one bar per trade (green/red), in trade order.
- "Live vs backtest" line: `live expectancy 0.00R (n=0) vs backtest +0.44R —
  not comparable until n≥10`.
- Sample-size badge driven by `stats.sampleStatus`.

### Section D — Trade journal
Full closed table, newest first: layer, asset, side, entry, exit, opened,
closed, held, P&L, fees, R, MFE/MAE, exit reason. This is the audit trail.

### Section E — Preview mode (build aid, not live data)
`?preview=1` loads `web/data/preview_4h.json` and shows a fixed banner:
**"PREVIEW — historical replay, not the live account"**. Used to verify the
open-position and performance layouts before the first real fill.

## 6. Implementation steps

### Phase 0 — Verify current truth (30 min)
1. `node scripts/v2_paper.js` and `node scripts/v2_paper4h.js`; confirm both
   accounts are flat and the JSON matches the engine.
2. Confirm no 4H close since 2026-11-04T16:00Z broke a prior 20-bar low
   (already checked: closest was BTC +0.39% on 2026-11-05T12:00).
3. Record the baseline in this file.

### Phase 1 — Position visibility (highest priority, ~half day)
Files: `scripts/v2_paper.js`, `scripts/v2_paper4h.js`, `scripts/v2_portfolio.js`
(read-only reuse), `web/index.html`.

1. Export `qty`, `notionalUsd`, `riskUsd`, `riskPct`, `stopDistPct`,
   `pctToStop`, `unrealR`, `holdHours`, `barsHeld` for open positions.
2. Export `openRiskUsd` / `openRiskPct` and `Day X of 42`.
3. Rebuild the positions table with the Section B columns.
4. Add the flat-state block with next triggers.
5. Keep `qtyOf` fallback removed; if `qty` is missing, show `—` (fail visible).

Acceptance:
- With 0 positions, the section says flat + next decision time + triggers.
- With a preview open position, every column is populated, `unrealR` matches
  `unrealUsd / riskUsd`, and the live mark updates every 60s.
- No browser console errors.

### Phase 2 — Performance scoreboard (~half day)
Files: `scripts/v2_portfolio.js` (expose curve), `scripts/v2_paper*.js`,
`web/index.html`.

1. Compute `stats` from all trades in the engine result (not from the last 50).
2. Emit a downsampled `equityCurve` (closed-trade points + current mark).
3. Add Section C: KPI row, equity curve, R bars, live-vs-backtest line,
   sample-size badge.
4. Stop slicing `closed` at 50 for stats; keep a display cap of 200 with a note.

Acceptance:
- `equity` reconciles with `start + Σpnl + Σunreal` within $0.01.
- Expectancy = mean R; PF = Σ wins / |Σ losses|; max DD from the curve.
- With n=0 all metrics are `—`, not `0` or `NaN`.
- With n≥1 the curve starts at `startEquity` and ends at current equity.

### Phase 3 — Journal & audit (~half day)
1. Add fees/funding, MFE/MAE, hold time, `equityAfter`, stable `id` per trade.
2. Add Section D full table.
3. `scripts/v2_verify.js`: assert reconciliation, R math, stop-side sanity,
   monotonic timestamps, no NaN.
4. Add the verifier to the workflow after the paper steps.

Acceptance:
- Verifier exits non-zero on any mismatch.
- Journal rows match `v2_4h.json`/`v2.json` exactly.

### Phase 4 — Preview + observability (optional, ~half day)
1. `scripts/v2_preview.js --sym BTC --end YYYY-MM-DD` replays to a cutoff and
   writes `web/data/preview_4h.json` (clearly labelled).
2. `?preview=1` banner + data switch.
3. Optional: a "since your last visit" line stored in `localStorage` (new
   trades, new positions) — no server, no notifications.

## 7. Test plan

Data:
- `node scripts/v2_verify.js` → 0 failures.
- Recompute `stats` independently from `closed` and compare.
- Check `sampleStatus` thresholds at n=0, 10, 30.

UI:
- Flat state (live now).
- Preview state with one long and one short (historical replay).
- Two simultaneous positions (BTC+ETH) — the shared-account case.
- Pending fill state (signal on last closed bar, fill next open).
- Stale feed (>2h) still shows the red pill.
- Mobile width 390px and desktop 1200px; tables scroll, no overlap.

Deployment:
- Push → workflow `build` + `deploy` green.
- Fetch live JSON and assert `schema === 3`, `equityCurve.length > 0`,
  `stats.sampleStatus` present.
- Hard-refresh the live site; verify sections render from live data.

## 8. Guardrails

- **Paper only.** No order code, no API keys, no leverage changes.
- **No rule tuning** to make the dashboard look better. The 6-week paper run is
  the out-of-sample test; the dashboard only reports it.
- **Small n is not an edge.** Show `—` and the badge; never imply significance
  before 10 trades (30 for a real read).
- **Closed bars decide, live marks display.** Label live prices.
- **State is replay-derived.** If rules or data change, history recomputes;
  the journal must state the rule version (`rules` string + `paperStart`).
- **Kill rule stays visible**: −25% from peak or 15 consecutive losers → HALTED.

## 9. Effort / order

| Phase | Scope | Est. | Ships |
|---|---|---|---|
| 0 | truth check | 30 min | no code |
| 1 | open positions + flat state | 3–4 h | first useful version |
| 2 | equity curve + stats | 3–4 h | "is it working" |
| 3 | journal + verifier | 3 h | audit trail |
| 4 | preview + visit summary | 3 h | optional |

Phase 1 should ship before the next 4H close if possible; Phases 2–3 can follow
while the first trade is open.

## 10. Definition of done

- I can open the site and see, without reading code: whether risk is on, the
  exact size/stop/unrealized R, the account equity curve, and the trade journal.
- Every number on the page reconciles with the JSON and the engine.
- A flat account is unmistakably flat, with the next decision time and triggers.
- No performance claim is made from fewer than 10 trades.

**Status 2026-11-06:** all four phases shipped; `node scripts/v2_verify.js`
passes on daily, 4H and preview payloads, and is wired into the workflow.

## 11. As-built notes (2026-11-06)

What shipped against the contract above:

| Phase | Delivered |
|---|---|
| 0 | Both accounts confirmed flat; no 4H close since 2026-11-04T16:00Z broke a prior 20-bar low (closest BTC +0.39% on 2026-11-05T12:00). |
| 1 | `qty`, `notionalUsd`, `riskUsd`, `riskPct`, `stopDistPct`, `pctToStop`, `unrealR`, `holdHours`, `barsHeld`, `mfeR`, `maeR` exported; new positions table; flat state with next decision + trigger table. |
| 2 | `stats`, `equityCurve`, `openRiskUsd`/`openRiskPct`; KPI row, curve, R bars, live-vs-backtest line, sample badge. Stats come from the full trade list (no 50-trade slice). |
| 3 | Journal with entry/exit/fees/funding/MFE/MAE/hold/risk/equityAfter and stable `id`; `scripts/v2_verify.js` added to CI after the paper steps. |
| 4 | `scripts/v2_preview.js` + `web/data/preview_4h.json` + `/?preview=1` banner. The localStorage "since last visit" idea was not built (not needed). |

Deviations from the draft:

- Shared exporter is `scripts/v2_paperlib.js`; the two bots only supply rules,
  start date and the reference block.
- `equityCurve` is downsampled to **400** points (not 500) and points are
  `{t, equity}` — no `kind` tag.
- Closed trades also carry `rNominal` (the pre-existing nominal-risk R) next to
  `r` (`rMultipleActual`); `stats` is computed from `r`, the dashboard shows `r`.
- `reference` is layer-specific (daily includes buy & hold; 4H includes the
  shared-account max DD).
- Preview mode shows only the replays' 4H account (not the live daily account)
  and hides the market/events sections.
- Charts draw synchronously after render because `requestAnimationFrame` is
  throttled in background tabs (otherwise blank canvas).
- Engine enriched read-only: per-trade fills, qty, risk, fees, funding,
  MFE/MAE, hold time, `equityAfter`, and richer open positions. Backtest metrics
  were re-run after the change and are unchanged (1D n=70 expR 1.52; 4H n=606
  expR 0.44), so history remains comparable.
