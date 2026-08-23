const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'raw');
fs.mkdirSync(DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, headers = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
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
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

function saveCsv(file, rows) {
  const header = 'timestamp,open,high,low,close,volume';
  const body = rows
    .map((r) => r.map((v) => (v === null || v === undefined ? '' : v)).join(','))
    .join('\n');
  fs.writeFileSync(file, header + '\n' + body + '\n', 'utf8');
  console.log(`Saved ${file} (${rows.length} rows)`);
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

// ---------- Coinbase fallback (disabled — Binance-only) ----------

async function fetchCrypto() {
  const binanceStart = Date.UTC(2017, 7, 17); // BTCUSDT / ETHUSDT listing
  const pairs = [
    { symbol: 'BTC', binance: 'BTCUSDT', id: 'bitcoin' },
    { symbol: 'ETH', binance: 'ETHUSDT', id: 'ethereum' },
  ];
  for (const p of pairs) {
    let hourly, binanceDaily;
    try {
      hourly = await fetchBinance(p.binance, '1h', binanceStart);
      binanceDaily = await fetchBinance(p.binance, '1d', binanceStart);
    } catch (e) {
      console.log(`Binance unavailable (${e.message}) — cannot fetch ${p.symbol}`);
      continue;
    }
    saveCsv(path.join(DATA_DIR, `${p.symbol}_1h.csv`), hourly);
    await sleep(300);

    saveCsv(path.join(DATA_DIR, `${p.symbol}_1d.csv`), binanceDaily);
    await sleep(300);
  }
}

async function main() {
  console.log('=== Fetching crypto (Binance) ===');
  await fetchCrypto();
  console.log('=== Done ===');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
