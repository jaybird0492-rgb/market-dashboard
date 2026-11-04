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

## Addendum 2026-10-29 — portfolio test + paper launch
Portfolio run (`scripts/v2_portfolio.js`, shared $10k, max 2 positions,
1.5% total risk cap — caps never bind with 2 coins): long+short n=69,
expR +1.55 ±1.43, exTop3 +0.39, PF 4.40, **+100.2% total, CAGR 7.8%,
maxDD −19.7%**; IS +2.28R / OOS +0.65R. 50/50 buy&hold: +388%, DD −81.1%.
BTC and ETH positions overlap often (26 joint entries) — correlation is
real; the shared account is the honest unit. Independently reviewed:
latent gap/sequencing bugs fixed (forward-filled marks, day-start equity
for sizing); current numbers were unaffected by them.
Sizing decision (owner-approved by accepting this plan): keep the tested
0.75% risk/trade. Do NOT raise it to chase buy&hold returns — drawdown
scales with it (−19.7% at 0.75% implies roughly −35%+ at 1.5%).
Paper bot launched 2026-10-29 (`scripts/v2_paper.js`, daily workflow,
kill rule: DD from peak > 25% or 15 straight losers). Remaining steps:
paper review after 4–6 weeks, then a real-money decision — a fresh
decision, not an automatic one.

## Addendum 2026-10-30 — faster variants + events layer
Pre-registered fast matrix (`scripts/v2_fast.js`, futures costs): Donchian
20/10 and 34/17 on 1H/4H with native / daily-SMA200 / daily-SMA50 gates.
1H failed the traded gate again on ETH in every variant (OOS −0.08..+0.02) —
1H stays warning-only. On 4H, **F3 (20/10 + daily SMA50 gate)** passed all
gates on both coins: BTC expR +0.50 (OOS +0.40, exTop3 +0.31, maxDD −8%),
ETH +0.36 (OOS +0.36, exTop3 +0.23, maxDD −11%), ~33 trades/yr/coin.
The 4H futures paper layer was switched from 55/20+SMA200 to F3 on
2026-10-30. Selection caveat: F3 was chosen from this pre-registered matrix
after seeing its results; it has not had a separate untouched period since.
Its first live paper action was instructive: it shorted BTC+ETH into the
2026-10-30 Binance-hack crash while the daily system was still waiting.
An events layer (`scripts/v2_events.js`) adds Fear&Greed, perp funding/OI,
severity-tagged RSS headlines (it correctly flagged the $6.3B Binance hack
as CRITICAL within the hour) and 1H price-shock detection. Events are
context for the human, never trade triggers — only price rules trade.

## Addendum 2026-11-04 — why the site went quiet, and the dual gate
Owner reported the site "not generating any signals". Investigation:
- The pipeline was healthy. Scheduled runs were throttled to ~4-5/day (data
  up to 5.6h stale), but both bots replay from their start date on every run,
  so no closed 4H bar was skipped. Staleness is a display problem, not a
  missed-trade problem.
- The 4H F3 layer did trade: BTC short and ETH short from 2026-10-30, both
  closed by signal exit on 2026-11-02 at -0.21R and -0.59R (-$59.97,
  -0.80R combined). Equity $9,940.02. The account was not frozen.
- The silence after that was the gate, not the feed. On 2026-11-04 both coins
  closed 4H bars above their 20-bar highs while price was above the daily
  SMA200 but below the daily SMA50. F3's single SMA50 gate allowed shorts
  only, so it blocked both recovery longs. The dashboard also said "longs
  permitted" because it used the 1D regime instead of the gate (fixed).
- Every 4H 20/10 entry since 2017 was tagged by daily state at entry
  (n=388 BTC / 384 ETH): blocked longs in a bull pullback were positive —
  BTC n=24 expR +0.36, ETH n=22 expR +0.41. The gate was discarding edge
  exactly in the live recovery setup.

