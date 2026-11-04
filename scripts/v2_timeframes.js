// Futures timeframe matrix — pre-registered 2026-10-29 before running.
// Question: can the trend design work on 1H / 4H / 1D for futures trading,
// and does a multi-timeframe filter help?
//
// Variants (Donchian 55/20 bar-count + SMA200-bar filter, 2.5xATR stop,
// long+short, one position per coin):
//   A-bar     : rules applied natively on each timeframe's bars.
//   A-regime  : A-bar entries additionally require the last COMPLETED daily
//               bar's trend to agree (close vs daily SMA200). Not applied on
//               1D (it would duplicate its own filter).
// Futures cost model (Binance USDT perps, taker): fee 0.05%/side,
// slippage 0.02%/side, funding drag 0.03%/day both sides (longs pay more in
// bull markets; this is an average, stress-tested in interpretation).
// Max hold: 1H 720 bars (30d), 4H 360 bars (60d), 1D 365 bars.
// Risk sizing unchanged: 0.75% of equity per trade, notional cap 100%.
// Leverage does not appear here on purpose: with risk-based sizing,
// leverage only sets the notional cap. What leverage would do to these
// results is reported separately from the equity curves.
//
// Usage: node scripts/v2_timeframes.js
const { loadBars, runBacktest, stratA, stats, smaArr } = require('./v2_backtest');

const DAY = 864e5;
const FUT = { feeSide: 0.0005, slipSide: 0.0002, fundingDay: 0.0003 };
const MAXHOLD = { '1h': 720, '4h': 360, '1d': 365 };
const TFS = [['1h', '1H'], ['4h', '4H'], ['1d', '1D']];

function dailyTrendFactory(sym, gatePeriod = 200) {
  const daily = loadBars(sym, '1d');
  const closes = daily.map((b) => b.close);
  const s200 = smaArr(closes, gatePeriod);
  // trend known at intraday time t = last daily bar fully closed before t
  return (t) => {
    let lo = 0, hi = daily.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (daily[mid].t + DAY <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans < 0 || s200[ans] === null) return 0;
    return daily[ans].close > s200[ans] ? 1 : -1;
  };
}

// Dual gate — pre-registered 2026-11-04 after the single SMA50 gate blocked
// a valid recovery long on both coins. Rule (the exact "transition" variant
// from scripts/v2_gates.js, which passed on both coins):
//   long  allowed when the last completed daily close > daily SMA50
//   short allowed when the last completed daily close < daily SMA200
//   otherwise (price between the two averages in a bull market) BOTH sides
//   are open, so the 4H Donchian decides instead of a daily average vetoing it.
// Evidence: scripts/v2_gates.js — 4H 20/10 with this gate: BTC expR +0.47,
// OOS +0.43, maxDD -9%; ETH +0.42, OOS +0.35, maxDD -9%.
function dailyGateFactory(sym) {
  const daily = loadBars(sym, '1d');
  const closes = daily.map((b) => b.close);
  const s50 = smaArr(closes, 50), s200 = smaArr(closes, 200);
  return (t) => {
    let lo = 0, hi = daily.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (daily[mid].t + DAY <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans < 0 || s200[ans] === null) return null;
    const px = daily[ans].close;
    // Same branch order as the tested transition gate: +1 long-only,
    // -1 short-only, 0 both. Expressed as two booleans for the live engine.
    let long, short;
    if (px > s50[ans]) { long = true; short = false; }
    else if (px < s200[ans]) { long = false; short = true; }
    else { long = true; short = true; }
    return {
      long, short,
      px, sma50: s50[ans], sma200: s200[ans],
      at: new Date(daily[ans].t).toISOString().slice(0, 10),
    };
  };
}

function dualGateStrat(sym) {
  const gateAt = dailyGateFactory(sym);
  return (bars, ind) => {
    const inner = stratA(bars, ind, 1, { entry: 20, exit: 10 });
    return {
      warmup: 200,
      entryDir(i) {
        const d = inner.entryDir(i);
        if (d === 0) return 0;
        const g = gateAt(bars[i].t);
        if (!g) return 0;
        return d === 1 ? (g.long ? 1 : 0) : (g.short ? -1 : 0);
      },
      exitHit: inner.exitHit,
    };
  };
}

function regimeStrat(sym, gatePeriod = 200, params) {
  const trendAt = dailyTrendFactory(sym, gatePeriod);
  return (bars, ind) => {
    const inner = stratA(bars, ind, 1, params);
    return {
      warmup: 200,
      entryDir(i) {
        const d = inner.entryDir(i);
        if (d === 0) return 0;
        return trendAt(bars[i].t) === d ? d : 0;
      },
      exitHit: inner.exitHit,
    };
  };
}

function report(sym, tfLabel, name, res, bars) {
  const s = stats(res.trades, res.curve, bars, res.warmup);
  const OOS = Date.parse('2023-01-01T00:00:00Z');
  const is = res.trades.filter((t) => t.entryT < OOS), oos = res.trades.filter((t) => t.entryT >= OOS);
  const exp = (ts) => (ts.length ? ts.reduce((a, t) => a + t.rMultiple, 0) / ts.length : 0);
  const ex3 = (() => { const x = [...res.trades].sort((a, b) => b.rMultiple - a.rMultiple).slice(3); return exp(x); })();
  const yrs = s.years || 9;
  console.log(
    `${sym} ${tfLabel} ${name.padEnd(9)} n=${String(s.n).padStart(4)} (${(s.n / yrs).toFixed(0).padStart(3)}/yr) win=${(s.winRate * 100).toFixed(0).padStart(3)}% ` +
    `expR=${s.expectancyR.toFixed(2).padStart(6)}±${s.ci95.toFixed(2)} exTop3=${ex3.toFixed(2).padStart(6)} PF=${s.profitFactor.toFixed(2).padStart(5)} ` +
    `ret=${(s.totalRet * 100).toFixed(0).padStart(5)}% CAGR=${(s.cagr * 100).toFixed(1).padStart(5)}% maxDD=${(s.maxDD * 100).toFixed(0).padStart(4)}% ` +
    `| IS expR=${exp(is).toFixed(2).padStart(6)} (n=${is.length}) OOS expR=${exp(oos).toFixed(2).padStart(6)} (n=${oos.length})`
  );
}

function main() {
  for (const sym of ['BTC', 'ETH']) {
    for (const [tf, label] of TFS) {
      const bars = loadBars(sym, tf);
      const variants = [['A-bar', (b, ind) => stratA(b, ind, 1)]];
      if (tf !== '1d') variants.push(['A-regime', regimeStrat(sym)]);
      for (const [name, factory] of variants) {
        const res = runBacktest(bars, factory, { allowShort: true, maxHoldBars: MAXHOLD[tf], mult: 1, ...FUT });
        report(sym, label, name, res, bars);
      }
    }
  }
}

if (require.main === module) main();
module.exports = { regimeStrat, dualGateStrat, dailyGateFactory, FUT, MAXHOLD };
