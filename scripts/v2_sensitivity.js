// Parameter-plateau check for candidate A (Donchian daily) on BTC+ETH pooled.
// Pre-declared grid (2026-10-29): entry {40,55,70}, exit {15,20,30},
// stop {2.0,2.5,3.0} ATR = 27 combinations. A real edge should be positive
// across most of the grid, not only at the registered point (55/20/2.5).
// Trades from BTC and ETH are pooled for expectancy (they are correlated;
// this measures parameter robustness, not independent sample size).
const { loadBars, runBacktest, stratA, stats } = require('./v2_backtest');

function exp(ts) { return ts.length ? ts.reduce((a, t) => a + t.rMultiple, 0) / ts.length : 0; }

function main() {
  const pooled = { BTC: loadBars('BTC', '1d'), ETH: loadBars('ETH', '1d') };
  let pass = 0, total = 0;
  for (const mode of ['long', 'longshort']) {
    console.log(`\n=== mode=${mode} (BTC+ETH pooled) ===`);
    console.log('entry exit stop |    n  expR  exTop3 | ISexpR OOSexpR');
    for (const entry of [40, 55, 70]) {
      for (const exit of [15, 20, 30]) {
        for (const stop of [2.0, 2.5, 3.0]) {
          let trades = [];
          for (const sym of ['BTC', 'ETH']) {
            const res = runBacktest(pooled[sym], (b, ind, m) => stratA(b, ind, m, { entry, exit }), {
              allowShort: mode === 'longshort', maxHoldBars: 365, mult: 1, stopMult: stop,
            });
            trades = trades.concat(res.trades);
          }
          const OOS = Date.parse('2023-01-01T00:00:00Z');
          const is = trades.filter((t) => t.entryT < OOS), oos = trades.filter((t) => t.entryT >= OOS);
          const s = [...trades].sort((a, b) => b.rMultiple - a.rMultiple).slice(3);
          const e = exp(trades);
          total++; if (e > 0.15 && exp(oos) > 0) pass++;
          console.log(
            `${String(entry).padStart(5)} ${String(exit).padStart(4)} ${stop.toFixed(1)} | ` +
            `${String(trades.length).padStart(4)} ${e.toFixed(2).padStart(6)} ${exp(s).toFixed(2).padStart(7)} | ` +
            `${exp(is).toFixed(2).padStart(6)} ${exp(oos).toFixed(2).padStart(7)}`
          );
        }
      }
    }
  }
  console.log(`\nPlateau: ${pass}/${total} combos with pooled expR>0.15 AND OOS expR>0`);
}

main();
