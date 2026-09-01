// Multi-factor directional scoring engine.
// Produces a numeric score in [-100, +100] per timeframe plus ATR-based
// entry / stop / take-profit levels. Used by ta.js (live setups), setups.js
// (regular signals) and the walk-forward backtester.

const { sma } = require('./lib');

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Full-series indicator arrays (backward-looking; value at index i only
// depends on bars[0..i], so it is safe to evaluate at any point in the past).
function indicators(bars) {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);

  const sma20 = sma(close, 20);
  const sma50 = sma(close, 50);
  const sma200 = sma(close, 200);

  // RSI(14)
  const rsiArr = new Array(n).fill(null);
  if (n > 14) {
    let gain = 0, loss = 0;
    for (let i = 1; i <= 14; i++) {
      const ch = close[i] - close[i - 1];
      if (ch >= 0) gain += ch; else loss -= ch;
    }
    let ag = gain / 14, al = loss / 14;
    rsiArr[14] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = 15; i < n; i++) {
      const ch = close[i] - close[i - 1];
      ag = (ag * 13 + Math.max(ch, 0)) / 14;
      al = (al * 13 + Math.max(-ch, 0)) / 14;
      rsiArr[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }

  // ATR(14)
  const atrArr = new Array(n).fill(null);
  if (n > 0) {
    const tr = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) { tr.push(high[i] - low[i]); continue; }
      const pc = close[i - 1];
      tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - pc), Math.abs(low[i] - pc)));
    }
    // Wilder smoothing
    let prev = null;
    for (let i = 0; i < n; i++) {
      if (i === 14) {
        let s = 0;
        for (let j = 1; j <= 14; j++) s += tr[j];
        prev = s / 14;
        atrArr[14] = prev;
      } else if (i > 14) {
        prev = (prev * 13 + tr[i]) / 14;
        atrArr[i] = prev;
      }
    }
  }

  // ADX(14) with Wilder smoothing
  const adxArr = new Array(n).fill(null);
  const plusDi = new Array(n).fill(null);
  const minusDi = new Array(n).fill(null);
  if (n > 28) {
    const trArr = new Array(n).fill(0);
    const plusArr = new Array(n).fill(0);
    const minusArr = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const up = high[i] - high[i - 1];
      const dn = low[i - 1] - low[i];
      trArr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
      plusArr[i] = up > dn && up > 0 ? up : 0;
      minusArr[i] = dn > up && dn > 0 ? dn : 0;
    }
    // Seeds: Wilder sums over the first 14 values after the initial bar
    let sTr = 0, sPlus = 0, sMinus = 0;
    for (let j = 1; j <= 14; j++) { sTr += trArr[j]; sPlus += plusArr[j]; sMinus += minusArr[j]; }
    let pdi = sTr === 0 ? 0 : 100 * sPlus / sTr;
    let mdi = sTr === 0 ? 0 : 100 * sMinus / sTr;
    const dxs = [];
    let adxAvg = null;
    // Advance from raw index 15 (the 15th true-range value) onward; bar index in loop is i
    for (let i = 15; i < n; i++) {
      const dSum = pdi + mdi;
      const dx = dSum === 0 ? 0 : 100 * Math.abs(pdi - mdi) / dSum;
      dxs.push(dx);
      // bar index for the +DI/-DI belongs to the current i
      plusDi[i] = pdi;
      minusDi[i] = mdi;
      if (dxs.length === 14) {
        adxAvg = dxs.reduce((a, b) => a + b, 0) / 14;
        adxArr[i] = adxAvg;
      } else if (dxs.length > 14) {
        adxAvg = (adxAvg * 13 + dx) / 14;
        adxArr[i] = adxAvg;
      }
      // Wilder smoothing for next iteration
      sTr = (sTr * 13 + trArr[i]) / 14;
      sPlus = (sPlus * 13 + plusArr[i]) / 14;
      sMinus = (sMinus * 13 + minusArr[i]) / 14;
      pdi = sTr === 0 ? 0 : 100 * sPlus / sTr;
      mdi = sTr === 0 ? 0 : 100 * sMinus / sTr;
    }
  }

  return { close, high, low, sma20, sma50, sma200, rsi: rsiArr, atr: atrArr, adx: adxArr, plusDi, minusDi };
}

