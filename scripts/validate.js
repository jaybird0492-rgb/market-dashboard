const { RAW, loadCsv, closes, sma, rsi, report } = require('./lib');
const { runBacktest, statsFromDaily } = require('./engine');
const path = require('path');

// ---------- Strategy variants ----------
function bh(rows) {
  return rows.map(() => 1);
}

function maCross(rows, fast, slow) {
  const c = closes(rows);
  const f = sma(c, fast);
  const s = sma(c, slow);
  return c.map((v, i) => (i >= slow && f[i] > s[i] ? 1 : 0));
}

function aboveMA(rows, period) {
  const c = closes(rows);
  const m = sma(c, period);
  return c.map((v, i) => (i >= period && c[i] > m[i] ? 1 : 0));
}

function skipMonth(rows, months) {
  return rows.map((r) => (months.includes(parseInt(r.timestamp.slice(5, 7), 10)) ? 0 : 1));
}

function momentum(rows, hiLookback, maExit, rsiEntry = 0, skipMonths = []) {
  const c = closes(rows);
  const ma = sma(c, maExit);
  const r = rsi(c, 14);
  const pos = [];
  let inPos = 0;
  for (let i = 0; i < c.length; i++) {
    let signal = inPos;
    if (i >= hiLookback) {
      const win = c.slice(i - hiLookback, i);
      const month = parseInt(rows[i].timestamp.slice(5, 7), 10);
      if (!inPos && c[i] > Math.max(...win) && (rsiEntry === 0 || (r[i] !== null && r[i] > rsiEntry)) && !skipMonths.includes(month)) {
        signal = 1;
      }
      if (inPos && (c[i] < ma[i] || skipMonths.includes(month))) signal = 0;
    }
    pos.push(signal);
    inPos = signal;
  }
  return pos;
}

// ---------- Walk-forward ----------
function walkForward(rows, variants, fee, trainLen, testLen) {
  const n = rows.length;
  const stitchedRets = [];
  const log = [];
  const pickCount = {};
  const windowResults = [];
  for (let start = 0; start + trainLen + testLen <= n; start += testLen) {
    const trainRows = rows.slice(start, start + trainLen);
    const testRows = rows.slice(start + trainLen, start + trainLen + testLen);
    const scored = variants
      .map((v) => ({ v, r: runBacktest(trainRows, v.build(trainRows), fee) }))
      .sort((a, b) => b.r.sharpe - a.r.sharpe);
    const best = scored[0];
    pickCount[best.v.name] = (pickCount[best.v.name] || 0) + 1;
    const tr = runBacktest(testRows, best.v.build(testRows), fee);
    stitchedRets.push(...tr.dailyRets.slice(1));
    windowResults.push({ start: start + trainLen, end: start + trainLen + testLen, name: best.v.name, testTotal: tr.total, trainSharpe: best.r.sharpe });
    log.push(
      `  win ${start}->${start + testLen}: chose ${best.v.name} (train sharpe ${best.r.sharpe.toFixed(2)}, ann ${(best.r.ann * 100).toFixed(0)}%) -> test total ${(tr.total * 100).toFixed(1)}%`
    );
  }
  const stats = statsFromDaily([0, ...stitchedRets]);
  return { stats, log, pickCount, windowResults };
}

// ---------- Assets ----------
const STOCKS = ['AAPL', 'GOOGL', 'AMZN'];
const CRYPTO = ['BTC', 'ETH'];

const out = [];

// ==== STOCKS ====
out.push('========== WALK-FORWARD TESTS (train 2y, test 6m, stocks fee 0.05%/side) ==========');
for (const s of STOCKS) {
  const rows = loadCsv(path.join(RAW, `${s}_1d.csv`)).filter((r) => r.close !== null);
  const variants = [
    { name: 'Buy&Hold', build: (r) => bh(r) },
    { name: 'MA50>MA200', build: (r) => maCross(r, 50, 200) },
    { name: 'MA100>MA200', build: (r) => maCross(r, 100, 200) },
    { name: 'close>MA200', build: (r) => aboveMA(r, 200) },
    { name: 'B&H-skipSep', build: (r) => skipMonth(r, [9]) },
    { name: 'B&H-skipAugSep', build: (r) => skipMonth(r, [8, 9]) },
  ];
  out.push('');
  out.push(`--- ${s} ---`);
  const wf = walkForward(rows, variants, 0.0005, 730, 183);
  out.push(...wf.log);
  const picks = Object.entries(wf.pickCount).map(([k, v]) => `${k} x${v}`).join(' | ');
  out.push(`  Picks: ${picks}`);
  const bhFull = runBacktest(rows, bh(rows), 0.0005);
  out.push(`  OUT-OF-SAMPLE (stitched): total ${(wf.stats.total * 100).toFixed(0)}% | ann ${(wf.stats.ann * 100).toFixed(1)}% | sharpe ${wf.stats.sharpe.toFixed(2)} | maxDD ${(wf.stats.maxDD * 100).toFixed(0)}%`);
  out.push(`  Buy&Hold full period:      total ${(bhFull.total * 100).toFixed(0)}% | ann ${(bhFull.ann * 100).toFixed(1)}% | sharpe ${bhFull.sharpe.toFixed(2)} | maxDD ${(bhFull.maxDD * 100).toFixed(0)}%`);
}

