const http = require('http');
const fs = require('fs');
const path = require('path');
const { computeEquity, seasonality, annualized } = require('./scripts/sim');
const { getAsset } = require('./scripts/ta');
const { computeAll, loadLog } = require('./scripts/setups');
const { evaluateAll } = require('./scripts/setup_backtest');

const ROOT = __dirname;
const WEB = path.join(ROOT, 'web');
const PORT = process.env.PORT || 8899;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let equityCache = null;
const assetCache = {};
let setupsCache = null;

function getEquity() {
  if (equityCache) return equityCache;
  const plain = computeEquity({ BTC: 0.55, ETH: 0.45 });
  const btc = computeEquity({ BTC: 1 });
  const eth = computeEquity({ ETH: 1 });
  // sample every 3rd point to keep payload small
  const step = 3;
  const dates = [];
  const p = [];
  const b = [];
  const e = [];
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
  equityCache = {
    dates, plain: p, btc: b, eth: e,
    from: plain.dates[0] || null,
    to: plain.dates[plain.n - 1] || null,
    stats: {
      plain: calc(plain), btc: calc(btc), eth: calc(eth),
    },
    seasonality: seasonality(),
  };
  return equityCache;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/equity') {
    const data = getEquity();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
    return;
  }
  if (pathname === '/api/refresh') {
    equityCache = null;
    setupsCache = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }));
    return;
  }
  if (pathname === '/api/setups') {
    if (!setupsCache) setupsCache = computeAll();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      updatedAt: new Date().toISOString(),
      setups: setupsCache.setups,
      logs: setupsCache.logs,
    }));
    return;
  }
  if (pathname === '/api/asset') {
    const sym = (url.searchParams.get('symbol') || '').toUpperCase();
    if (!assetCache[sym]) {
      assetCache[sym] = getAsset(sym);
    }
    const data = assetCache[sym];
    if (!data) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown symbol: ' + sym }));
      return;
    }
    const logs = loadLog();
    data.logs = logs[sym] || {};
    data.backtest = evaluateAll(sym);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
    return;
  }

  let file = path.join(WEB, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Dashboard running: http://localhost:${PORT}`);
});