// Score at index i using only data up to and including i. Returns:
// { score, sign, type, factors } where score in [-100,100], type in
// BUY/SELL/RANGE/WAIT.
function evalAt(bars, i, ind) {
  const { close, high, low, sma20, sma50, sma200, rsi, atr, adx, plusDi, minusDi } = ind;
  const price = close[i];
  const n = bars.length;

  // --- Trend factor (price vs MAs) ---
  let trend = 0;
  if (sma200[i] !== null) {
    const above200 = price >= sma200[i];
    trend += above200 ? 0.5 : -0.5;
    const dist200 = Math.abs(price - sma200[i]) / sma200[i];
    const strength200 = clamp(dist200 / 0.1, 0, 1);
    trend += above200 ? 0.3 * strength200 : -0.3 * strength200;
  }
  if (sma50[i] !== null && sma200[i] !== null) {
    trend += sma50[i] >= sma200[i] ? 0.2 : -0.2;
  }
  if (sma20[i] !== null) {
    if (i >= 5 && sma20[i] !== null && sma20[i - 5] !== null) {
      trend += sma20[i] > sma20[i - 5] ? 0.15 : -0.15;
    }
  }
  trend = clamp(trend, -1, 1);

  // --- Momentum factor (RSI), with entry only in fresh (not exhausted) zones ---
  let mom = 0;
  const r = rsi[i];
  if (r !== null) {
    mom = clamp((r - 50) / 50, -1, 1);
    // fade exhaustion: reduce conviction when strongly overbought/oversold
    if (r > 75) mom *= 0.4;
    else if (r > 65) mom *= 0.8;
    if (r < 25) mom *= 0.4;
    else if (r < 35) mom *= 0.8;
  }

  // --- Directional strength factor (trend quality) ---
  let dir = 0;
  const a = adx[i];
  const pdi = plusDi[i];
  const mdi = minusDi[i];
  if (a !== null && pdi !== null && mdi !== null) {
    const dSum = pdi + mdi;
    const bias = dSum === 0 ? 0 : (pdi - mdi) / dSum; // -1..1
    const strength = clamp(a / 25, 0, 1); // 0 at adx=0, 1 at adx>=25
    dir = bias * strength;
  }

  // --- Structure / breakout factor (price relative to recent range, trailing) ---
  let brk = 0;
  const look = Math.min(50, i);
  if (look >= 10) {
    const hi = Math.max(...high.slice(i - look, i));
    const lo = Math.min(...low.slice(i - look, i));
    const mid = (hi + lo) / 2;
    const range = hi - lo || 1;
    const pos = clamp((price - mid) / (range / 2), -1, 1);
    brk = pos * 0.5;
  }

  // --- Weighted composite ---
  const score = clamp((trend * 0.40 + mom * 0.25 + dir * 0.25 + brk * 0.10) * 100, -100, 100);

  let type;
  if (score >= 5) type = 'BUY';
  else if (score <= -5) type = 'SELL';
  else type = 'WAIT';

  return {
    score: Math.round(score * 10) / 10,
    sign: score >= 5 ? 1 : score <= -5 ? -1 : 0,
    type,
    factors: {
      trend: Math.round(trend * 100) / 100,
      momentum: Math.round(mom * 100) / 100,
      direction: Math.round(dir * 100) / 100,
      structure: Math.round(brk * 100) / 100,
      rsi: r === null ? null : Math.round(r * 10) / 10,
      adx: a === null ? null : Math.round(a * 10) / 10,
    },
  };
}

