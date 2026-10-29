// v2 trend-following backtester — pre-registered candidates, no tuning after the fact.
//
// PRE-REGISTERED CANDIDATES (written 2026-10-29, before first run):
//   A  Donchian breakout, daily: enter on close above prior 55d high (and above
//      SMA200 for longs), exit on close below prior 20d low. Disaster stop 2.5xATR.
//   B  SMA trend + pullback, daily: regime = close>SMA200 and SMA50>SMA200.
//      Enter when close crosses back above SMA20 after a dip below it.
//      Exit on close below SMA50. Disaster stop 2.5xATR.
//   C  Candidate A rules on 4H bars (all periods x6, incl. SMA200 -> 1200 bars
//      and ATR14 -> ATR84, so the volatility unit matches the daily version).
// Each is run long-only and long+short (mirrored) — 6 configurations, no more.
//
// CORRECTION LOG (2026-10-29, after independent code review of run #1; applied
// before any candidate was selected or discarded):
//   - stratA waived the SMA200 filter while it was warming up (null), letting
//     unfiltered breakouts in — including the largest winner. Now required.
//   - Config C originally scaled only Donchian windows; SMA/ATR now scaled too.
//   - Equity curve marked a position at bar i using bar i+1's open (lookahead).
//     Engine restructured: fills happen at the start of the fill bar.
//   - Longs paid no funding. Both sides now pay 0.01%/day funding drag.
//   - IS/OOS and per-year splits now use ENTRY date, not exit date.
//   - Trades still open at end-of-data are censored (excluded from stats).
//   - Report adds expR ex-top-1 / ex-top-3 and a rough 95% CI on expectancy,
//     because with n this small the tail IS the result.
//
// HONESTY RULES:
//   - Signal at bar close, execution at NEXT bar open. No same-bar entries.
//   - One position per coin at a time. Fees 0.10%/side + slippage 0.05%/side.
//   - Disaster stop checked intrabar, filled at the worse of open/stop.
//   - Size = 0.75% of equity at risk to the disaster stop, notional <= equity.
//
// Usage: node scripts/v2_backtest.js [--json]
const fs = require('fs');
const path = require('path');

const HIST = path.join(__dirname, '..', 'data', 'history');
const FEE_SIDE = 0.001;
const SLIP_SIDE = 0.0005;
const FUNDING_DAY = 0.0001; // both sides, conservative drag
const RISK_FRAC = 0.0075;
const START_EQUITY = 10000;
const OOS_START = Date.parse('2023-01-01T00:00:00Z');

function loadBars(sym, tf) {
  const file = path.join(HIST, `${sym}_${tf}_binance.csv`);
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const p = l.split(',');
    return { t: Date.parse(p[0]), open: +p[1], high: +p[2], low: +p[3], close: +p[4] };
  }).filter((b) => Number.isFinite(b.t) && b.close > 0);
}

function smaArr(v, n) {
  const out = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function atrArr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let prev = null;
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) continue;
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    if (i === n) {
      let s = 0;
      for (let j = 1; j <= n; j++) s += Math.max(bars[j].high - bars[j].low, Math.abs(bars[j].high - bars[j - 1].close), Math.abs(bars[j].low - bars[j - 1].close));
      prev = s / n;
      out[i] = prev;
    } else if (i > n) {
      prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
  }
  return out;
}
function priorHigh(bars, i, n) {
  if (i < n) return null;
  let m = -Infinity;
  for (let j = i - n; j < i; j++) if (bars[j].high > m) m = bars[j].high;
  return m;
}
function priorLow(bars, i, n) {
  if (i < n) return null;
  let m = Infinity;
  for (let j = i - n; j < i; j++) if (bars[j].low < m) m = bars[j].low;
  return m;
}

function stratA(bars, ind, mult, params) {
  const p = params || {};
  const E = (p.entry || 55) * mult, X = (p.exit || 20) * mult;
  return {
    warmup: 200 * mult,
    entryDir(i) {
      if (ind.sma200[i] === null) return 0; // filter is mandatory, no warm-up bypass
      const hi = priorHigh(bars, i, E), lo = priorLow(bars, i, E);
      if (hi === null) return 0;
      if (bars[i].close > hi && bars[i].close > ind.sma200[i]) return 1;
      if (bars[i].close < lo && bars[i].close < ind.sma200[i]) return -1;
      return 0;
    },
    exitHit(i, pos) {
      if (pos.dir === 1) { const l = priorLow(bars, i, X); return l !== null && bars[i].close < l; }
      const h = priorHigh(bars, i, X); return h !== null && bars[i].close > h;
    },
  };
}
function stratB(bars, ind) {
  return {
    warmup: 200,
    entryDir(i) {
      if (i < 1 || ind.sma20[i] === null || ind.sma20[i - 1] === null || ind.sma200[i] === null || ind.sma50[i] === null) return 0;
      const up = bars[i].close > ind.sma200[i] && ind.sma50[i] > ind.sma200[i];
      const dn = bars[i].close < ind.sma200[i] && ind.sma50[i] < ind.sma200[i];
      if (up && bars[i - 1].close <= ind.sma20[i - 1] && bars[i].close > ind.sma20[i]) return 1;
      if (dn && bars[i - 1].close >= ind.sma20[i - 1] && bars[i].close < ind.sma20[i]) return -1;
      return 0;
    },
    exitHit(i, pos) {
      if (ind.sma50[i] === null) return false;
      return pos.dir === 1 ? bars[i].close < ind.sma50[i] : bars[i].close > ind.sma50[i];
    },
  };
}

