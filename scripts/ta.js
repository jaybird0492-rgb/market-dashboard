const { loadCsv, sma, rsi, mean } = require('./lib');
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

// ---------- Trade setup generation ----------
const MAX_ENTRY_PCT = 5;

function computeSetup(t) {
  const atrFrac = t.atrPct !== null ? t.atrPct / 100 : 0.01;
  const now = new Date().toISOString();
  const r2 = (v) => (v === null || v === undefined ? null : +v.toFixed(2));
  const base = { updatedAt: now, tf: t.tf, parts: 'TP1 40% / TP2 40% / TP3 20%' };

  if (t.structure === 'uptrend') {
    if (t.rsi !== null && t.rsi > 75) {
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
        trigger: `Wait for pullback to MA20 (${fmtPrice(t.ma20)})`,
        text: `Uptrend on ${t.tf} but RSI ${t.rsi.toFixed(0)} is overbought — no fresh entry. Wait for a pullback toward MA20 (${fmtPrice(t.ma20)}) before starting a new long. Existing positions: trail the stop.`,
      };
    }
    const entry = t.resistance || t.price * (1 + atrFrac);
    const stop = t.support || t.price * (1 - 1.5 * atrFrac);
    const distPct = ((entry / t.price - 1) * 100);
    if (distPct > MAX_ENTRY_PCT) {
      const levelDesc = t.resistance
        ? `nearest resistance (${fmtPrice(t.resistance)})`
        : `ATR-based entry level (${fmtPrice(entry)})`;
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
        trigger: `Entry ${distPct.toFixed(1)}% above price — too far for a clean setup`,
        text: `Uptrend on ${t.tf} but the ${levelDesc} is ${distPct.toFixed(1)}% above the current price (${fmtPrice(t.price)}). Entry would be too far away — wait for price to move closer or for a tighter swing structure to form.`,
      };
    }
    const R = Math.abs(entry - stop);
    const tp1 = entry + R;
    const tp2 = entry + 2 * R;
    const tp3 = entry + 3 * R;
    return {
      ...base,
      type: 'BUY',
      entry: r2(entry),
      stopLoss: r2(stop),
      tp1: r2(tp1),
      tp2: r2(tp2),
      tp3: r2(tp3),
      rr: '1:1 / 1:2 / 1:3',
      risk: ((R / entry) * 100).toFixed(2) + '%',
      trigger: t.resistance
        ? `Buy when a ${t.tf} candle CLOSES above resistance ${fmtPrice(t.resistance)}`
        : `Buy on pullback toward MA20 ${fmtPrice(t.ma20)}`,
      text: `LONG ${t.tf}: entry ${fmtPrice(entry)} — trigger: ${t.resistance ? `close above ${fmtPrice(t.resistance)}` : `pullback to MA20 (${fmtPrice(t.ma20)})`}. Stop ${fmtPrice(stop)} (${((R / entry) * 100).toFixed(2)}% risk). Targets: TP1 ${fmtPrice(tp1)} (take 40%), TP2 ${fmtPrice(tp2)} (take 40%), TP3 ${fmtPrice(tp3)} (take 20%).`,
    };
  }

  if (t.structure === 'downtrend') {
    if (t.rsi !== null && t.rsi < 25) {
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
        trigger: `Wait for a bounce toward MA20 (${fmtPrice(t.ma20)})`,
        text: `Downtrend on ${t.tf} but RSI ${t.rsi.toFixed(0)} is oversold — no fresh short here. Wait for a bounce toward MA20 (${fmtPrice(t.ma20)}) to short with better entry.`,
      };
    }
    const entry = t.support || t.price * (1 - atrFrac);
    const stop = t.resistance || t.price * (1 + 1.5 * atrFrac);
    const distPct = ((t.price - entry) / t.price * 100);
    if (distPct > MAX_ENTRY_PCT) {
      const levelDesc = t.support
        ? `nearest support (${fmtPrice(t.support)})`
        : `ATR-based entry level (${fmtPrice(entry)})`;
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
        trigger: `Entry ${distPct.toFixed(1)}% below price — too far for a clean setup`,
        text: `Downtrend on ${t.tf} but the ${levelDesc} is ${distPct.toFixed(1)}% below the current price (${fmtPrice(t.price)}). Entry would be too far away — wait for price to move closer or for a tighter swing structure to form.`,
      };
    }
    const R = Math.abs(stop - entry);
    const tp1 = entry - R;
    const tp2 = entry - 2 * R;
    const tp3 = entry - 3 * R;
    return {
      ...base,
      type: 'SELL',
      entry: r2(entry),
      stopLoss: r2(stop),
      tp1: r2(tp1),
      tp2: r2(tp2),
      tp3: r2(tp3),
      rr: '1:1 / 1:2 / 1:3',
      risk: ((R / entry) * 100).toFixed(2) + '%',
      trigger: t.support
        ? `Sell when a ${t.tf} candle CLOSES below support ${fmtPrice(t.support)}`
        : `Sell on bounce toward MA20 ${fmtPrice(t.ma20)}`,
      text: `SHORT ${t.tf}: entry ${fmtPrice(entry)} — trigger: ${t.support ? `close below ${fmtPrice(t.support)}` : `bounce to MA20 (${fmtPrice(t.ma20)})`}. Stop ${fmtPrice(stop)} (${((R / entry) * 100).toFixed(2)}% risk). Targets: TP1 ${fmtPrice(tp1)} (40%), TP2 ${fmtPrice(tp2)} (40%), TP3 ${fmtPrice(tp3)} (20%).`,
    };
  }

  if (t.support && t.resistance) {
    const rangeWidth = ((t.resistance / t.support - 1) * 100).toFixed(1);
    return {
      ...base,
      type: 'RANGE',
      entry: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null,
      rr: '-',
      risk: '-',
      trigger: `No trade until price breaks ${fmtPrice(t.resistance)} (long) or ${fmtPrice(t.support)} (short)`,
      text: `RANGING on ${t.tf} between ${fmtPrice(t.support)} and ${fmtPrice(t.resistance)} (${rangeWidth}% range) — no entry yet. Wait for a close above ${fmtPrice(t.resistance)} or below ${fmtPrice(t.support)} for a directional setup.`,
    };
  }

  return {
    ...base,
    type: 'NONE',
    entry: null,
    stopLoss: null,
    tp1: null,
    tp2: null,
    tp3: null,
    rr: '-',
    risk: '-',
    trigger: 'Wait for structure to form',
    text: `No setup on ${t.tf} yet — not enough swing structure to define levels. Check back on the next update.`,
  };
}

