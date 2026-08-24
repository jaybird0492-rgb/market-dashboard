const fs = require('fs');
const { loadCsv, sma, rsi, mean } = require('./lib');
const { buildSetup, indicators, evalAt } = require('./strategy');
const path = require('path');

const RAW = path.join(__dirname, '..', 'data', 'raw');

function fmtPrice(v) {
  if (v === null || v === undefined) return 'n/a';
  const digits = v >= 10000 ? 0 : v >= 100 ? 2 : 4;
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function validRows(rows) {
  return rows
    .filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return Number.isFinite(t) && r.close !== null;
    })
    .map((r) => ({
      t: new Date(r.timestamp).getTime(),
      open: r.open ?? r.close,
      high: r.high ?? r.close,
      low: r.low ?? r.close,
      close: r.close,
      volume: r.volume ?? 0,
    }));
}

// ---------- Resampling ----------
function resample(rows, bucketMs) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const b = Math.floor(r.t / bucketMs) * bucketMs;
    const o = r.open ?? r.close;
    const h = r.high ?? r.close;
    const l = r.low ?? r.close;
    if (!cur || cur.t !== b) {
      if (cur) out.push(cur);
      cur = { t: b, open: o, high: h, low: l, close: r.close, volume: r.volume ?? 0 };
    } else {
      cur.high = Math.max(cur.high, h);
      cur.low = Math.min(cur.low, l);
      cur.close = r.close;
      cur.volume += r.volume ?? 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function resampleMonth(rows) {
  const out = [];
  let cur = null;
  let curKey = null;
  for (const r of rows) {
    const d = new Date(r.t);
    const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    const o = r.open ?? r.close;
    const h = r.high ?? r.close;
    const l = r.low ?? r.close;
    if (!cur || curKey !== key) {
      if (cur) out.push(cur);
      cur = { t: new Date(key + '-01T00:00:00Z').getTime(), open: o, high: h, low: l, close: r.close, volume: r.volume ?? 0 };
      curKey = key;
    } else {
      cur.high = Math.max(cur.high, h);
      cur.low = Math.min(cur.low, l);
      cur.close = r.close;
      cur.volume += r.volume ?? 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- Indicators ----------
function atrSeries(bars, period = 14) {
  const trs = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trs.push(bars[i].high - bars[i].low);
      continue;
    }
    const pc = bars[i - 1].close;
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
  }
  return sma(trs, period);
}

function swings(bars, w = 2) {
  const highs = [];
  const lows = [];
  for (let i = w; i < bars.length - w; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (bars[j].high > bars[i].high) isH = false;
      if (bars[j].low < bars[i].low) isL = false;
    }
    if (isH) highs.push({ idx: i, price: bars[i].high });
    if (isL) lows.push({ idx: i, price: bars[i].low });
  }
  return { highs, lows };
}

function structure(bars) {
  const { highs, lows } = swings(bars, 2);
  const recentH = highs.filter((h) => h.idx >= bars.length - 40);
  const recentL = lows.filter((l) => l.idx >= bars.length - 40);
  if (recentH.length >= 2 && recentL.length >= 2) {
    const hUp = recentH[recentH.length - 1].price > recentH[0].price;
    const lUp = recentL[recentL.length - 1].price > recentL[0].price;
    if (hUp && lUp) return 'uptrend';
    if (!hUp && !lUp) return 'downtrend';
  }
  return 'ranging';
}

// ---------- Per-timeframe analysis ----------
function analyze(bars, tf) {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const last = n - 1;
  const price = closes[last];
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const r = rsi(closes, 14);
  const a = atrSeries(bars, 14);

  const chg1 = n > 1 ? closes[last] / closes[last - 1] - 1 : null;
  const chg3 = n > 4 ? closes[last] / closes[last - 3] - 1 : null;
  const chg10 = n > 11 ? closes[last] / closes[last - 10] - 1 : null;

  const { highs, lows } = swings(bars, 2);
  const winHighs = highs.filter((h) => h.idx >= n - 60);
  const winLows = lows.filter((l) => l.idx >= n - 60);
  let resist = null;
  let support = null;
  for (const h of winHighs) {
    if (h.price > price * 1.001 && (!resist || h.price < resist)) resist = h.price;
  }
  for (const l of winLows) {
    if (l.price < price * 0.999 && (!support || l.price > support)) support = l.price;
  }

  const st = structure(bars);
  const rsiV = r[last];
  let verdict = 'NO TRADE';
  let text = '';

  const chartBars = bars.slice(-130);
  const chartN = chartBars.length;
  const chartMa20 = ma20.slice(-130);
  const chartMa50 = ma50.slice(-130);

  if (st === 'uptrend') {
    if (rsiV !== null && rsiV > 70) {
      verdict = 'WATCH';
      text = `Uptrend but RSI ${rsiV.toFixed(0)} is overbought on ${tf}. No chasing — wait for a pullback toward MA20 (${fmtPrice(ma20[last])}) or a clean break above ${resist ? fmtPrice(resist) : 'the last high'} (${resist ? ((resist / price - 1) * 100).toFixed(1) + '% away' : ''}).`;
    } else if (resist) {
      verdict = 'BUY SETUP';
      text = `Uptrend on ${tf}. Long on pullbacks toward MA20 (${fmtPrice(ma20[last])}) or on a breakout above resistance ${fmtPrice(resist)} (${((resist / price - 1) * 100).toFixed(1)}% away). Stop below ${support ? fmtPrice(support) : 'the recent swing low'}.`;
    } else {
      verdict = 'BUY SETUP';
      text = `Uptrend on ${tf} with no nearby resistance — trend is running. Buy pullbacks toward MA20 (${fmtPrice(ma20[last])}), stop below MA50.`;
    }
  } else if (st === 'downtrend') {
    if (support) {
      verdict = 'NO TRADE';
      text = `Downtrend on ${tf}. No longs. Watch ${fmtPrice(support)} (${((price / support - 1) * 100).toFixed(1)}% below price): a breakdown confirms continuation; a hold there could set up a bounce watch.`;
    } else {
      verdict = 'NO TRADE';
      text = `Downtrend on ${tf} making fresh lows — stay out until structure turns.`;
    }
  } else {
    if (support && resist) {
      verdict = 'WATCH';
      text = `Ranging on ${tf} between ${fmtPrice(support)} and ${fmtPrice(resist)}. Trade the range only if you like the risk; the clean play is a breakout above ${fmtPrice(resist)} (long) or below ${fmtPrice(support)} (avoid/short).`;
    } else {
      verdict = 'WATCH';
      text = `Ranging on ${tf} with no clear levels yet — wait for a directional break.`;
    }
  }

  const maState =
    ma200[last] !== null
      ? price > ma200[last]
        ? 'above'
        : 'below'
      : 'n/a';

  return {
    tf,
    bars: chartBars.map((b, i) => ({
      t: new Date(b.t).toISOString().slice(0, 19) + 'Z',
      o: +b.open.toFixed(2),
      h: +b.high.toFixed(2),
      l: +b.low.toFixed(2),
      c: +b.close.toFixed(2),
      v: b.volume ?? 0,
    })),
    ma20Series: chartMa20.map((v) => (v === null ? null : +v.toFixed(2))),
    ma50Series: chartMa50.map((v) => (v === null ? null : +v.toFixed(2))),
    price,
    change1: chg1,
    change3: chg3,
    change10: chg10,
    ma20: ma20[last],
    ma50: ma50[last],
    ma200: ma200[last],
    maState,
    rsi: rsiV,
    atrPct: a[last] ? (a[last] / price) * 100 : null,
    support,
    resistance: resist,
    structure: st,
    verdict,
    text,
  };
}

// ---------- Trade setup generation (multi-factor) ----------
const TF_CONFIG = {
  '1H': { maxEntryPct: 3, swingWindow: 2 },
  '4H': { maxEntryPct: 5, swingWindow: 3 },
  '1D': { maxEntryPct: 10, swingWindow: 5 },
};

// 1D bias from the multi-factor score: LONG >= +20, SHORT <= -20, else NEUTRAL.
function getBias(analysis) {
  const score = analysis && analysis.setup ? analysis.setup.score : 0;
  if (score >= 20) return 'LONG';
  if (score <= -20) return 'SHORT';
  return 'NEUTRAL';
}

// Build a setup for a timeframe from its raw bars (Kraken shape with t/high/low/close).
// `t` is the analyze() result (used for price/chart data); bars are passed in so the
// strategy engine can compute indicators over the full series.
function computeSetup(t, bias, bars) {
  if (!bars || !bars.length) {
    return { type: 'NONE', entry: null, stopLoss: null, tp1: null, tp2: null, tp3: null, rr: '-', risk: '-', trigger: 'No data', text: 'No data available.' };
  }
  return buildSetup(bars, t.tf, bias);
}

// ---------- Asset assembly ----------
const DAILY_FILES = {
  BTC: 'BTC_1d.csv', ETH: 'ETH_1d.csv',
};
const NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum',
};
const HOUR = 3600e3;
const DAY = 24 * HOUR;

