// Tuner: search over risk:reward, threshold and 1D-bias-filter to find
// positive-expectancy configurations for the multi-factor strategy.
// Reports expectancy per bar and stop-loss hit rate.

const path = require('path');
const fs = require('fs');
const { indicators, evalAt } = require('./strategy');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const SYMBOLS = ['BTC', 'ETH'];
const TFS = { '1H': '1h', '4H': '4h', '1D': '1d' };
const HOLD = 2;

function loadCsv(file) {
  if (!fs.existsSync(file)) return [];
  const txt = fs.readFileSync(file, 'utf8').trim();
  if (!txt) return [];
  const ln = txt.split(/\r?\n/);
  const head = ln[0].split(',');
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  return ln.slice(1).map((l) => {
    const p = l.split(',');
    return {
      t: Date.parse(p[idx.timestamp]),
      open: +p[idx.open], high: +p[idx.high], low: +p[idx.low], close: +p[idx.close],
    };
  }).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.close));
}

function getBias1D(sym, bars, at, ind) {
  const e = evalAt(bars, at, ind);
  return e.score >= 20 ? 'LONG' : e.score <= -20 ? 'SHORT' : 'NEUTRAL';
}

function runTimeframe(sym, tf, cfg) {
  const bars = loadCsv(path.join(RAW, `${sym}_${TFS[tf]}.csv`));
  if (bars.length < 240) return null;
  const ind = indicators(bars);
  const start = 210;
  // Precompute 1D bias series (only for 1H/4H) using daily data
  let d1dBars = null, d1dInd = null, d1dSignal = null;
  if (tf !== '1D') {
    d1dBars = loadCsv(path.join(RAW, `${sym}_1d.csv`)).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.close));
    d1dInd = indicators(d1dBars);
    d1dSignal = d1dBars.map((b, i) => {
      const e = evalAt(d1dBars, i, d1dInd);
      return b.t; // store time index
    });
    // build bias lookup keyed by timestamp
    d1dBars._bias = d1dBars.map((b, i) => {
      const e = evalAt(d1dBars, i, d1dInd);
      return e.score >= 20 ? 'LONG' : e.score <= -20 ? 'SHORT' : 'NEUTRAL';
    });
  }
  function biasAt(time) {
    if (tf === '1D') return 'NEUTRAL';
    let bias = 'NEUTRAL';
    for (let i = 0; i < d1dBars.length; i++) {
      if (d1dBars[i].t <= time) bias = d1dBars._bias[i];
      else break;
    }
    return bias;
  }

  const trades = [];
  let i = start;
  while (i < bars.length) {
    const e = evalAt(bars, i, ind);
    const dir = Math.abs(e.score) >= cfg.thresh ? (e.score > 0 ? 1 : -1) : 0;
    if (dir !== 0) {
      const bias = biasAt(bars[i].t);
      if (cfg.biasFilter) {
        if (dir === 1 && bias === 'SHORT') { i += 1; continue; }
        if (dir === -1 && bias === 'LONG') { i += 1; continue; }
      }
      const cfg_ = { '1H': { a: 1.2 }, '4H': { a: 1.4 }, '1D': { a: 1.8 } }[tf];
      const atr = ind.atr[i];
      const entry = bars[i].close;
      const slDist = atr ? atr * cfg_.a : entry * 0.015;
      const sl = dir === 1 ? entry - slDist : entry + slDist;
      const tp = dir === 1 ? entry + cfg.rr * slDist : entry - cfg.rr * slDist;

      let outcome = 'OPEN', r = 0, mfe = 0, mae = 0;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j];
        if (dir === 1) {
          mfe = Math.max(mfe, b.high / entry - 1);
          mae = Math.min(mae, b.low / entry - 1);
          if (b.low <= sl) { outcome = 'SL'; r = -1; break; }
          if (b.high >= tp) { outcome = 'TP'; r = cfg.rr; break; }
        } else {
          mfe = Math.max(mfe, entry / b.low - 1);
          mae = Math.min(mae, entry / b.high - 1);
          if (b.high >= sl) { outcome = 'SL'; r = -1; break; }
          if (b.low <= tp) { outcome = 'TP'; r = cfg.rr; break; }
        }
      }
      trades.push({ dir, outcome, r, mfe, mae });
      i += HOLD; // avoid re-entering immediately on same signal
    } else {
      i += 1;
    }
  }
  if (!trades.length) return null;
  const n = trades.length;
  const wins = trades.filter((t) => t.outcome === 'TP').length;
  const sls = trades.filter((t) => t.outcome === 'SL').length;
  const open = trades.filter((t) => t.outcome === 'OPEN').length;
  const sumR = trades.reduce((a, t) => a + t.r, 0);
  const decided = n - open;
  const winRate = decided ? (wins / decided) * 100 : 0;
  return { n, wins, sls, open, winRate: +winRate.toFixed(1), sumR: +sumR.toFixed(2), exp: +(sumR / n).toFixed(3) };
}

function combine(rows) {
  if (!rows.length) return null;
  const n = rows.reduce((a, r) => a + r.n, 0);
  const w = rows.reduce((a, r) => a + r.wins, 0);
  const s = rows.reduce((a, r) => a + r.sls, 0);
  const o = rows.reduce((a, r) => a + r.open, 0);
  const sr = rows.reduce((a, r) => a + r.sumR, 0);
  const decided = n - o;
  return {
    n, w, s, o,
    winRate: +(decided ? (w / decided) * 100 : 0).toFixed(1),
    exp: +(sr / n).toFixed(3),
  };
}

if (require.main === module) {
  console.log('=== Tuner: multi-factor strategy ===');
  console.log('exp = average R per trade (positive is profitable). Higher is better.\n');
  const tfs = ['1D', '4H', '1H'];
  for (const tf of tfs) {
    console.log(`--- ${tf} ---`);
    console.log('  thr | bias |  rr |  trades | winRate | exp');
    for (const thresh of [20, 30, 40]) {
      for (const bias of [false, true]) {
        for (const rr of [1.0, 1.5, 2.0, 3.0]) {
          const rows = SYMBOLS.map((s) => runTimeframe(s, tf, { thresh, biasFilter: bias, rr })).filter(Boolean);
          const c = combine(rows);
          if (!c) continue;
          const flag = c.exp > 0.02 ? '  <== WIN' : c.exp < -0.05 ? '  <== LOOSE' : '';
          console.log(`  ${String(thresh).padStart(2)}  | ${String(bias).padStart(4)} | ${String(rr).padStart(4)} | ${String(c.n).padStart(5)} | ${String(c.winRate).padStart(7)}% | ${String(c.exp).padStart(5)}${flag}`);
        }
      }
    }
    console.log('');
  }
}

module.exports = { runTimeframe, combine };
