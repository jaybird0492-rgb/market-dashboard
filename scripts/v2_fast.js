// Faster-signal variants — pre-registered 2026-10-30 before running.
// Motivation: the 55/20 system can sit silent for weeks. Question: do
// shorter Donchian channels and/or a faster daily gate find real trades
// earlier, or just manufacture noise? Futures costs, long+short.
//   F1 Donchian 20/10, timeframe-native (own SMA200-bar filter)
//   F2 Donchian 20/10 + daily SMA200 gate
//   F3 Donchian 20/10 + daily SMA50 gate (faster context)
//   F4 Donchian 34/17 (4H only) + daily SMA50 gate
// Reference (already measured): 55/20 4H A-bar BTC +0.57R / ETH +0.45R,
// OOS +0.31/+0.29; 55/20 4H SMA200-gated BTC +0.70R / ETH +0.41R.
// A fast variant only earns a traded role if OOS expR > +0.15 AND
// exTop3 > 0 on BOTH coins. Otherwise it may still earn a watch-only role.
const { loadBars, runBacktest, stratA, stats } = require('./v2_backtest');
const { regimeStrat, FUT } = require('./v2_timeframes');

function report(sym, tfLabel, name, res, bars) {
  const s = stats(res.trades, res.curve, bars, res.warmup);
  const OOS = Date.parse('2023-01-01T00:00:00Z');
  const is = res.trades.filter((t) => t.entryT < OOS), oos = res.trades.filter((t) => t.entryT >= OOS);
  const exp = (ts) => (ts.length ? ts.reduce((a, t) => a + t.rMultiple, 0) / ts.length : 0);
  const ex3 = exp([...res.trades].sort((a, b) => b.rMultiple - a.rMultiple).slice(3));
  console.log(
    `${sym} ${tfLabel} ${name.padEnd(22)} n=${String(s.n).padStart(4)} (${(s.n / (s.years || 9)).toFixed(0).padStart(3)}/yr) win=${(s.winRate * 100).toFixed(0).padStart(3)}% ` +
    `expR=${s.expectancyR.toFixed(2).padStart(6)}±${s.ci95.toFixed(2)} exTop3=${ex3.toFixed(2).padStart(6)} PF=${s.profitFactor.toFixed(2).padStart(5)} maxDD=${(s.maxDD * 100).toFixed(0).padStart(4)}% ` +
    `| IS=${exp(is).toFixed(2).padStart(6)}(n=${is.length}) OOS=${exp(oos).toFixed(2).padStart(6)}(n=${oos.length})`
  );
}

function main() {
  const variants = [
    ['F1 20/10 native', (sym) => (b, ind) => stratA(b, ind, 1, { entry: 20, exit: 10 })],
    ['F2 20/10 +dSMA200', (sym) => regimeStrat(sym, 200, { entry: 20, exit: 10 })],
    ['F3 20/10 +dSMA50', (sym) => regimeStrat(sym, 50, { entry: 20, exit: 10 })],
  ];
  for (const sym of ['BTC', 'ETH']) {
    for (const tf of ['1h', '4h']) {
      const bars = loadBars(sym, tf);
      const maxHold = tf === '1h' ? 720 : 360;
      for (const [name, make] of variants) {
        const res = runBacktest(bars, make(sym), { allowShort: true, maxHoldBars: maxHold, mult: 1, ...FUT });
        report(sym, tf.toUpperCase(), name, res, bars);
      }
    }
    const bars4 = loadBars(sym, '4h');
    const res = runBacktest(bars4, regimeStrat(sym, 50, { entry: 34, exit: 17 }), { allowShort: true, maxHoldBars: 360, mult: 1, ...FUT });
    report(sym, '4H', 'F4 34/17 +dSMA50', res, bars4);
  }
}

main();