// ==== CRYPTO ====
out.push('');
out.push('========== WALK-FORWARD TESTS (train 2y, test 6m, crypto fee 0.1%/side) ==========');
for (const s of CRYPTO) {
  const rows = loadCsv(path.join(RAW, `${s}_1d.csv`)).filter((r) => r.close !== null);
  const variants = [
    { name: 'Buy&Hold', build: (r) => bh(r) },
    { name: 'MOM252/20', build: (r) => momentum(r, 252, 20) },
    { name: 'MOM252/20-JuneSkip', build: (r) => momentum(r, 252, 20, 0, [6]) },
    { name: 'MOM252/50', build: (r) => momentum(r, 252, 50) },
    { name: 'MOM120/20', build: (r) => momentum(r, 120, 20) },
    { name: 'MOM365/50', build: (r) => momentum(r, 365, 50) },
    { name: 'MOM252/20-RSI60', build: (r) => momentum(r, 252, 20, 60) },
    { name: 'MA50>MA200', build: (r) => maCross(r, 50, 200) },
    { name: 'close>MA200', build: (r) => aboveMA(r, 200) },
    { name: 'JuneSkip-only', build: (r) => skipMonth(r, [6]) },
  ];
  out.push('');
  out.push(`--- ${s} ---`);
  const wf = walkForward(rows, variants, 0.001, 730, 183);
  out.push(...wf.log);
  const picks = Object.entries(wf.pickCount).map(([k, v]) => `${k} x${v}`).join(' | ');
  out.push(`  Picks: ${picks}`);
  const bhFull = runBacktest(rows, bh(rows), 0.001);
  out.push(`  OUT-OF-SAMPLE (stitched): total ${(wf.stats.total * 100).toFixed(0)}% | ann ${(wf.stats.ann * 100).toFixed(1)}% | sharpe ${wf.stats.sharpe.toFixed(2)} | maxDD ${(wf.stats.maxDD * 100).toFixed(0)}%`);
  out.push(`  Buy&Hold full period:      total ${(bhFull.total * 100).toFixed(0)}% | ann ${(bhFull.ann * 100).toFixed(1)}% | sharpe ${bhFull.sharpe.toFixed(2)} | maxDD ${(bhFull.maxDD * 100).toFixed(0)}%`);
}

// ==== FULL-PERIOD FACE-OFF on BTC (with all overlays) ====
{
  const rows = loadCsv(path.join(RAW, 'BTC_1d.csv')).filter((r) => r.close !== null);
  out.push('');
  out.push('========== BTC FULL-PERIOD FACE-OFF ==========');
  const contenders = [
    { name: 'Buy&Hold', build: (r) => bh(r) },
    { name: 'MOM252/20', build: (r) => momentum(r, 252, 20) },
    { name: 'MOM252/20 + June skip', build: (r) => momentum(r, 252, 20, 0, [6]) },
    { name: 'June skip only', build: (r) => skipMonth(r, [6]) },
    { name: 'close>MA200', build: (r) => aboveMA(r, 200) },
  ];
  for (const v of contenders) {
    const r = runBacktest(rows, v.build(rows), 0.001);
    out.push(
      `${v.name.padEnd(26)} total ${(r.total * 100).toFixed(0)}% | ann ${(r.ann * 100).toFixed(1)}% | sharpe ${r.sharpe.toFixed(2)} | maxDD ${(r.maxDD * 100).toFixed(0)}% | ${r.trades} trades | in market ${(r.inMarket * 100).toFixed(0)}%`
    );
  }
}

report('validation', out);