function getAsset(sym) {
  sym = sym.toUpperCase();
  if (!DAILY_FILES[sym]) return null;
  const dailyPath = path.join(RAW, DAILY_FILES[sym]);
  const hourlyPath = path.join(RAW, sym + '_1h.csv');
  if (!fs.existsSync(dailyPath) || !fs.existsSync(hourlyPath)) return null;
  const daily = validRows(loadCsv(dailyPath));
  const hourly = validRows(loadCsv(hourlyPath));
  if (!daily.length || !hourly.length) return null;

  const bars1H = hourly.slice(-2200);
  const bars4H = resample(hourly.slice(-2200), 4 * HOUR);
  const bars1D = daily.slice(-2200);

  const tfs = {
    '1H': analyze(bars1H, '1H'),
    '4H': analyze(bars4H, '4H'),
    '1D': analyze(bars1D, '1D'),
  }

  // Compute the 1D setup first so its score can set the directional bias.
  tfs['1D'].setup = computeSetup(tfs['1D'], 'NEUTRAL', bars1D);
  const bias = getBias(tfs['1D']);
  tfs['1D'].bias = bias;
  tfs['4H'].setup = computeSetup(tfs['4H'], bias, bars4H);
  tfs['1H'].setup = computeSetup(tfs['1H'], bias, bars1H);

  return {
    symbol: sym,
    name: NAMES[sym],
    updated: new Date(daily[daily.length - 1].t).toISOString().slice(0, 10),
    bias,
    timeframes: tfs,
  };
}

module.exports = { getAsset, resample, resampleMonth, analyze, computeSetup, getBias, validRows, loadCsv, swings, fmtPrice, TF_CONFIG };
