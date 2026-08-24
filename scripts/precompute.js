const fs = require('fs');
const path = require('path');
const { computeSignals } = require('./tracker');
const { computeEquity, seasonality, annualized } = require('./sim');
const { getAsset } = require('./ta');
const { computeAll, loadLog } = require('./setups');
const { evaluateAll } = require('./setup_backtest');

const WEB = path.join(__dirname, '..', 'web', 'data');
const SYMBOLS = ['BTC', 'ETH'];

function write(name, obj) {
  fs.mkdirSync(WEB, { recursive: true });
  fs.writeFileSync(path.join(WEB, name), JSON.stringify(obj), 'utf8');
}

function buildEquity() {
  const final = computeEquity({ BTC: 0.55, ETH: 0.45 }, true);
  const plain = computeEquity({ BTC: 0.55, ETH: 0.45 }, false);
  const btc = computeEquity({ BTC: 1 }, false);
  const eth = computeEquity({ ETH: 1 }, false);
  const step = 3;
  const dates = [], f = [], p = [], b = [], e = [];
  for (let i = 0; i < final.n; i += step) {
    dates.push(final.dates[i]);
    f.push(+(final.equity[i] - 1).toFixed(4));
    p.push(+(plain.equity[i] - 1).toFixed(4));
    b.push(+(btc.equity[i] - 1).toFixed(4));
    e.push(+(eth.equity[i] - 1).toFixed(4));
  }
  const calc = (eq) => {
    const total = eq.equity[eq.n - 1] - 1;
    return { total: +total.toFixed(3), ann: +(annualized(total, eq.n) * 100).toFixed(1), maxDD: null };
  };
  return {
    dates, final: f, plain: p, btc: b, eth: e,
    stats: {
      final: calc(final), plain: calc(plain), btc: calc(btc), eth: calc(eth),
    },
    seasonality: seasonality(),
  };
}

function buildAll() {
  write('signals.json', computeSignals());
  write('equity.json', buildEquity());
  const setups = computeAll();
  write('setups.json', { updatedAt: new Date().toISOString(), setups: setups.setups, logs: setups.logs });
  for (const sym of SYMBOLS) {
    const data = getAsset(sym);
    if (!data) continue;
    data.logs = loadLog()[sym] || {};
    data.backtest = evaluateAll(sym);
    write('asset_' + sym + '.json', data);
  }
  write('last_updated.json', { time: new Date().toISOString() });
  console.log('Precomputed static data ->', WEB);
}

if (require.main === module) {
  try {
    buildAll();
  } catch (e) {
    console.error('PRECOMPUTE FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}
module.exports = { buildAll };