// Build a full setup object at a given index (defaults to the last bar).
// Mirrors the shape consumed by web + backtester:
// { type, entry, stopLoss, tp1..tp3, rr, risk, trigger, text, score, factors }
function buildSetup(bars, tf, bias, i) {
  const idx = i === undefined ? bars.length - 1 : i;
  const ind = indicators(bars);
  const e = evalAt(bars, idx, ind);
  const price = bars[idx].close;
  const atr = ind.atr[idx];
  const cfg = { '1H': { max: 3, atr: 1.2 }, '4H': { max: 5, atr: 1.4 }, '1D': { max: 8, atr: 1.8 } }[tf] || { max: 5, atr: 1.4 };
  const now = new Date(bars[idx].t).toISOString();
  const r2 = (v) => (v === null || v === undefined ? null : +v.toFixed(2));
  const base = {
    updatedAt: now,
    tf,
    parts: 'TP1 40% / TP2 40% / TP3 20%',
    score: e.score,
    factors: e.factors,
  };
  const atrFrac = atr ? atr / price : 0.012;

  const levelRiskPct = (atrFrac * cfg.atr) * 100;

  const buildTrade = (dir, type) => {
    const entry = price;
    const slDist = atr ? atr * cfg.atr : price * 0.015;
    const stop = dir === 1 ? entry - slDist : entry + slDist;
    const tp1 = dir === 1 ? entry + slDist : entry - slDist;
    const tp2 = dir === 1 ? entry + 2 * slDist : entry - 2 * slDist;
    const tp3 = dir === 1 ? entry + 3 * slDist : entry - 3 * slDist;
    return {
      ...base,
      type,
      entry: r2(entry),
      stopLoss: r2(stop),
      tp1: r2(tp1),
      tp2: r2(tp2),
      tp3: r2(tp3),
      rr: '1:1 / 1:2 / 1:3',
      risk: levelRiskPct.toFixed(2) + '%',
      trigger: dir === 1
        ? `Buy setup: score ${e.score >= 0 ? '+' : ''}${e.score} (${factorNote(e)})`
        : `Sell setup: score ${e.score >= 0 ? '+' : ''}${e.score} (${factorNote(e)})`,
      text: `${type} ${tf}: entry ${fmt(entry)}. Stop ${fmt(stop)} (${levelRiskPct.toFixed(2)}% risk). TP1 ${fmt(tp1)} (40%), TP2 ${fmt(tp2)} (40%), TP3 ${fmt(tp3)} (20%). Score ${e.score >= 0 ? '+' : ''}${e.score}. ${factorNote(e)}`,
    };
  };

  if (e.type === 'BUY') {
    const trade = buildTrade(1, 'BUY');
    if (bias === 'SHORT') {
      trade.trigger += ' — ⚠ against 1D bias';
      trade.text += ' ⚠ against 1D bias (SHORT) — reduce size.';
    }
    return trade;
  }
  if (e.type === 'SELL') {
    const trade = buildTrade(-1, 'SELL');
    if (bias === 'LONG') {
      trade.trigger += ' — ⚠ against 1D bias';
      trade.text += ' ⚠ against 1D bias (LONG) — reduce size.';
    }
    return trade;
  }

  return {
    ...base,
    type: 'WAIT',
    entry: null,
    stopLoss: null,
    tp1: null,
    tp2: null,
    tp3: null,
    rr: '-',
    risk: '-',
    trigger: `Score ${e.score >= 0 ? '+' : ''}${e.score} — ${factorNote(e)}`,
    text: `Waiting on ${tf}: score ${e.score >= 0 ? '+' : ''}${e.score}. ${factorNote(e)} `,
  };
}

function factorNote(e) {
  const f = e.factors;
  const parts = [
    'trend ' + (f.trend >= 0 ? '+' : '') + f.trend,
    'RSI ' + (f.rsi === null ? '-' : f.rsi),
    'ADX ' + (f.adx === null ? '-' : f.adx),
    'dir ' + (f.direction >= 0 ? '+' : '') + f.direction,
  ];
  return parts.join(' · ');
}

function fmt(v) {
  if (v === null || v === undefined) return 'n/a';
  const digits = v >= 10000 ? 0 : v >= 100 ? 2 : 4;
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

module.exports = { indicators, evalAt, buildSetup, clamp };
