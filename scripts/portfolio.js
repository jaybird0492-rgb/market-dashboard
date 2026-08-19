const { RAW, loadCsv, closes, sma, rsi, report, annualized } = require('./lib');
const path = require('path');

const ASSETS = {
  AAPL: 'AAPL_1d.csv',
  GOOGL: 'GOOGL_1d.csv',
  AMZN: 'AMZN_1d.csv',
  BTC: 'BTC_1d.csv',
  ETH: 'ETH_1d.csv',
};

// Aligned daily close series (carry-forward) from ETH start (2017-08-17)
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
const syms = ['AAPL', 'GOOGL', 'AMZN', 'BTC', 'ETH'];
const closes_ = {};
for (const s of syms) closes_[s] = series[s].slice(startIdx);
const n = closes_.AAPL.length;
const idx = dates.slice(startIdx);

// daily returns per asset
const rets = {};
for (const s of syms) {
  const arr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const a = closes_[s][i];
    const b = closes_[s][i - 1];
    arr[i] = Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b - 1 : 0;
  }
  rets[s] = arr;
}

// overlays (position 0/1 per day per asset)
function momentumPos(rows, hiLookback, maExit, skipMonths) {
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

const overlays = {};
{
  const bySym = {};
  for (const s of syms) {
    bySym[s] = loadCsv(path.join(RAW, ASSETS[s])).filter((r) => r.close !== null);
  }
  for (const s of ['AAPL', 'GOOGL', 'AMZN']) {
    const pos = bySym[s].map((r) => (parseInt(r.timestamp.slice(5, 7), 10) === 9 ? 0 : 1));
    // align with portfolio dates
    const m = new Map(bySym[s].map((r, i) => [r.timestamp.slice(0, 10), pos[i]]));
    overlays[s] = idx.map((d) => m.get(d) ?? 1);
  }
  const bt = momentumPos(bySym.BTC, 252, 20, [6]);
  const mBt = new Map(bySym.BTC.map((r, i) => [r.timestamp.slice(0, 10), bt[i]]));
  overlays.BTC = idx.map((d) => mBt.get(d) ?? 0);
  const eth = momentumPos(bySym.ETH, 252, 20, [6]);
  const mEth = new Map(bySym.ETH.map((r, i) => [r.timestamp.slice(0, 10), eth[i]]));
  overlays.ETH = idx.map((d) => mEth.get(d) ?? 0);
}

function simulate(weights, useOverlays, rebalanceMonthly) {
  const daily = new Array(n).fill(0);
  let w = { ...weights };
  let cash = 0;
  for (let i = 1; i < n; i++) {
    const month = idx[i].slice(0, 7);
    const prevMonth = idx[i - 1].slice(0, 7);
    if (rebalanceMonthly && month !== prevMonth) w = { ...weights };
    let r = 0;
    for (const s of syms) {
      const active = useOverlays ? overlays[s][i - 1] : 1;
      r += w[s] * active * rets[s][i];
    }
    daily[i] = r;
  }
  return daily;
}

function stats(daily) {
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  for (let i = 1; i < n; i++) {
    eq *= 1 + daily[i];
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, eq / peak - 1);
  }
  const slice = daily.slice(1);
  const m = slice.reduce((a, b) => a + b, 0) / slice.length;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / (slice.length - 1));
  return {
    total: eq - 1,
    ann: annualized(eq - 1, n),
    sharpe: sd ? (m / sd) * Math.sqrt(365) : 0,
    maxDD,
  };
}

function yearly(daily) {
  const rows = [];
  let eq = 1;
  const map = {};
  for (let i = 1; i < n; i++) {
    eq *= 1 + daily[i];
    const y = idx[i].slice(0, 4);
    map[y] = eq;
  }
  let prev = 1;
  for (const y of Object.keys(map).sort()) {
    rows.push(`${y}: ${((map[y] / prev - 1) * 100).toFixed(0)}%`);
    prev = map[y];
  }
  return rows.join(' | ');
}

const out = [];
out.push('========== PORTFOLIO SIMULATIONS (2017-08-17 to 2026-08-19, monthly rebalance) ==========');

const portfolios = [
  { name: 'Equal weight 5 assets (20% each)', weights: { AAPL: 0.2, GOOGL: 0.2, AMZN: 0.2, BTC: 0.2, ETH: 0.2 }, overlays: false },
  { name: 'Core 60/25/15 (stocks/BTC/ETH)', weights: { AAPL: 0.2, GOOGL: 0.2, AMZN: 0.2, BTC: 0.25, ETH: 0.15 }, overlays: false },
  { name: 'Core + overlays (skip Sep stocks, BTC mom+Jun, ETH Jun)', weights: { AAPL: 0.2, GOOGL: 0.2, AMZN: 0.2, BTC: 0.25, ETH: 0.15 }, overlays: true },
  { name: 'Stocks only (33% each)', weights: { AAPL: 1 / 3, GOOGL: 1 / 3, AMZN: 1 / 3, BTC: 0, ETH: 0 }, overlays: false },
  { name: 'BTC only', weights: { AAPL: 0, GOOGL: 0, AMZN: 0, BTC: 1, ETH: 0 }, overlays: false },
];

for (const p of portfolios) {
  const daily = simulate(p.weights, p.overlays, true);
  const s = stats(daily);
  out.push('');
  out.push(p.name);
  out.push(`  total ${(s.total * 100).toFixed(0)}% | ann ${(s.ann * 100).toFixed(1)}% | sharpe ${s.sharpe.toFixed(2)} | maxDD ${(s.maxDD * 100).toFixed(0)}%`);
  out.push(`  yearly: ${yearly(daily)}`);
}

report('portfolio', out);