// mult scales ALL indicator lengths so 4H units match daily units.
function runBacktest(bars, stratFactory, { allowShort, maxHoldBars, mult = 1, stopMult = 2.5 }) {
  const closes = bars.map((b) => b.close);
  const ind = {
    sma20: smaArr(closes, 20 * mult), sma50: smaArr(closes, 50 * mult),
    sma200: smaArr(closes, 200 * mult), atr: atrArr(bars, 14 * mult),
  };
  const S = stratFactory(bars, ind, mult);
  let equity = START_EQUITY;
  let pos = null;
  let pendingEntry = 0; // dir signalled at previous close, fills at this bar's open
  let pendingExit = false;
  const trades = [];
  const curve = [];

  const slip = (raw, isBuy) => raw * (1 + (isBuy ? SLIP_SIDE : -SLIP_SIDE));
  function closePos(i, rawPrice, reason) {
    const fill = slip(rawPrice, pos.dir === -1);
    const gross = pos.qty * (fill - pos.entryFill) * pos.dir;
    const fees = FEE_SIDE * pos.qty * (pos.entryFill + fill);
    const days = (bars[i].t - pos.entryT) / 864e5;
    const funding = FUNDING_DAY * days * pos.qty * pos.entryFill;
    const pnl = gross - fees - funding;
    equity += pnl;
    trades.push({
      dir: pos.dir, entryT: pos.entryT, exitT: bars[i].t, bars: i - pos.entryBar,
      pnl, rMultiple: pnl / (pos.equityBefore * RISK_FRAC), reason,
    });
    pos = null;
    pendingExit = false;
  }

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    // fills at this bar's open, from signals at the previous close
    if (pendingExit && pos) closePos(i, b.open, 'SIGNAL');
    if (!pos && pendingEntry !== 0 && ind.atr[i - 1]) {
      const dir = pendingEntry;
      const entryFill = slip(b.open, dir === 1);
      const stopDist = stopMult * ind.atr[i - 1]; // ATR known at signal close
      let qty = (equity * RISK_FRAC) / stopDist;
      qty = Math.min(qty, equity / entryFill);
      if (qty > 0) {
        pos = { dir, entryFill, qty, equityBefore: equity, stop: dir === 1 ? entryFill - stopDist : entryFill + stopDist, entryBar: i, entryT: b.t };
      }
    }
    pendingEntry = 0;

    // disaster stop, intrabar
    if (pos && (pos.dir === 1 ? b.low <= pos.stop : b.high >= pos.stop)) {
      closePos(i, pos.dir === 1 ? Math.min(b.open, pos.stop) : Math.max(b.open, pos.stop), 'STOP');
    }
    // signals at this close
    if (pos && !pendingExit) {
      if (S.exitHit(i, pos) || i - pos.entryBar >= maxHoldBars) pendingExit = true;
    } else if (!pos) {
      const dir = S.entryDir(i);
      if (dir !== 0 && (dir === 1 || allowShort) && ind.atr[i]) pendingEntry = dir;
    }
    const mtm = pos ? equity + pos.qty * (b.close - pos.entryFill) * pos.dir : equity;
    curve.push({ t: b.t, eq: mtm });
  }
  // open position at end-of-data: censored, not a completed trade
  const censored = pos ? 1 : 0;
  return { trades, curve, censored, warmup: S.warmup };
}

