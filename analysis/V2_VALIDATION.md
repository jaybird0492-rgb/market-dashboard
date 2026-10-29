# v2 validation report — 2026-10-29

## What happened to v1
v1 (multi-factor score, `scripts/strategy.js`) failed its own readiness exam:
paper bot −$939.74 over 113 trades, BTC/ETH 1D win rate 0% in October,
verdict STOP. The v1 paper bot step was removed from
`.github/workflows/update.yml` on 2026-10-29. v1 is not coming back.

## Data
`scripts/fetch_history.js` (Binance public klines, no key) →
`data/history/*_binance.csv` (gitignored): BTC/ETH daily + 4H from 2017-08-17,
SOL from 2020-08, XRP from 2018-05, BNB from 2017-11. Verified: no duplicate
timestamps, no invalid OHLC rows; a few 4H gaps in early exchange history.

## Method (pre-registered in `scripts/v2_backtest.js` header)
Three candidates only, registered before the first run:
A = Donchian 55/20 breakout daily + SMA200 filter, 2.5×ATR disaster stop.
B = SMA50/200 trend + SMA20 pullback re-entry, daily.
C = A on 4H with all periods ×6.
Long-only and long+short modes. Signals at bar close, fills at next bar open,
one position per coin, fees 0.10%/side + slippage 0.05%/side, funding drag
0.01%/day on both sides, size = 0.75% equity at risk, no leverage.
Split: in-sample ≤2022 vs out-of-sample 2023+ by ENTRY date.

An independent code review (Wonder reviewer agent) found and we fixed, before
selecting anything: an SMA200 warm-up bypass in A (it fed the largest winner),
unscaled SMA/ATR in C, a lookahead point in the equity curve, missing long
funding, exit-date split attribution, and end-of-data trades counted as
completed. First-run numbers were therefore discarded; below is the corrected run.

## Results (corrected run — headline expectancy, 95% CI in the script output)
- **A (Donchian daily)** — positive expectancy on every coin except XRP.
  BTC long: n=20, +2.38R, PF 5.33, maxDD −12.4% (buy&hold −76.6%).
  ETH long: n=17, +2.92R, PF 8.36. Long+short dilutes per-trade expectancy
  but adds trades and smooths years (2022 roughly flat instead of absent).
- **B (pullback)** — positive headline expectancy but out-of-sample is ~0 or
  negative on BTC (−0.09R long) and it is carried by 2020. Weaker than A.
- **C (4H Donchian)** — highest raw expectancy but the widest CIs and
  maxDD −19% to −24%; R units are timeframe-scaled, not directly comparable.
- **XRP fails everything** (A long expR +0.39 with exTop3 −0.67; carried by a
  single 2024 episode). Excluded.

## Parameter plateau (`scripts/v2_sensitivity.js`, A on BTC+ETH pooled)
Grid entry {40,55,70} × exit {15,20,30} × stop {2.0,2.5,3.0}:
**54/54 combinations** have pooled expectancy > +0.15R AND out-of-sample
expectancy > 0, and pooled ex-top-3 expectancy stays positive (+0.21R to
+0.72R) everywhere. The registered point (55/20/2.5) is not special — the
neighbourhood works, which is what a real (if modest) edge looks like.

## Gate check (gates set before testing)
| Gate | Result |
|---|---|
| ≥150 independent trades per coin | **FAIL** — best single coin/mode is n=108 (BTC B long+short); A long+short BTC+ETH pooled is n=69. Crypto daily history since 2017 cannot produce 150 Donchian trades per coin. |
| Expectancy > +0.15R after costs | PASS on headline and across the whole parameter plateau (pooled). Per-coin 95% CIs still include 0. |
| Profit factor > 1.3 | PASS for A on BTC/ETH/SOL/BNB. |
| Positive in-sample AND out-of-sample | PASS for A on BTC/ETH (OOS +0.43R to +1.41R). |
| Beat buy&hold risk-adjusted | MIXED — strategy maxDD −12% to −16% vs −77% to −90% for holding, but absolute returns are far lower at 0.75% risk sizing (BTC A long +38.7% vs +601% buy&hold since warmup). It is a drawdown-control system, not a return maximiser, at this size. |

## Verdict
**Not approved for real money. Approved as the v2 candidate to take forward.**
Candidate A (Donchian daily, BTC+ETH, long+short) is the only design that
survived honest accounting, code review, out-of-sample split, and parameter
perturbation. Its weakness is statistical: ~9 years of daily data yields
tens, not hundreds, of trades, so expectancy estimates remain tail-sensitive.

## Next steps (in order)
1. Portfolio-level run: BTC+ETH (later +SOL/BNB) on one shared equity with a
   total-risk cap, instead of separate $10k silos — this is also how it would
   actually be traded, and correlation must be measured, not assumed away.
2. Decide sizing policy explicitly (risk % and any volatility targeting) —
   returns scale with this choice; drawdown scales with it too.
3. Paper-forward smoke test (4–6 weeks) only after step 1 passes the same
   gates at portfolio level. Its purpose is execution fidelity, not edge
   discovery.
4. Real money only after 1–3, minimum size, with a written kill rule.

Do not: re-add XRP/HYPE, re-tune B/C parameters to rescue them, or quote
first-run (pre-fix) numbers anywhere.