// ---------- Asset assembly ----------
const DAILY_FILES = {
  AAPL: 'AAPL_1d.csv', GOOGL: 'GOOGL_1d.csv', AMZN: 'AMZN_1d.csv',
  SPY: 'SPY_1d.csv', QQQ: 'QQQ_1d.csv', BTC: 'BTC_1d.csv', ETH: 'ETH_1d.csv',
};
const NAMES = {
  AAPL: 'Apple', GOOGL: 'Alphabet', AMZN: 'Amazon',
  SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', BTC: 'Bitcoin', ETH: 'Ethereum',
};
const HOUR = 3600e3;
const DAY = 24 * HOUR;

function getAsset(sym) {
  sym = sym.toUpperCase();
  if (!DAILY_FILES[sym]) return null;
  const daily = validRows(loadCsv(path.join(RAW, DAILY_FILES[sym])));
  const hourly = validRows(loadCsv(path.join(RAW, sym + '_1h.csv')));

  const tfs = {
    '1H': analyze(hourly.slice(-2200), '1H'),
    '4H': analyze(resample(hourly.slice(-2200), 4 * HOUR), '4H'),
    '1D': analyze(daily.slice(-2200), '1D'),
    '1M': analyze(resampleMonth(daily), '1M'),
  };
  for (const tf of Object.keys(tfs)) {
    tfs[tf].setup = computeSetup(tfs[tf]);
  }

  return {
    symbol: sym,
    name: NAMES[sym],
    updated: new Date(daily[daily.length - 1].t).toISOString().slice(0, 10),
    timeframes: tfs,
  };
}

module.exports = { getAsset, resample, resampleMonth, analyze, computeSetup, validRows, loadCsv, swings, fmtPrice, MAX_ENTRY_PCT };
