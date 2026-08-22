const fs = require('fs');
const path = require('path');
const { getAsset } = require('./ta');

const LIVE = path.join(__dirname, '..', 'data', 'live');
const LOG_FILE = path.join(LIVE, 'setup_log.json');
const STATE_FILE = path.join(LIVE, 'stamp_state.json');
const SYMBOLS = ['BTC', 'ETH'];
const TFS = ['1H', '4H', '1D'];

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function loadLog() { return loadJson(LOG_FILE, {}); }

function changed(prev, cur) {
  if (!prev) return true;
  return prev.type !== cur.type || prev.entry !== cur.entry;
}

function appendLog(log, sym, tf, setup, barT) {
  log[sym] = log[sym] || {};
  log[sym][tf] = log[sym][tf] || [];
  log[sym][tf].push({
    time: barT,
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
}

function computeAll() {
  const out = {};
  const changes = [];
  const log = loadLog();
  const state = loadJson(STATE_FILE, {});
  const now = Date.now();

  for (const sym of SYMBOLS) {
    const a = getAsset(sym);
    if (!a) continue;
    out[sym] = { name: a.name, updated: a.updated, timeframes: {} };

    for (const tf of TFS) {
      const analysis = a.timeframes[tf];
      const setup = analysis.setup;
      out[sym].timeframes[tf] = setup;

      const bars = analysis.bars;
      const closedBarT = bars && bars.length >= 2
        ? Date.parse(bars[bars.length - 2].t) || 0
        : 0;

      const stateKey = sym + '_' + tf;
      const prevBarT = state[stateKey] || 0;

      if (closedBarT && closedBarT !== prevBarT) {
        if (changed(state[stateKey] ? { type: state[stateKey].type, entry: state[stateKey].entry } : null, setup)) {
          appendLog(log, sym, tf, setup, closedBarT);
          changes.push(sym + ' ' + tf + ' -> ' + setup.type + ' (bar ' + new Date(closedBarT).toISOString() + ')');
        }
        state[stateKey] = { barT: closedBarT, type: setup.type, entry: setup.entry, updatedAt: setup.updatedAt };
      }
    }
  }

  fs.mkdirSync(LIVE, { recursive: true });
  fs.writeFileSync(path.join(LIVE, 'setups.json'), JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');

  return { setups: out, changes, logs: log };
}

if (require.main === module) {
  const r = computeAll();
  console.log('Setups computed:', new Date().toISOString());
  for (const c of r.changes) console.log('  NEW LOG:', c);
  if (!r.changes.length) console.log('  No changes since last run');
  for (const sym of SYMBOLS) {
    const tfs = r.setups[sym].timeframes;
    const line = TFS.map(function (tf) { return tf + ':' + tfs[tf].type; }).join(' | ');
    console.log('  ' + sym.padEnd(6) + ' ' + line);
  }
}

module.exports = { computeAll, loadLog };
