const fs = require('fs');
const path = require('path');
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
  const plain = computeEquity({ BTC: 0.55, ETH: 0.45 });
  const btc = computeEquity({ BTC: 1 });
  const eth = computeEquity({ ETH: 1 });
  const step = 3;
  const dates = [], p = [], b = [], e = [];
  for (let i = 0; i < plain.n; i += step) {
    dates.push(plain.dates[i]);
    p.push(+(plain.equity[i] - 1).toFixed(4));
    b.push(+(btc.equity[i] - 1).toFixed(4));
    e.push(+(eth.equity[i] - 1).toFixed(4));
  }
  const calc = (eq) => {
    const total = eq.equity[eq.n - 1] - 1;
    let peak = eq.equity[0], maxDD = 0;
    for (const v of eq.equity) {
      if (v > peak) peak = v;
      const dd = peak > 0 ? (v - peak) / peak : 0;
      if (dd < maxDD) maxDD = dd;
    }
    return { total: +total.toFixed(3), ann: +(annualized(total, eq.n) * 100).toFixed(1), maxDD: +maxDD.toFixed(3) };
  };
  return {
    dates, plain: p, btc: b, eth: e,
    from: plain.dates[0] || null,
    to: plain.dates[plain.n - 1] || null,
    stats: {
      plain: calc(plain), btc: calc(btc), eth: calc(eth),
    },
    seasonality: seasonality(),
  };
}

function buildAll() {
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