function expectancy(ts) { return ts.length ? ts.reduce((a, t) => a + t.rMultiple, 0) / ts.length : 0; }
function expExTop(ts, k) {
  if (ts.length <= k) return 0;
  const s = [...ts].sort((a, b) => b.rMultiple - a.rMultiple).slice(k);
  return expectancy(s);
}
function stats(trades, curve, bars, warmup) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0);
  const gl = -trades.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  let peak = -Infinity, maxDD = 0;
  for (const p of curve) { if (p.eq > peak) peak = p.eq; if (peak > 0) maxDD = Math.min(maxDD, p.eq / peak - 1); }
  const years = curve.length ? (curve[curve.length - 1].t - curve[0].t) / (365.25 * 864e5) : 0;
  const totalRet = curve.length ? curve[curve.length - 1].eq / START_EQUITY - 1 : 0;
  const mean = expectancy(trades);
  const sd = n > 1 ? Math.sqrt(trades.reduce((a, t) => a + (t.rMultiple - mean) ** 2, 0) / (n - 1)) : 0;
  const ci = n > 1 ? 1.96 * sd / Math.sqrt(n) : 0;
  const perYear = {};
  for (const t of trades) {
    const y = new Date(t.entryT).getUTCFullYear();
    perYear[y] = perYear[y] || { n: 0, pnl: 0 };
    perYear[y].n++; perYear[y].pnl += t.pnl;
  }
  // buy & hold over the period the strategy could first trade, incl. one buy fee
  const b0 = bars[warmup] ? bars[warmup].close : bars[0].close;
  const bhRet = bars.length ? bars[bars.length - 1].close / b0 - 1 - FEE_SIDE : 0;
  let bPeak = -Infinity, bhDD = 0;
  for (let i = warmup; i < bars.length; i++) { if (bars[i].close > bPeak) bPeak = bars[i].close; if (bPeak > 0) bhDD = Math.min(bhDD, bars[i].close / bPeak - 1); }
  return {
    n, winRate: n ? wins.length / n : 0, expectancyR: mean, ci95: ci,
    expExTop1: expExTop(trades, 1), expExTop3: expExTop(trades, 3),
    profitFactor: gl > 0 ? gp / gl : Infinity,
    totalRet, cagr: years > 0 ? Math.pow(1 + totalRet, 1 / years) - 1 : 0,
    maxDD, years, perYear, bhRet, bhDD,
    stops: trades.filter((t) => t.reason === 'STOP').length,
  };
}

const fp = (v) => (v * 100).toFixed(1) + '%';
function report(sym, tf, name, res, bars) {
  const s = stats(res.trades, res.curve, bars, res.warmup);
  const is = res.trades.filter((t) => t.entryT < OOS_START);
  const oos = res.trades.filter((t) => t.entryT >= OOS_START);
  console.log(
    `${sym} ${tf} ${name.padEnd(16)} n=${String(s.n).padStart(4)} win=${fp(s.winRate).padStart(6)} ` +
    `expR=${s.expectancyR.toFixed(2).padStart(6)}±${s.ci95.toFixed(2)} exTop1=${s.expExTop1.toFixed(2).padStart(6)} exTop3=${s.expExTop3.toFixed(2).padStart(6)} ` +
    `PF=${s.profitFactor === Infinity ? 'inf' : s.profitFactor.toFixed(2)} ret=${fp(s.totalRet).padStart(7)} CAGR=${fp(s.cagr).padStart(5)} maxDD=${fp(s.maxDD).padStart(6)} stops=${s.stops} cens=${res.censored} ` +
    `| IS n=${is.length} expR=${expectancy(is).toFixed(2)} | OOS n=${oos.length} expR=${expectancy(oos).toFixed(2)} expRexTop3=${expExTop(oos, 3).toFixed(2)} | B&H ret=${fp(s.bhRet)} DD=${fp(s.bhDD)}`
  );
  const yr = Object.entries(s.perYear).map(([y, v]) => `${y}:${v.pnl >= 0 ? '+' : ''}$${Math.round(v.pnl)}(${v.n})`).join(' ');
  console.log(`   per-entry-year P&L(trades): ${yr}`);
  return s;
}

function main() {
  const asJson = process.argv.includes('--json');
  const configs = [
    { name: 'A-donchian-1d', tf: '1d', make: (b, ind, m) => stratA(b, ind, m), maxHoldBars: 365, mult: 1 },
    { name: 'B-pullback-1d', tf: '1d', make: (b, ind, m) => stratB(b, ind), maxHoldBars: 365, mult: 1 },
    { name: 'C-donchian-4h', tf: '4h', make: (b, ind, m) => stratA(b, ind, m), maxHoldBars: 2190, mult: 6 },
  ];
  const out = {};
  for (const sym of ['BTC', 'ETH']) { // universe decided 2026-10-29: BTC/ETH only
    for (const cfg of configs) {
      let bars;
      try { bars = loadBars(sym, cfg.tf); } catch { continue; }
      for (const mode of ['long', 'longshort']) {
        const res = runBacktest(bars, cfg.make, { allowShort: mode === 'longshort', maxHoldBars: cfg.maxHoldBars, mult: cfg.mult });
        const key = `${sym}|${cfg.name}|${mode}`;
        if (asJson) out[key] = { stats: stats(res.trades, res.curve, bars, res.warmup), trades: res.trades };
        else report(sym, cfg.tf, `${cfg.name}/${mode === 'long' ? 'L' : 'LS'}`, res, bars);
      }
    }
  }
  if (asJson) console.log(JSON.stringify(out));
}

if (require.main === module) main();
module.exports = { loadBars, runBacktest, stratA, stratB, stats, smaArr, atrArr, priorHigh, priorLow, FEE_SIDE, SLIP_SIDE, FUNDING_DAY, RISK_FRAC, START_EQUITY };
