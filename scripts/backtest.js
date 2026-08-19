const { RAW, loadCsv, closes, sma, rsi, mean, annualized, report } = require('./lib');
const path = require('path');

const out = [];

// ---------- Backtest engine ----------
// positions: array aligned with closes, 0 or 1 (target). Entries/exits at close, fee per side.
function backtest(label, rows, positions, feePerTrade, verbose = true) {
  const c = closes(rows);
  let cash = 1;
  let pos = 0;
  let entryPrice = 0;
  let entryIdx = 0;
  let trades = 0;
  let wins = 0;
  let peak = 1;
  let maxDD = 0;
  let inMkt = 0;
  for (let i = 0; i < c.length; i++) {
    const target = positions[i] ? 1 : 0;
    if (target !== pos) {
      if (target === 1) {
        cash *= 1 - feePerTrade;
        entryPrice = c[i];
        entryIdx = i;
      } else {
        const ret = c[i] / entryPrice - 1;
        cash *= (1 + ret) * (1 - feePerTrade);
        trades++;
        if (ret > 0) wins++;
      }
      pos = target;
    }
    if (pos === 1) inMkt++;
    const eq = pos === 1 ? cash * (c[i] / entryPrice) : cash;
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, eq / peak - 1);
  }
  if (pos === 1) {
    cash *= c[c.length - 1] / entryPrice;
    trades++;
    if (c[c.length - 1] > entryPrice) wins++;
  }
  const total = cash - 1;
  const ann = annualized(total, c.length);
  const fmt = `${label.padEnd(26)} total ${(total * 100).toFixed(0)}% | ann ${(ann * 100).toFixed(1)}% | maxDD ${(maxDD * 100).toFixed(0)}% | trades ${trades} | win ${trades ? ((wins / trades) * 100).toFixed(0) : 0}% | in market ${((inMkt / c.length) * 100).toFixed(0)}%`;
  if (verbose) out.push('  ' + fmt);
  return { total, ann, maxDD, trades };
}

function buyHold(rows) {
  const c = closes(rows);
  const total = c[c.length - 1] / c[0] - 1;
  return { total, ann: annualized(total, c.length), maxDD: NaN, trades: 1 };
}

function dailyPositionRule(rows, pred) {
  return rows.map((r, i) => (pred(r, i) ? 1 : 0));
}

const STOCKS = [
  { s: 'AAPL', label: 'Apple', daily: 'AAPL_1d.csv' },
  { s: 'GOOGL', label: 'Alphabet', daily: 'GOOGL_1d.csv' },
  { s: 'AMZN', label: 'Amazon', daily: 'AMZN_1d.csv' },
];

out.push('========== BACKTESTS (daily, fees: stocks 0.05%/side, crypto 0.1%/side) ==========');

// --- Stocks: seasonality (July), buy&hold, MA cross ---
for (const a of STOCKS) {
  const rows = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  const c = closes(rows);
  out.push('');
  out.push(`--- ${a.label} ---`);
  const bh = buyHold(rows);
  out.push(`  ${'BUY & HOLD'.padEnd(26)} total ${(bh.total * 100).toFixed(0)}% | ann ${(bh.ann * 100).toFixed(1)}%`);
  const julyPos = dailyPositionRule(rows, (r) => r.timestamp.slice(5, 7) === '07');
  backtest('July-only (all years)', rows, julyPos, 0.0005);
  const sepPos = dailyPositionRule(rows, (r) => r.timestamp.slice(5, 7) === '09');
  backtest('September-only', rows, sepPos, 0.0005);
  const ma50 = sma(c, 50);
  const ma200 = sma(c, 200);
  const maPos = c.map((v, i) => (i >= 200 && ma50[i] > ma200[i] ? 1 : 0));
  backtest('MA50>MA200 (trend follow)', rows, maPos, 0.0005);
  const r = rsi(c, 14);
  const rsiPos = [];
  let inPos = 0;
  let rsiEntry = null;
  for (let i = 14; i < c.length; i++) {
    if (!inPos && r[i] !== null && r[i] < 30) { inPos = 1; rsiEntry = i; }
    if (inPos && ((r[i] !== null && r[i] > 70) || i - rsiEntry > 20)) inPos = 0;
    rsiPos.push(inPos);
  }
  while (rsiPos.length < c.length) rsiPos.unshift(0);
  backtest('RSI<30 buy, RSI>70/20d exit', rows, rsiPos, 0.0005);
}

