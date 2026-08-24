// Walk-forward backtester for the multi-factor strategy.
// At each closed bar it computes the score (using only prior data) and, when a
// BUY/SELL fires, measures whether entry/SL/TP levels were subsequently hit.
// Prints win-rate / equity / stop-loss stats per timeframe so thresholds can be tuned.

const fs = require('fs');
const path = require('path');
const { indicators, evalAt } = require('./strategy');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const SYMBOLS = ['BTC', 'ETH'];
const TFS = ['1H', '4H', '1D'];

function loadCsv(file) {
  if (!fs.existsSync(file)) return [];
  const txt = fs.readFileSync(file, 'utf8').trim();
  if (!txt) return [];
  const lines = txt.split(/\r?\n/);
  const head = lines[0].split(',');
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  return lines.slice(1).map((l) => {
    const p = l.split(',');
    return {
      t: Date.parse(p[idx.timestamp]),
      open: +p[idx.open],
      high: +p[idx.high],
      low: +p[idx.low],
      close: +p[idx.close],
      volume: +(p[idx.volume] || 0),
    };
  });
}

function analyzeTimeframe(sym, tf) {
  const ext = { '1H': '1h', '4H': '4h', '1D': '1d' }[tf] || '1h';
  const file = `${sym}_${ext}.csv`;
  return loadCsv(path.join(RAW, file)).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.close));
}

function resample4h(rows) {
  const HOUR = 3600 * 1000;
  const bucket = 4 * HOUR;
  const out = [];
  let cur = null;
  for (const r of rows) {
    const b = Math.floor(r.t / bucket) * bucket;
    if (!cur || cur.t !== b) {
      if (cur) out.push(cur);
      cur = { t: b, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume || 0 };
    } else {
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
      cur.close = r.close;
      cur.volume += r.volume || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const TF_CFG = {
  '1H': { atr: 1.2, maxRisk: 3 },
  '4H': { atr: 1.4, maxRisk: 5 },
  '1D': { atr: 1.8, maxRisk: 8 },
};

function run(sym, tf, threshold) {
  const bars = analyzeTimeframe(sym, tf);
  if (bars.length < 100) return null;
  const ind = indicators(bars);
  let longs = 0, shorts = 0, winsR = 0, slHits = 0, wins = 0;
  let capital = 1;
  let startIdx = 210; // warmup for MA200 + ADX
  for (let i = startIdx; i < bars.length; i++) {
    const e = evalAt(bars, i, ind);
    if (Math.abs(e.score) < threshold) continue;
    const dir = e.score > 0 ? 1 : -1;
    const cfg = TF_CFG[tf];
    const atr = ind.atr[i];
    const entry = bars[i].close;
    const slDist = atr ? atr * cfg.atr : entry * 0.015;
    const stop = dir === 1 ? entry - slDist : entry + slDist;
    const tp = dir === 1 ? entry + 2 * slDist : entry - 2 * slDist; // TP2 (1R)

    // walk forward from next bar
    let outcome = 'OPEN';
    let mfe = 0, mae = 0;
    for (let j = i + 1; j < bars.length; j++) {
      const b = bars[j];
      if (dir === 1) {
        mfe = Math.max(mfe, b.high / entry - 1);
        mae = Math.min(mae, b.low / entry - 1);
        if (b.low <= stop) { outcome = 'SL'; break; }
        if (b.high >= tp) { outcome = 'TP'; break; }
      } else {
        mfe = Math.max(mfe, entry / b.low - 1);
        mae = Math.min(mae, entry / b.high - 1);
        if (b.high >= stop) { outcome = 'SL'; break; }
        if (b.low <= tp) { outcome = 'TP'; break; }
      }
    }
    if (dir === 1) longs++; else shorts++;
    if (outcome === 'TP') { winsR += 1; wins++; }
    else if (outcome === 'SL') slHits++;
  }
  const trades = longs + shorts;
  const decided = wins + slHits;
  const winRate = decided ? (wins / decided) * 100 : 0;
  return { sym, tf, threshold, trades, longs, shorts, wins, slHits, winRate: +winRate.toFixed(1) };
}

if (require.main === module) {
  console.log('=== Multi-factor strategy walk-forward backtest ===');
  console.log('(warmup=210 bars; TP at 1R; SL at 1R; entry=close of signal bar)\n');
  for (const tf of TFS) {
    for (const threshold of [25, 35, 45]) {
      const       rows = SYMBOLS.map((s) => run(s, tf, threshold)).filter(Boolean);
      if (!rows.length) continue;
      const tg = rows.reduce((a, r) => a + r.trades, 0);
      const tw = rows.reduce((a, r) => a + r.wins, 0);
      const ts = rows.reduce((a, r) => a + r.slHits, 0);
      const wr = tw + ts ? (tw / (tw + ts) * 100).toFixed(1) : 'n/a';
      const detail = rows.map((r) => `${r.sym}:${r.trades}tr ${r.winRate}%`).join('  ');
      console.log(`${tf.padEnd(3)} thr=${threshold}  total=${String(tg).padStart(3)}  win=${String(tw).padStart(3)}  SL=${String(ts).padStart(3)}  winRate=${wr}%   ${detail}`);
    }
    console.log('');
  }
}

module.exports = { run };
