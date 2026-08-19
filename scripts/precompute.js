const fs = require('fs');
const path = require('path');
const { computeSignals } = require('./tracker');
const { computeEquity, seasonality, annualized } = require('./sim');
const { getAsset } = require('./ta');
const { computeAll, loadLog } = require('./setups');
const { evaluateAll } = require('./setup_backtest');

const WEB = path.join(__dirname, '..', 'web', 'data');
const SYMBOLS = ['AAPL', 'GOOGL', 'AMZN', 'SPY', 'QQQ', 'BTC', 'ETH'];

function write(name, obj) {
  fs.mkdirSync(WEB, { recursive: true });
  fs.writeFileSync(path.join(WEB, name), JSON.stringify(obj), 'utf8');
}

function buildEquity() {
  const final = computeEquity({ AAPL: 0.2, GOOGL: 0.2, AMZN: 0.2, BTC: 0.25, ETH: 0.15 }, true);
  const plain = computeEquity({ AAPL: 0.2, GOOGL: 0.2, AMZN: 0.2, BTC: 0.25, ETH: 0.15 }, false);
  const spy = computeEquity({ SPY: 1 }, false);
  const etf = computeEquity({ SPY: 0.3, QQQ: 0.3, BTC: 0.25, ETH: 0.15 }, true);
  const step = 3;
  const dates = [], f = [], p = [], s = [], e = [];
  for (let i = 0; i < final.n; i += step) {
    dates.push(final.dates[i]);
    f.push(+(final.equity[i] - 1).toFixed(4));
    p.push(+(plain.equity[i] - 1).toFixed(4));
    s.push(+(spy.equity[i] - 1).toFixed(4));
    e.push(+(etf.equity[i] - 1).toFixed(4));
  }
  const calc = (eq) => {
    const total = eq.equity[eq.n - 1] - 1;
    return { total: +total.toFixed(3), ann: +(annualized(total, eq.n) * 100).toFixed(1), maxDD: null };
  };
  return {
    dates, final: f, plain: p, spy: s, etf: e,
    stats: {
      final: calc(final), plain: calc(plain), spy: calc(spy), etf: calc(etf),
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

if (require.main === module) buildAll();
module.exports = { buildAll };