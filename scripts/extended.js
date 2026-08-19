const { RAW, loadCsv, closes, sma, report, mean, annualized } = require('./lib');
const { runBacktest, statsFromDaily } = require('./engine');
const path = require('path');

const out = [];

// ---------- 1) SPY/QQQ vs single stocks: same rules ----------
out.push('========== SPY & QQQ vs SINGLE STOCKS (10y, fees 0.05%/side) ==========');
const STOCKS = ['AAPL', 'GOOGL', 'AMZN', 'SPY', 'QQQ'];
const names = { AAPL: 'Apple', GOOGL: 'Alphabet', AMZN: 'Amazon', SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF' };

for (const s of STOCKS) {
  const rows = loadCsv(path.join(RAW, `${s}_1d.csv`)).filter((r) => r.close !== null);
  const c = closes(rows);
  const ma = sma(c, 200);
  const bhPos = rows.map(() => 1);
  const skipSepPos = rows.map((r) => (parseInt(r.timestamp.slice(5, 7), 10) === 9 ? 0 : 1));
  const maPos = c.map((v, i) => (i >= 200 && c[i] > ma[i] ? 1 : 0));
  const bh = runBacktest(rows, bhPos, 0.0005);
  const sk = runBacktest(rows, skipSepPos, 0.0005);
  const ms = runBacktest(rows, maPos, 0.0005);
  out.push('');
  out.push(`${names[s]} (${s}) 10y:`);
  out.push(`  Buy&Hold        total ${(bh.total * 100).toFixed(0)}% | ann ${(bh.ann * 100).toFixed(1)}% | sharpe ${bh.sharpe.toFixed(2)} | maxDD ${(bh.maxDD * 100).toFixed(0)}%`);
  out.push(`  Skip-September  total ${(sk.total * 100).toFixed(0)}% | ann ${(sk.ann * 100).toFixed(1)}% | sharpe ${sk.sharpe.toFixed(2)} | maxDD ${(sk.maxDD * 100).toFixed(0)}% | trades ${sk.trades}`);
  out.push(`  close>MA200     total ${(ms.total * 100).toFixed(0)}% | ann ${(ms.ann * 100).toFixed(1)}% | sharpe ${ms.sharpe.toFixed(2)} | maxDD ${(ms.maxDD * 100).toFixed(0)}% | in market ${(ms.inMarket * 100).toFixed(0)}%`);
}

// ---------- 2) Walk-forward on SPY/QQQ ----------
function momentum(rows, hiLookback, maExit, skipMonths = []) {
  const c = closes(rows);
  const ma = sma(c, maExit);
  const pos = [];
  let inPos = 0;
  for (let i = 0; i < c.length; i++) {
    let signal = inPos;
    if (i >= hiLookback) {
      const win = c.slice(i - hiLookback, i);
      const month = parseInt(rows[i].timestamp.slice(5, 7), 10);
      if (!inPos && c[i] > Math.max(...win) && !skipMonths.includes(month)) signal = 1;
      if (inPos && (c[i] < ma[i] || skipMonths.includes(month))) signal = 0;
    }
    pos.push(signal);
    inPos = signal;
  }
  return pos;
}
function walkForward(rows, variants, fee, trainLen, testLen) {
  const n = rows.length;
  const stitched = [];
  const pickCount = {};
  for (let start = 0; start + trainLen + testLen <= n; start += testLen) {
    const trainRows = rows.slice(start, start + trainLen);
    const testRows = rows.slice(start + trainLen, start + trainLen + testLen);
    const scored = variants
      .map((v) => ({ v, r: runBacktest(trainRows, v.build(trainRows), fee) }))
      .sort((a, b) => b.r.sharpe - a.r.sharpe);
    const best = scored[0];
    pickCount[best.v.name] = (pickCount[best.v.name] || 0) + 1;
    const tr = runBacktest(testRows, best.v.build(testRows), fee);
    stitched.push(...tr.dailyRets.slice(1));
  }
  return { stats: statsFromDaily([0, ...stitched]), pickCount };
}
out.push('');
out.push('========== WALK-FORWARD SPY & QQQ (train 2y / test 6m) ==========');
for (const s of ['SPY', 'QQQ']) {
  const rows = loadCsv(path.join(RAW, `${s}_1d.csv`)).filter((r) => r.close !== null);
  const variants = [
    { name: 'Buy&Hold', build: (r) => r.map(() => 1) },
    { name: 'B&H-skipSep', build: (r) => r.map((x) => (parseInt(x.timestamp.slice(5, 7), 10) === 9 ? 0 : 1)) },
    { name: 'close>MA200', build: (r) => closes(r).map((v, i) => (i >= 200 && v > sma(closes(r), 200)[i] ? 1 : 0)) },
    { name: 'MOM252/20', build: (r) => momentum(r, 252, 20) },
    { name: 'MOM252/20-skipSep', build: (r) => momentum(r, 252, 20, [9]) },
  ];
  const wf = walkForward(rows, variants, 0.0005, 730, 183);
  const bh = runBacktest(rows, rows.map(() => 1), 0.0005);
  const picks = Object.entries(wf.pickCount).map(([k, v]) => `${k} x${v}`).join(' | ');
  out.push(`${s}: OOS total ${(wf.stats.total * 100).toFixed(0)}% | ann ${(wf.stats.ann * 100).toFixed(1)}% | sharpe ${wf.stats.sharpe.toFixed(2)} | maxDD ${(wf.stats.maxDD * 100).toFixed(0)}% | picks: ${picks}`);
  out.push(`   B&H full: total ${(bh.total * 100).toFixed(0)}% | ann ${(bh.ann * 100).toFixed(1)}% | sharpe ${bh.sharpe.toFixed(2)} | maxDD ${(bh.maxDD * 100).toFixed(0)}%`);
}

// ---------- 3) Portfolio variants: SPY/QQQ vs single stocks ----------
const ASSETS = {
  AAPL: 'AAPL_1d.csv', GOOGL: 'GOOGL_1d.csv', AMZN: 'AMZN_1d.csv',
  SPY: 'SPY_1d.csv', QQQ: 'QQQ_1d.csv', BTC: 'BTC_1d.csv', ETH: 'ETH_1d.csv',
};
const series = {};
const allDates = new Set();
for (const [sym, file] of Object.entries(ASSETS)) {
  const rows = loadCsv(path.join(RAW, file)).filter((r) => r.close !== null);
  const map = new Map(rows.map((r) => [r.timestamp.slice(0, 10), r.close]));
  for (const d of map.keys()) allDates.add(d);
}
const dates = [...allDates].sort();
for (const [sym, file] of Object.entries(ASSETS)) {
  const rows = loadCsv(path.join(RAW, file)).filter((r) => r.close !== null);
  const map = new Map(rows.map((r) => [r.timestamp.slice(0, 10), r.close]));
  const arr = [];
  let last = null;
  for (const d of dates) {
    const v = map.get(d);
    if (v !== undefined) last = v;
    arr.push(last);
  }
  series[sym] = arr;
}
const startIdx = dates.findIndex((d) => d >= '2017-08-17');
const idx = dates.slice(startIdx);
const C = {};
for (const s of Object.keys(ASSETS)) C[s] = series[s].slice(startIdx);
const n = C.SPY.length;
const rets = {};
for (const s of Object.keys(ASSETS)) {
  const arr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const a = C[s][i];
    const b = C[s][i - 1];
    arr[i] = Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b - 1 : 0;
  }
  rets[s] = arr;
}
const bySym = {};
for (const s of Object.keys(ASSETS)) bySym[s] = loadCsv(path.join(RAW, ASSETS[s])).filter((r) => r.close !== null);
const O = {};
for (const s of ['AAPL', 'GOOGL', 'AMZN', 'SPY', 'QQQ']) {
  const p = bySym[s].map((r) => (parseInt(r.timestamp.slice(5, 7), 10) === 9 ? 0 : 1));
  const m = new Map(bySym[s].map((r, i) => [r.timestamp.slice(0, 10), p[i]]));
  O[s] = idx.map((d) => m.get(d) ?? 1);
}
for (const s of ['BTC', 'ETH']) {
  const p = momentum(bySym[s], 252, 20, [6]);
  const m = new Map(bySym[s].map((r, i) => [r.timestamp.slice(0, 10), p[i]]));
  O[s] = idx.map((d) => m.get(d) ?? 0);
}
function simulate(weights, overlays) {
  const daily = new Array(n).fill(0);
  let w = { ...weights };
  for (let i = 1; i < n; i++) {
    const month = idx[i].slice(0, 7);
    const prevMonth = idx[i - 1].slice(0, 7);
    if (month !== prevMonth) w = { ...weights };
    let r = 0;
    for (const s of Object.keys(weights)) {
      const on = overlays ? O[s][i - 1] : 1;
      r += w[s] * on * rets[s][i];
    }
    daily[i] = r;
  }
  return daily;
}
function st(daily) {
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  for (let i = 1; i < n; i++) {
    eq *= 1 + daily[i];
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, eq / peak - 1);
  }
  const sl = daily.slice(1);
  const m = sl.reduce((a, b) => a + b, 0) / sl.length;
  const sd = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / (sl.length - 1));
  return { total: eq - 1, ann: annualized(eq - 1, n), sharpe: sd ? (m / sd) * Math.sqrt(365) : 0, maxDD };
}
out.push('');
out.push('========== PORTFOLIO VARIANTS (2017-2026, monthly rebalance, fees incl.) ==========');
const variants = [
  { name: 'Final (AAPL/GOOGL/AMZN/BTC/ETH) + rules', w: { AAPL: 0.2, GOOGL: 0.2, AMZN: 0.2, BTC: 0.25, ETH: 0.15 }, ov: true },
  { name: 'ETFs variant (SPY/QQQ/BTC/ETH) + rules', w: { SPY: 0.3, QQQ: 0.3, BTC: 0.25, ETH: 0.15 }, ov: true },
  { name: 'Index heavy (SPY 50 / QQQ 15 / BTC 25 / ETH 10) + rules', w: { SPY: 0.5, QQQ: 0.15, BTC: 0.25, ETH: 0.1 }, ov: true },
  { name: 'SPY only (index benchmark)', w: { SPY: 1 }, ov: false },
  { name: '60/25/15 no rules (reference)', w: { AAPL: 0.2, GOOGL: 0.2, AMZN: 0.2, BTC: 0.25, ETH: 0.15 }, ov: false },
];
for (const v of variants) {
  const s = st(simulate(v.w, v.ov));
  out.push(`${v.name.padEnd(52)} total ${(s.total * 100).toFixed(0)}% | ann ${(s.ann * 100).toFixed(1)}% | sharpe ${s.sharpe.toFixed(2)} | maxDD ${(s.maxDD * 100).toFixed(0)}%`);
}

report('extended', out);
