const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'raw');
fs.mkdirSync(DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error && json.error.length) throw new Error(json.error.join('; '));
      return json;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`  Retry ${i + 1}/${retries}: ${e.message}`);
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
  console.log(`  Saved ${path.basename(file)} (${rows.length} rows)`);
}

// Kraken public OHLC — free, no API key, 721 candles max per request
// Interval: 1=1min, 5=5min, 15=15min, 30=30min, 60=1h, 240=4h, 1440=1d
const KRAKEN_INTERVALS = { '1h': 60, '4h': 240, '1d': 1440 };
const KRAKEN_PAIRS = { BTC: 'XXBTZUSD', ETH: 'XETHZUSD' };

async function fetchKraken(krakenPair, interval, retries = 3) {
  const intCode = KRAKEN_INTERVALS[interval];
  const url = `https://api.kraken.com/0/public/OHLC?pair=${krakenPair}&interval=${intCode}`;
  const data = await fetchJson(url, retries);
  const key = Object.keys(data.result).find((k) => k !== 'last');
  if (!key || !data.result[key]) return [];
  return data.result[key].map((c) => [
    new Date(c[0] * 1000).toISOString(),
    c[1], c[2], c[3], c[4], c[6],
  ]);
}

async function main() {
  console.log('=== Fetching crypto (Kraken) ===');

  for (const [sym, krakenPair] of Object.entries(KRAKEN_PAIRS)) {
    console.log(`\n--- ${sym} ---`);
    for (const interval of ['1h', '4h', '1d']) {
      try {
        const rows = await fetchKraken(krakenPair, interval);
        saveCsv(path.join(DATA_DIR, `${sym}_${interval}.csv`), rows);
      } catch (e) {
        console.log(`  WARN: ${sym} ${interval} failed: ${e.message}`);
        saveCsv(path.join(DATA_DIR, `${sym}_${interval}.csv`), []);
      }
      await sleep(500);
    }
  }

  console.log('\n=== Done ===');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