// --- Crypto: seasonality, MA cross, RSI ---
const CRYPTO = [
  { s: 'BTC', label: 'Bitcoin', daily: 'BTC_1d.csv' },
  { s: 'ETH', label: 'Ethereum', daily: 'ETH_1d.csv' },
];
for (const a of CRYPTO) {
  const rows = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  const c = closes(rows);
  out.push('');
  out.push(`--- ${a.label} ---`);
  const bh = buyHold(rows);
  out.push(`  ${'BUY & HOLD'.padEnd(26)} total ${(bh.total * 100).toFixed(0)}% | ann ${(bh.ann * 100).toFixed(1)}%`);
  const octPos = dailyPositionRule(rows, (r) => r.timestamp.slice(5, 7) === '10');
  backtest('October-only', rows, octPos, 0.001);
  const notJunPos = dailyPositionRule(rows, (r) => r.timestamp.slice(5, 7) !== '06');
  backtest('All-except-June', rows, notJunPos, 0.001);
  const ma50 = sma(c, 50);
  const ma200 = sma(c, 200);
  const maPos = c.map((v, i) => (i >= 200 && ma50[i] > ma200[i] ? 1 : 0));
  backtest('MA50>MA200 (trend follow)', rows, maPos, 0.001);
  const r = rsi(c, 14);
  const rsiPos = [];
  let inPos = 0;
  let rsiEntry = null;
  for (let i = 14; i < c.length; i++) {
    if (!inPos && r[i] !== null && r[i] < 30) { inPos = 1; rsiEntry = i; }
    if (inPos && ((r[i] !== null && r[i] > 70) || i - rsiEntry > 30)) inPos = 0;
    rsiPos.push(inPos);
  }
  while (rsiPos.length < c.length) rsiPos.unshift(0);
  backtest('RSI<30 buy, RSI>70/30d exit', rows, rsiPos, 0.001);
}

// --- Crypto hourly (BTC/ETH 20:00-22:00 UTC) ---
out.push('');
out.push('--- Hour-of-day (crypto): hold 20:00->22:00 UTC every day ---');
for (const a of CRYPTO) {
  const rows = loadCsv(path.join(RAW, a.s + '_1h.csv')).filter((r) => r.close !== null);
  const c = closes(rows);
  const positions = rows.map((r) => {
    const h = new Date(r.timestamp).getUTCHours();
    return h === 20 ? 1 : 0; // buy at 20:00 close, sell at 21:00 close
  });
  backtest(`${a.s} 20-22UTC daily`, rows, positions, 0.0001);
  backtest(`${a.s} 20-22UTC daily (0.1% fee)`, rows, positions, 0.001);
}

// --- BTC 52w-high momentum with 20d MA exit ---
{
  const rows = loadCsv(path.join(RAW, 'BTC_1d.csv')).filter((r) => r.close !== null);
  const c = closes(rows);
  const ma20 = sma(c, 20);
  const pos = [];
  let inPos = 0;
  for (let i = 0; i < c.length; i++) {
    if (i < 252) { pos.push(0); continue; }
    const win = c.slice(i - 252, i);
    if (!inPos && c[i] > Math.max(...win)) inPos = 1;
    if (inPos && i >= 20 && c[i] < ma20[i]) inPos = 0;
    pos.push(inPos);
  }
  out.push('');
  out.push('--- Bitcoin 52w-high breakout, exit below 20d MA ---');
  backtest('BTC 52w-high momentum', rows, pos, 0.001);
  const bh = buyHold(rows);
  out.push(`  ${'BUY & HOLD'.padEnd(26)} total ${(bh.total * 100).toFixed(0)}% | ann ${(bh.ann * 100).toFixed(1)}%`);
}

report('backtests', out);