Pre-registered gate matrix (`scripts/v2_gates.js`, 4H 20/10, futures costs):
G0 SMA50 (F3), G1 SMA200 (F2), G2 none (F1), G3 SMA20, G4 EMA21,
G5 transition gate, G6 daily Donchian-20 direction with hysteresis.
Acceptance unchanged: OOS > +0.15R and exTop3 > 0 on both coins.
G5 rule exactly: long allowed when the last COMPLETED daily close is above
the daily SMA50; short allowed when it is below the daily SMA200; when it is
between the two averages BOTH sides are open. (The first draft of this note
described the rule backwards; review caught it, the code and this note now
match the tested `transition` branch order, and `v2_gates.js` imports the
same `dailyGateFactory` the paper bot uses so they cannot drift again.)

Re-run on the unified code (2026-11-04), 95% CI on expectancy:
**G5**: BTC n=295 expR +0.47±0.34, OOS +0.43 (n=136, OOS exTop3 +0.06),
maxDD -9%; ETH n=311 expR +0.42±0.30, OOS +0.35 (n=140, OOS exTop3 +0.05),
maxDD -9%. G0 (F3) BTC OOS +0.40, OOS exTop3 +0.02; ETH OOS +0.36, exTop3
+0.05. G2/no-gate and G6 also passed; G1/SMA200 failed the BTC OOS test
(+0.13). Six of seven gates passed the letter of the rule, so the matrix
mostly says "the 4H Donchian works with many daily filters", not "G5 is
uniquely good". G5 was chosen because it is the minimal change that removes
the identified failure (no side is vetoed inside the pullback band) while
keeping a long-term long filter and a short-term short filter.

Portfolio-level check (reviewer item M2: silo stats hide shared-account
drawdown), BTC+ETH sharing one $10k account, same costs and 0.75% risk:
n=606, win 34.5%, expR +0.44±0.23, exTop3 +0.33, PF 1.63, total +511.5%,
CAGR 21.8%, **maxDD -15.2%** (vs -9% per silo; 247 overlapping entries mean
BTC and ETH mostly fire together). OOS n=276 expR +0.39, OOS exTop3 +0.19.
50/50 buy & hold same window: +1316% with -87.1% drawdown. The -15.2% is
the number to quote for this layer, not -9%.

Selection caveat: this test was motivated by the live failure, so G5 was
chosen with hindsight. Its paper period is the real out-of-sample check.
Action: 4H paper account reset at 2026-11-04T16:00Z with G5, $10,000, same
costs, same kill rule. The 6-week clock restarts; earliest review is
mid-December 2026. The daily core is unchanged.

Reviewer findings on this change (2026-11-04, read-only audit):
- C1 gate identity mismatch — FIXED: `dailyGateFactory` now implements the
  tested branch order and `v2_gates.js` imports it instead of duplicating.
- C2 `makeStrat` factory double-call crash — FIXED: `runPortfolio` calls
  `makeStrat(sym, bars, ind)`; `v2_paper4h.js` was passing a pre-built
  strategy. Would have crashed on the first post-reset bar.
- H1/H2 hindsight selection, OOS exTop3 — reported above and in the script.
- M2 silo vs portfolio drawdown — reported above (-15.2%).
- M3 pending-entry staleness — `pending` is emitted only from the last
  processed bar (`v2_portfolio.js`), so it cannot outlive one bar; the UI
  labels it PENDING and shows the signal time.
- L1 native 4H SMA200 filter was invisible in the UI — FIXED: `signals.json`
  now exposes `dailyLong/dailyShort`, `nativeLong/nativeShort`,
  `sma200_4h`, effective `longAllowed/shortAllowed`, and `lastBreakout
  .blockedBy`; the dashboard shows daily gate + 4H trend + effective side.

## Next steps (in order)
1. Portfolio-level run: BTC+ETH (universe fixed to BTC/ETH by owner decision
   2026-10-29; SOL/BNB/XRP/HYPE are out and their history files were deleted)
   on one shared equity with a
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
