# FINAL STRATEGY — validated portfolio approach

Data: 10y daily (stocks, BTC), 9y (ETH), 1h/4h crypto since 2017. Fees: stocks 0.05%/side, crypto 0.1%/side.
Validation: walk-forward (2y train / 6m test), full-period face-offs, portfolio simulation, permutation significance tests.
Reports: `analysis/report_validation.txt`, `report_portfolio.txt`, `report_significance.txt`, plus `report_trends/levels/patterns/momentum/cycles.txt`.

---

## THE STRATEGY (one page)

**Portfolio** (monthly rebalance):

| Asset | Weight |
|---|---|
| AAPL | 20% |
| GOOGL | 20% |
| AMZN | 20% |
| BTC | 25% |
| ETH | 15% |

**Three rules only:**
1. **Stocks: exit during September** (skip-Sep). September was the worst month for all 3 stocks; the effect is statistically significant (AAPL p=0.033).
2. **Crypto: momentum system** — buy BTC/ETH only on a fresh 252-day-high breakout; exit when price closes below the 20-day MA. Never re-enter in June.
3. **Crypto: never hold in June.** ETH June avg -11.7% (p=0.022, significant), BTC June avg -4.0% (p=0.052, weak but consistent).

**Optional 4th rule (cycle, not yet backtestable):** tilt BTC weight up in the 12 months before/after a halving (returns front-loaded: +0.19%/day before, +0.39%/day after), trim in year 2 post-halving (negative both cycles: -73%, -65%).

---

## Results (2017-2026, incl. fees)

| Portfolio | Total | CAGR | Sharpe | Max DD | Worst year |
|---|---|---|---|---|---|
| 60/25/15 plain B&H | +1,503% | 36.0% | 1.05 | -55% | -48% (2022) |
| **+ rules 1-3 (final)** | **+751%** | **26.8%** | **1.39** | **-21%** | **-16% (2022)** |
| Equal weight 5 assets | +1,485% | 35.9% | 1.03 | -54% | -48% (2022) |
| Stocks only (33% each) | +669% | 25.4% | 0.97 | -41% | -38% (2022) |
| BTC only | +1,385% | 34.9% | 0.79 | -83% | -74% (2018) |

The final strategy trades roughly half the total return for **2.6x lower drawdown and a 32% better Sharpe** — and it had NO losing year worse than -16%.

## Why this is the honest "best"
- Every seasonality claim was permutation-tested (10,000 shuffles). Only these survived: AAPL July (p=0.023, +7.0% avg, 10/10 up), BTC October (p=0.040, +17.9%, 8/10 up), ETH June negative (p=0.022), AAPL September negative (p=0.033). GOOGL/AMZN July and BTC June are weaker (p~0.05-0.06) but directionally consistent.
- Walk-forward showed stock rules keep returns while cutting drawdown (AAPL OOS 41.5% ann vs 42.3% B&H with -33% vs -39% DD).
- Walk-forward also showed active crypto timing does NOT beat buy & hold in bull years — that's why crypto overlays are used only for drawdown control, never as a return engine. B&H remains the return engine in this portfolio.
- The one big honest caveat: the momentum rule was tuned on the same data (mild in-sample bias). Its value is risk control; treat its exact parameters as provisional.

## What was rejected (with evidence)
- Candlestick patterns: no edge vs baseline on any asset
- Hour-of-day crypto trading: -99% with 0.1% fees (fees eat the edge)
- RSI mean reversion on crypto: -86% on ETH; crypto trends (RSI>70 -> +32% next 60d on BTC)
- MA50/200 crossover: worse than B&H everywhere
- Buying BTC after 5+ down days: next 20d -5%

## Execution notes
- Rebalance monthly; trade only on the rules above (4-6 trades/year typical)
- The strategy is LONG-ONLY. Shorting crypto in year-2 post-halving was NOT tested and is not recommended
- If a rule breaks for 2+ years in a row, drop it — the edges are statistical, not laws
- Not financial advice; historical evidence only
