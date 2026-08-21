const { RAW, loadCsv, closes, sma, rsi } = require('./lib');
const path = require('path');

const ASSETS = {
  BTC: { name: 'Bitcoin', file: 'BTC_1d.csv' },
  ETH: { name: 'Ethereum', file: 'ETH_1d.csv' },
};

function momentumState(rows, hiLookback, maExit, skipMonths) {
  const c = closes(rows);
  const ma = sma(c, maExit);
  const r = rsi(c, 14);
  let inPos = 0;
  const trail = [];
  for (let i = 0; i < c.length; i++) {
    if (i >= hiLookback) {
      const win = c.slice(i - hiLookback, i);
      const month = parseInt(rows[i].timestamp.slice(5, 7), 10);
      if (!inPos && c[i] > Math.max(...win) && !skipMonths.includes(month)) inPos = 1;
      if (inPos && (c[i] < ma[i] || skipMonths.includes(month))) inPos = 0;
    }
    trail.push(inPos);
  }
  const last = rows[rows.length - 1];
  const month = parseInt(last.timestamp.slice(5, 7), 10);
  const i = rows.length - 1;
  const hi252 = i >= hiLookback ? Math.max(...c.slice(i - hiLookback, i)) : null;
  return {
    inPos: trail[trail.length - 1],
    month,
    price: c[c.length - 1],
    date: last.timestamp.slice(0, 10),
    ma20: ma[i],
    hi252,
    rsi: r[i],
    entryWas: null,
  };
}

function computeSignals() {
  const now = new Date().toISOString();
  const month = new Date().getUTCMonth() + 1;
  const signals = [];

  for (const sym of ['BTC', 'ETH']) {
    const a = ASSETS[sym];
    const rows = loadCsv(path.join(RAW, a.file)).filter((r) => r.close !== null);
    const st = momentumState(rows, 252, 20, [6]);
    const isJune = month === 6;
    let signal;
    let detail;
    if (isJune) {
      signal = 'OUT';
      detail = 'Rule 3: never hold in June';
    } else if (st.inPos) {
      signal = 'LONG';
      detail = `Momentum active (above 20d MA ${st.ma20 ? st.ma20.toFixed(0) : 'n/a'})`;
    } else {
      signal = 'OUT';
      detail = `Waiting: buy only on a 252d-high breakout${st.hi252 ? ' (current 252d high ' + st.hi252.toFixed(0) + ')' : ''}`;
    }
    signals.push({
      symbol: sym,
      name: a.name,
      price: st.price,
      date: st.date,
      signal,
      detail,
      ma20: st.ma20,
      hi252: st.hi252,
      rsi: st.rsi ? st.rsi.toFixed(1) : 'n/a',
    });
  }

  const active = signals.filter((s) => s.signal === 'LONG' || s.signal.startsWith('LONG')).map((s) => s.symbol);
  const out = {
    updatedAt: now,
    month,
    signals,
    portfolio: {
      active: active.length,
      note:
        month === 9
          ? 'September: stocks are out of the market by rule 1'
          : month === 6
            ? 'June: crypto is out of the market by rule 3'
            : 'All rules applied - no calendar filter active',
    },
  };
  return out;
}

if (require.main === module) {
  const out = computeSignals();
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'data', 'live');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'signals.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('Signals updated:', out.updatedAt);
  for (const s of out.signals) {
    console.log(`  ${s.symbol.padEnd(6)} ${String(s.signal).padEnd(18)} $${typeof s.price === 'number' ? s.price.toFixed(2) : s.price} | ${s.detail}`);
  }
}

module.exports = { computeSignals };
