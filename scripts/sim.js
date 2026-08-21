const { RAW, loadCsv, sma, annualized } = require('./lib');
const path = require('path');

const ASSETS = {
  BTC: 'BTC_1d.csv',
  ETH: 'ETH_1d.csv',
};

let CACHE = null;

function loadAligned() {
  if (CACHE) return CACHE;
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
  const n = C.BTC.length;
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
  for (const s of ['BTC', 'ETH']) {
    const c = closes(bySym[s]);
    const ma = sma(c, 20);
    const pos = [];
    let inPos = 0;
    for (let i = 0; i < c.length; i++) {
      let signal = inPos;
      if (i >= 252) {
        const win = c.slice(i - 252, i);
        const month = parseInt(bySym[s][i].timestamp.slice(5, 7), 10);
        if (!inPos && c[i] > Math.max(...win) && month !== 6) signal = 1;
        if (inPos && (c[i] < ma[i] || month === 6)) signal = 0;
      }
      pos.push(signal);
      inPos = signal;
    }
    const m = new Map(bySym[s].map((r, i) => [r.timestamp.slice(0, 10), pos[i]]));
    O[s] = idx.map((d) => m.get(d) ?? 0);
  }
  CACHE = { idx, rets, O, n };
  return CACHE;
}

function computeEquity(weights, overlays) {
  const { idx, rets, O, n } = loadAligned();
  const equity = new Array(n).fill(1);
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
    equity[i] = equity[i - 1] * (1 + r);
  }
  return { equity, dates: idx, n };
}

function closes(rows) {
  return rows.map((r) => r.close);
}

function seasonality() {
  const { idx, rets, n } = loadAligned();
  const months = {};
  for (let i = 1; i < n; i++) {
    const m = parseInt(idx[i].slice(5, 7), 10);
    if (!months[m]) months[m] = {};
    for (const s of Object.keys(rets)) {
      if (!months[m][s]) months[m][s] = [];
      months[m][s].push(rets[s][i]);
    }
  }
  const out = {};
  for (const s of Object.keys(rets)) {
    out[s] = [];
    for (let m = 1; m <= 12; m++) {
      const arr = (months[m] && months[m][s]) || [];
      out[s].push(arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) * 100 : null);
    }
  }
  return out;
}

module.exports = { loadAligned, computeEquity, seasonality, annualized };
