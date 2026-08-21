const fs = require('fs');
const path = require('path');
const { getAsset } = require('./ta');

const LIVE = path.join(__dirname, '..', 'data', 'live');
const LOG_FILE = path.join(LIVE, 'setup_log.json');
const STATE_FILE = path.join(LIVE, 'stamp_state.json');
const SYMBOLS = ['BTC', 'ETH'];
const TFS = ['1H', '4H', '1D', '1M'];

function loadLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function appendLog(sym, tf, setup, lastBarT) {
  const log = loadLog();
  const state = loadState();
  state[sym] = state[sym] || {};
  if (state[sym][tf] === lastBarT) return false;
  log[sym] = log[sym] || {};
  log[sym][tf] = log[sym][tf] || [];
  log[sym][tf].push({
    time: lastBarT,
    tf,
    type: setup.type,
    entry: setup.entry,
    stopLoss: setup.stopLoss,
    tp1: setup.tp1,
    tp2: setup.tp2,
    tp3: setup.tp3,
    trigger: setup.trigger,
  });
  if (log[sym][tf].length > 60) log[sym][tf].shift();
  state[sym][tf] = lastBarT;
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return true;
}

const INTERVALS = { '1H': 3600000, '4H': 14400000, '1D': 86400000, '1M': 2592000000 };

function computeAll() {
  const out = {};
  const changes = [];
  const now = Date.now();
  for (const sym of SYMBOLS) {
    const a = getAsset(sym);
    out[sym] = { name: a.name, updated: a.updated, timeframes: {} };
    for (const tf of TFS) {
      const bars = a.timeframes[tf].bars;
      const closedBarT = bars && bars.length >= 2 ? bars[bars.length - 2].t : 0;
      if (!closedBarT || (now - closedBarT) < INTERVALS[tf]) {
        out[sym].timeframes[tf] = a.timeframes[tf].setup;
        continue;
      }
      const setup = a.timeframes[tf].setup;
      out[sym].timeframes[tf] = setup;
      if (appendLog(sym, tf, setup, closedBarT)) changes.push(sym + ' ' + tf + ' -> ' + setup.type + ' (bar ' + new Date(closedBarT).toISOString() + ')');
    }
  }
  fs.mkdirSync(LIVE, { recursive: true });
  fs.writeFileSync(path.join(LIVE, 'setups.json'), JSON.stringify(out, null, 2), 'utf8');
  return { setups: out, changes, logs: loadLog() };
}

if (require.main === module) {
  const r = computeAll();
  console.log('Setups computed:', new Date().toISOString());
  for (const c of r.changes) console.log('  NEW LOG:', c);
  for (const sym of SYMBOLS) {
    const tfs = r.setups[sym].timeframes;
    const line = TFS.map(function (tf) { return tf + ':' + tfs[tf].type; }).join(' | ');
    console.log('  ' + sym.padEnd(6) + ' ' + line);
  }
}

module.exports = { computeAll, loadLog };
