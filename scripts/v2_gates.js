// Gate matrix — pre-registered 2026-11-04, before running.
//
// Why: the 4H F3 layer (Donchian 20/10 + daily SMA50 gate) has produced two
// paper trades since 2026-10-30, both closed at small losses, and is now
// sitting flat while BTC/ETH rally off the crash low. Diagnosis: price is
// below the daily SMA50 (BTC 5.8%, ETH 10.3%), so the gate blocks every
// long breakout, and the short trigger is 3-5% away. That is the binding
// constraint, not a broken pipeline.
//
// Question: is the daily SMA50 gate too slow on the long side? Measure every
// 20/10 4H entry in 2017-2026, tagged by the daily state at entry, then test
// a small, economically motivated set of alternative gates.
//
// Pre-registered gates (all on 4H Donchian 20/10, futures costs, long+short):
//   G0 SMA50        — current F3 baseline (sign of close - daily SMA50)
//   G1 SMA200       — F2 baseline (slow regime)
//   G2 none         — F1 baseline, 4H decides alone
//   G3 SMA20        — faster daily mean
//   G4 EMA21        — faster daily mean, smoother
//   G5 transition   — long allowed above SMA50; short allowed below SMA200;
//                     BOTH allowed in the band between them (the pullback zone
//                     that is currently blocking the recovery longs)
//   G6 donchian20   — daily Donchian-20 direction with state persistence
//
// Acceptance (unchanged from the earlier pre-registration): OOS (2023+)
// expR > +0.15, exTop3 > 0, on BOTH BTC and ETH. A gate that fails cannot
// replace F3. A gate that passes still runs paper-only for 6 weeks first.
// Selection caveat: this test is motivated by an observed live failure, so
// the winner will have been chosen with hindsight. Its paper period is the
// real out-of-sample check.
const { loadBars, runBacktest, stratA, stats, smaArr } = require('./v2_backtest');
const { FUT, dailyGateFactory } = require('./v2_timeframes');

const DAY = 864e5;

function emaArr(v, n) {
  const out = new Array(v.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < v.length; i++) {
    prev = prev === null ? v[i] : v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Returns an array `allowed[i]` for each daily bar: 1 = long only,
// -1 = short only, 0 = both sides allowed.
function gateSeries(sym, kind) {
  if (kind === 'transition') {
    // Single source of truth: the exact gate the paper layer deploys.
    const gateAt = dailyGateFactory(sym);
    return (t) => {
      const g = gateAt(t);
      if (!g) return null;
      if (g.long && g.short) return 0;
      if (g.long) return 1;
      if (g.short) return -1;
      return null;
    };
  }
  const d = loadBars(sym, '1d');
  const cl = d.map((b) => b.close);
  const s20 = smaArr(cl, 20), s50 = smaArr(cl, 50), s200 = smaArr(cl, 200);
  const e21 = emaArr(cl, 21);
  const allowed = new Array(d.length).fill(null);
  let don = 0;
  for (let i = 0; i < d.length; i++) {
    if (s200[i] === null) continue;
    if (kind === 'SMA50') allowed[i] = cl[i] > s50[i] ? 1 : -1;
    else if (kind === 'SMA200') allowed[i] = cl[i] > s200[i] ? 1 : -1;
    else if (kind === 'none') allowed[i] = 0;
    else if (kind === 'SMA20') allowed[i] = cl[i] > s20[i] ? 1 : -1;
    else if (kind === 'EMA21') allowed[i] = cl[i] > e21[i] ? 1 : -1;
    else if (kind === 'donchian20') {
      const win = cl.slice(Math.max(0, i - 20), i);
      if (win.length >= 20) {
        if (cl[i] > Math.max(...win)) don = 1;
        else if (cl[i] < Math.min(...win)) don = -1;
      }
      allowed[i] = don;
    }
  }
  // map time -> allowance using the last COMPLETED daily bar (no lookahead)
  return (t) => {
    let lo = 0, hi = d.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (d[mid].t + DAY <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans < 0 || allowed[ans] === null ? null : allowed[ans];
  };
}

function makeStrategy(gateAt) {
  return (bars, ind) => {
    const inner = stratA(bars, ind, 1, { entry: 20, exit: 10 });
    return {
      warmup: 200,
      entryDir(i) {
        const d = inner.entryDir(i);
        if (d === 0) return 0;
        const allow = gateAt(bars[i].t);
        if (allow === null) return 0;
        return allow === 0 || allow === d ? d : 0;
      },
      exitHit: inner.exitHit,
    };
  };
}

const OOS = Date.parse('2023-01-01T00:00:00Z');
const exp = (ts) => (ts.length ? ts.reduce((a, t) => a + t.rMultiple, 0) / ts.length : 0);

function report(sym, name, res, bars) {
  const s = stats(res.trades, res.curve, bars, res.warmup);
  const is = res.trades.filter((t) => t.entryT < OOS), oos = res.trades.filter((t) => t.entryT >= OOS);
  const ex3 = exp([...res.trades].sort((a, b) => b.rMultiple - a.rMultiple).slice(3));
  const oosEx3 = exp([...oos].sort((a, b) => b.rMultiple - a.rMultiple).slice(3));
  const yrs = s.years || 9;
  const pass = exp(oos) > 0.15 && ex3 > 0;
  console.log(
    `${sym} ${name.padEnd(11)} n=${String(s.n).padStart(4)} (${(s.n / yrs).toFixed(0).padStart(3)}/yr) win=${(s.winRate * 100).toFixed(0).padStart(3)}% ` +
    `expR=${s.expectancyR.toFixed(2).padStart(6)}±${s.ci95.toFixed(2)} exTop3=${ex3.toFixed(2).padStart(6)} PF=${s.profitFactor.toFixed(2).padStart(5)} maxDD=${(s.maxDD * 100).toFixed(0).padStart(4)}% ` +
    `| IS=${exp(is).toFixed(2).padStart(6)}(n=${is.length}) OOS=${exp(oos).toFixed(2).padStart(6)}(n=${oos.length}, exTop3 ${oosEx3.toFixed(2)}) ${pass ? 'PASS' : ''}`
  );
  return { sym, name, n: s.n, expR: s.expectancyR, oos: exp(oos), oosEx3, ex3, maxDD: s.maxDD, pass };
}

function main() {
  const gates = ['SMA50', 'SMA200', 'none', 'SMA20', 'EMA21', 'transition', 'donchian20'];
  const results = [];
  for (const sym of ['BTC', 'ETH']) {
    const bars = loadBars(sym, '4h');
    for (const g of gates) {
      const res = runBacktest(bars, makeStrategy(gateSeries(sym, g)), { allowShort: true, maxHoldBars: 360, mult: 1, ...FUT });
      results.push(report(sym, g, res, bars));
    }
  }
  console.log('\nGates passing on BOTH coins:');
  for (const g of gates) {
    const rows = results.filter((r) => r.name === g);
    if (rows.length === 2 && rows.every((r) => r.pass)) console.log('  ' + g);
  }
}

main();
