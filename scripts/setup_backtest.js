const fs = require('fs');
const path = require('path');
const { resample, resampleMonth } = require('./ta');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const RAW = path.join(__dirname, '..', 'data', 'raw');
const LIVE = path.join(__dirname, '..', 'data', 'live');
const LOG_FILE = path.join(LIVE, 'setup_log.json');
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
      t: Date.parse(p[idx.timestamp] || p[idx.Timestamp] || p[idx.Date]),
      open: +p[idx.open] || +p[idx.Open] || 0,
      high: +p[idx.high] || +p[idx.High] || 0,
      low: +p[idx.low] || +p[idx.Low] || 0,
      close: +p[idx.close] || +p[idx.Close] || 0,
      volume: +(p[idx.volume] || p[idx.Volume] || 0),
    };
  });
}

const barCache = new Map();
function getBars(sym, tf) {
  const key = sym + '|' + tf;
  if (barCache.has(key)) return barCache.get(key);
  const s1d = path.join(RAW, sym + '_1d.csv');
  const s1h = path.join(RAW, sym + '_1h.csv');
  const daily = loadCsv(s1d).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.close));
  const hourly = loadCsv(s1h).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.close));
  const map = {
    '1H': hourly,
    '4H': hourly.length ? resample(hourly, 4 * HOUR) : [],
    '1D': daily,
  };
  barCache.set(key, map[tf] || []);
  return map[tf] || [];
}

function closeRet(long, price, entry) {
  return long ? price / entry - 1 : entry / price - 1;
}

function evaluate(sym, tf, logEntry) {
  const bars = getBars(sym, tf);
  const t0 = new Date(logEntry.time).getTime();
  let start = bars.findIndex((b) => b.t >= t0);
  if (start < 0) return { status: 'PENDING', hit: [], realized: 0, mfe: 0, mae: 0, daysHeld: 0, barsSince: 0, note: 'no bars yet' };
  const long = logEntry.type === 'BUY';
  const entry = logEntry.entry;
  if (entry === null || logEntry.stopLoss === null || logEntry.tp1 === null) {
    return { status: 'NONE', hit: [], realized: 0, mfe: 0, mae: 0, daysHeld: 0, barsSince: 0, note: 'no levels in setup' };
  }
  let tp1 = null, tp2 = null, tp3 = null, sl = null, mfe = 0, mae = 0;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    if (long) {
      mfe = Math.max(mfe, b.high / entry - 1);
      mae = Math.min(mae, b.low / entry - 1);
      if (sl === null && b.low <= logEntry.stopLoss) sl = i;
      if (tp1 === null && b.high >= logEntry.tp1) tp1 = i;
      if (tp2 === null && b.high >= logEntry.tp2) tp2 = i;
      if (tp3 === null && b.high >= logEntry.tp3) tp3 = i;
    } else {
      mfe = Math.max(mfe, entry / b.low - 1);
      mae = Math.min(mae, entry / b.high - 1);
      if (sl === null && b.high >= logEntry.stopLoss) sl = i;
      if (tp1 === null && b.low <= logEntry.tp1) tp1 = i;
      if (tp2 === null && b.low <= logEntry.tp2) tp2 = i;
      if (tp3 === null && b.low <= logEntry.tp3) tp3 = i;
    }
    if (sl !== null) break;
    if (tp3 !== null) break;
  }
  const last = bars[bars.length - 1];
  let realized = 0;
  const hit = [];
  if (tp1 !== null) { realized += 0.4 * closeRet(long, logEntry.tp1, entry); hit.push('TP1'); }
  if (tp2 !== null) { realized += 0.4 * closeRet(long, logEntry.tp2, entry); hit.push('TP2'); }
  if (tp3 !== null) { realized += 0.2 * closeRet(long, logEntry.tp3, entry); hit.push('TP3'); }
  const fracOpen = 1 - (tp1 !== null ? 0.4 : 0) - (tp2 !== null ? 0.4 : 0) - (tp3 !== null ? 0.2 : 0);
  let status;
  if (sl !== null) {
    status = tp1 === null && tp2 === null && tp3 === null ? 'SL' : 'SL_AFTER_TP';
    realized += fracOpen * closeRet(long, logEntry.stopLoss, entry);
  } else if (tp3 !== null) {
    status = 'TP3';
  } else if (tp1 !== null || tp2 !== null) {
    status = 'PARTIAL';
    realized += fracOpen * closeRet(long, last.close, entry);
  } else {
    status = 'OPEN';
    realized += fracOpen * closeRet(long, last.close, entry);
  }
  return {
    status,
    hit: hit.join('+'),
    realized,
    mfe,
    mae,
    daysHeld: (last.t - t0) / DAY,
    barsSince: bars.length - start,
    note: '',
  };
}

function loadLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function evaluateAll(sym) {
  const log = loadLog()[sym] || {};
  const out = {};
  for (const tf of TFS) {
    const entries = (log[tf] || []).filter((e) => e.entry !== null && e.entry !== undefined);
    const deduped = [];
    let prevKey = null;
    for (const e of entries) {
      const key = e.type + '|' + e.entry + '|' + e.stopLoss + '|' + e.tp1 + '|' + e.tp2 + '|' + e.tp3;
      if (key !== prevKey) deduped.push(e);
      prevKey = key;
    }
    const results = deduped.map((e) => ({ entry: e, bt: evaluate(sym, tf, e) }));
    const stats = {
      total: results.length,
      sl: results.filter((r) => r.bt.status === 'SL').length,
      slAfterTp: results.filter((r) => r.bt.status === 'SL_AFTER_TP').length,
      tp1: results.filter((r) => r.bt.hit.includes('TP1')).length,
      tp2: results.filter((r) => r.bt.hit.includes('TP2')).length,
      tp3: results.filter((r) => r.bt.hit.includes('TP3')).length,
      partial: results.filter((r) => r.bt.status === 'PARTIAL').length,
      open: results.filter((r) => r.bt.status === 'OPEN').length,
      pending: results.filter((r) => r.bt.status === 'PENDING').length,
      closed: results.filter((r) => r.bt.status === 'SL' || r.bt.status === 'TP3' || r.bt.status === 'SL_AFTER_TP').length,
      avgRealized: results.length
        ? results.reduce((a, r) => a + r.bt.realized, 0) / results.length
        : 0,
      avgMfe: results.length ? results.reduce((a, r) => a + r.bt.mfe, 0) / results.length : 0,
      avgMae: results.length ? results.reduce((a, r) => a + r.bt.mae, 0) / results.length : 0,
    };
    out[tf] = { stats, results };
  }
  return out;
}

if (require.main === module) {
  let total = 0;
  for (const sym of SYMBOLS) {
    const out = evaluateAll(sym);
    for (const tf of TFS) {
      const s = out[tf].stats;
      total += s.total;
      console.log(
        `${sym.padEnd(6)} ${tf.padEnd(3)} n=${String(s.total).padStart(3)} ` +
          `SL=${s.sl} SLafterTP=${s.slAfterTp} TP1=${s.tp1} TP2=${s.tp2} TP3=${s.tp3} ` +
          `PART=${s.partial} OPEN=${s.open} avgReal=${(s.avgRealized * 100).toFixed(2)}%`
      );
    }
  }
  console.log('Total signals evaluated:', total);
}

module.exports = { evaluateAll, evaluate };