const fs = require('fs');
const path = require('path');
const { loadCsv, validRows, analyze, computeSetup, resample } = require('./ta');
const { loadLog } = require('./setups');

const LIVE = path.join(__dirname, '..', 'data', 'live');
const RAW = path.join(__dirname, '..', 'data', 'raw');
const LOG_FILE = path.join(LIVE, 'setup_log.json');
const SYMBOLS = ['AAPL', 'GOOGL', 'AMZN', 'SPY', 'QQQ', 'BTC', 'ETH'];
const START = Date.parse('2026-08-19T04:00:00.000Z');
const HOUR = 3600e3;

const log = loadLog();
let added = 0;

for (const sym of SYMBOLS) {
  const hourly = validRows(loadCsv(path.join(RAW, sym + '_1h.csv')));
  const daily = validRows(loadCsv(path.join(RAW, sym + '_1d.csv')));
  if (!hourly.length || !daily.length) { console.log('no data for', sym); continue; }
  log[sym] = log[sym] || {};
  for (const tf of ['1H', '4H', '1D']) {
    const src = tf === '1D' ? daily.slice(-2200) : hourly.slice(-2200);
    const bars = tf === '4H' ? resample(src, 4 * HOUR) : src;
    log[sym][tf] = [];
    for (let i = 0; i < bars.length; i++) {
      const t = bars[i].t;
      if (Date.parse(t) < START) continue;
      try {
        const tfData = analyze(bars.slice(0, i + 1), tf);
        const setup = computeSetup(tfData);
        log[sym][tf].push({
          time: t,
          tf,
          type: setup.type,
          entry: setup.entry,
          stopLoss: setup.stopLoss,
          tp1: setup.tp1,
          tp2: setup.tp2,
          tp3: setup.tp3,
          trigger: setup.trigger,
        });
        added++;
      } catch (e) {
        console.log('skip', sym, tf, t, e.message);
      }
    }
    if (log[sym][tf].length > 60) log[sym][tf] = log[sym][tf].slice(-60);
  }
}

fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
console.log('backfill done, added', added, 'entries');
for (const sym of SYMBOLS) {
  const line = ['1H', '4H', '1D'].map((tf) => `${tf}:${((log[sym] && log[sym][tf]) || []).length}`).join(' | ');
  console.log(`  ${sym.padEnd(6)} ${line}`);
}