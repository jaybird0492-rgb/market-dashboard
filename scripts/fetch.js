const fs = require('fs');
const path = require('path');
const { resample } = require('./ta');

const DATA_DIR = path.join(__dirname, '..', 'data', 'raw');
fs.mkdirSync(DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'application/json',
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function saveCsv(file, rows) {
  const header = 'timestamp,open,high,low,close,volume';
  const body = rows
    .map((r) => r.map((v) => (v === null || v === undefined ? '' : v)).join(','))
    .join('\n');
  fs.writeFileSync(file, header + '\n' + body + '\n', 'utf8');
  console.log(`Saved ${file} (${rows.length} rows)`);
}

// ---------- Yahoo Finance (stocks) ----------
async function fetchYahoo(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  const data = await fetchJson(url);
  const result = data.chart.result[0];
  const ts = result.timestamp;
  const q = result.indicators.quote[0];
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    rows.push([
      new Date(ts[i] * 1000).toISOString(),
      q.open[i],
      q.high[i],
      q.low[i],
      q.close[i],
      q.volume[i],
    ]);
  }
  return rows;
}

async function fetchStocks() {
  console.log('Stock fetching disabled — only BTC and ETH active');
}
  for (const s of stocks) {
    const daily = await fetchYahoo(s.symbol, '1d', '10y');
    saveCsv(path.join(DATA_DIR, `${s.symbol}_1d.csv`), daily);
    await sleep(600);

    const weekly = await fetchYahoo(s.symbol, '1wk', '10y');
    saveCsv(path.join(DATA_DIR, `${s.symbol}_1wk.csv`), weekly);
    await sleep(600);

    const monthly = await fetchYahoo(s.symbol, '1mo', '10y');
    saveCsv(path.join(DATA_DIR, `${s.symbol}_1mo.csv`), monthly);
    await sleep(600);

    const hourly = await fetchYahoo(s.symbol, '1h', '730d');
    saveCsv(path.join(DATA_DIR, `${s.symbol}_1h.csv`), hourly);
    await sleep(600);
  }
}

// ---------- Binance (crypto, since 2017) ----------
async function fetchBinance(symbol, interval, startMs) {
  const rows = [];
  let start = startMs;
  const limit = 1000;
  while (true) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&limit=${limit}`;
    const data = await fetchJson(url);
    if (!data || !data.length) break;
    for (const k of data) {
      rows.push([
        new Date(k[0]).toISOString(),
        k[1],
        k[2],
        k[3],
        k[4],
        k[5],
      ]);
    }
    start = data[data.length - 1][0] + 1;
    if (data.length < limit) break;
    await sleep(120);
  }
  return rows;
}

// ---------- Coinbase (crypto fallback, works from anywhere) ----------
async function fetchCoinbase(pair, granularity, daysBack) {
  const rows = [];
  let end = Math.floor(Date.now() / 1000);
  const startAll = end - daysBack * 86400;
  while (end > startAll) {
    const start = Math.max(startAll, end - 300 * granularity);
    const url = `https://api.exchange.coinbase.com/products/${pair}/candles?granularity=${granularity}&start=${start}&end=${end}`;
    const data = await fetchJson(url);
    if (!data || !data.length) break;
    // coinbase candles: [time, low, high, open, close, volume]
    for (const c of data) {
      rows.push([new Date(c[0] * 1000).toISOString(), c[4], c[2], c[1], c[3], c[5]]);
    }
    end = Math.min(...data.map((c) => c[0])) - 1;
    await sleep(200);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const seen = new Set();
  return rows.filter((r) => (seen.has(r[0]) ? false : (seen.add(r[0]), true)));
}

function resampleToCsv(rows, bucketMs) {
  const bars = resample(
    rows.map((r) => ({ t: Date.parse(r[0]), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })),
    bucketMs
  );
  return bars.map((b) => [new Date(b.t).toISOString(), b.open, b.high, b.low, b.close, b.volume]);
}

async function fetchCrypto() {
  const binanceStart = Date.UTC(2017, 7, 17); // BTCUSDT / ETHUSDT listing
  const pairs = [
    { symbol: 'BTC', binance: 'BTCUSDT', pair: 'BTC-USD', id: 'bitcoin' },
    { symbol: 'ETH', binance: 'ETHUSDT', pair: 'ETH-USD', id: 'ethereum' },
  ];
  for (const p of pairs) {
    let hourly, fourHour, binanceDaily;
    try {
      hourly = await fetchBinance(p.binance, '1h', binanceStart);
      fourHour = await fetchBinance(p.binance, '4h', binanceStart);
      binanceDaily = await fetchBinance(p.binance, '1d', binanceStart);
    } catch (e) {
      console.log(`Binance unavailable (${e.message}) — using Coinbase fallback for ${p.symbol}`);
      hourly = await fetchCoinbase(p.pair, 3600, 400);
      fourHour = resampleToCsv(hourly, 4 * 3600e3);
      binanceDaily = await fetchCoinbase(p.pair, 86400, 3650);
    }
    saveCsv(path.join(DATA_DIR, `${p.symbol}_1h.csv`), hourly);
    await sleep(300);

    saveCsv(path.join(DATA_DIR, `${p.symbol}_4h.csv`), fourHour);
    await sleep(300);

    saveCsv(path.join(DATA_DIR, `${p.symbol}_1d_binance.csv`), binanceDaily);
    await sleep(300);

    const yahooDaily = await fetchYahoo(p.symbol + '-USD', '1d', '10y');
    saveCsv(path.join(DATA_DIR, `${p.symbol}_1d.csv`), yahooDaily);
    await sleep(600);
  }
}

async function main() {
  console.log('=== Fetching stocks (Yahoo Finance) ===');
  await fetchStocks();
  console.log('=== Fetching crypto (Binance + Coinbase fallback) ===');
  await fetchCrypto();
  console.log('=== Done ===');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
