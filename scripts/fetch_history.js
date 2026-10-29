// Long-history fetcher for v2 validation. Binance public spot klines, no API key.
// Kraken (scripts/fetch.js) only returns 720 bars, which made v1 validation
// meaningless. This pulls full history into data/history/ (gitignored).
// Usage: node scripts/fetch_history.js [SYM ...] [--intervals 1d,4h]
// Defaults: BTC ETH SOL XRP BNB on 1d + 4h, from each symbol's Binance listing.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'history');
fs.mkdirSync(OUT, { recursive: true });

const PAIRS = { BTC: 'BTCUSDT', ETH: 'ETHUSDT' }; // universe: BTC/ETH only (decided 2026-10-29)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// data-api.binance.vision is Binance's public market-data domain — same data
// as api.binance.com but not geo-blocked (api.binance.com returns HTTP 451
// from GitHub Actions' US runners; verified 2026-10-29).
const BASE = 'https://data-api.binance.vision';
async function fetchKlines(pair, interval, startMs) {
  const rows = [];
  let cur = startMs;
  for (;;) {
    const url = `${BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&startTime=${cur}&limit=1000`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${pair} ${interval}`);
    const batch = await res.json();
    if (!batch.length) break;
    for (const k of batch) rows.push(k);
    cur = batch[batch.length - 1][0] + 1;
    if (batch.length < 1000) break;
    await sleep(150);
  }
  return rows;
}

const LIVE_DIR = path.join(__dirname, '..', 'data', 'live');
const IV_MS = { '1h': 36e5, '4h': 144e5, '1d': 864e5 };

// --live: fetch only the last 1500 bars per symbol/interval into
// data/live/{SYM}_{tf}_live.csv — enough warmup for signals + paper replay,
// cheap enough to run hourly in CI.
async function mainLive(intervals) {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  for (const sym of Object.keys(PAIRS)) {
    for (const interval of intervals) {
      const start = Date.now() - 1500 * IV_MS[interval];
      const klines = await fetchKlines(PAIRS[sym], interval, start);
      const body = klines.map((k) => [new Date(k[0]).toISOString(), k[1], k[2], k[3], k[4], k[5]].join(',')).join('\n');
      fs.writeFileSync(path.join(LIVE_DIR, `${sym}_${interval}_live.csv`), 'timestamp,open,high,low,close,volume\n' + body + '\n', 'utf8');
      console.log(`${sym} ${interval} live: ${klines.length} rows -> ${sym}_${interval}_live.csv`);
      await sleep(150);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--live')) {
    const ivIdx = args.indexOf('--intervals');
    const intervals = ivIdx >= 0 ? args[ivIdx + 1].split(',') : ['1h', '4h', '1d'];
    return mainLive(intervals);
  }
  const ivIdx = args.indexOf('--intervals');
  const intervals = ivIdx >= 0 ? args[ivIdx + 1].split(',') : ['1d', '4h'];
  const syms = args.filter((a, i) => !a.startsWith('--') && i !== ivIdx + 1);
  const list = (syms.length ? syms : Object.keys(PAIRS)).filter((s) => PAIRS[s]);
  if (!list.length) { console.error('No known symbols requested'); process.exit(1); }

  for (const sym of list) {
    const pair = PAIRS[sym];
    for (const interval of intervals) {
      const klines = await fetchKlines(pair, interval, 0);
      const body = klines
        .map((k) => [new Date(k[0]).toISOString(), k[1], k[2], k[3], k[4], k[5]].join(','))
        .join('\n');
      const file = path.join(OUT, `${sym}_${interval}_binance.csv`);
      fs.writeFileSync(file, 'timestamp,open,high,low,close,volume\n' + body + '\n', 'utf8');
      const first = klines.length ? new Date(klines[0][0]).toISOString().slice(0, 10) : '-';
      const last = klines.length ? new Date(klines[klines.length - 1][0]).toISOString().slice(0, 10) : '-';
      console.log(`${sym} ${interval}: ${klines.length} rows ${first} -> ${last} -> ${path.basename(file)}`);
      await sleep(150);
    }
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
