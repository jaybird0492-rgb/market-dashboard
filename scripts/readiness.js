// Readiness exam — grades the locked Nov 1 thresholds on a chosen window.
// Usage: node scripts/readiness.js [--since <ISO>] [--rails-ready]
// --since defaults to 2026-10-01. --rails-ready attests condition 3 manually.
// Exit 0 = READY (TRADE), 1 = not ready. Read-only: never writes state.
const fs = require('fs');
const path = require('path');
const { evaluateAll } = require('./setup_backtest');

const WEB = path.join(__dirname, '..', 'web', 'data');
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'HYPE'];
const TFS = ['1H', '4H', '1D'];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function main() {
  const since = Date.parse(arg('--since', '2026-10-01T00:00:00.000Z'));
  const railsReady = process.argv.includes('--rails-ready');
  const paper = loadJson(path.join(WEB, 'paper.json')) || { stats: { closed: 0, totalUsd: 0 } };
  const checks = [];

  // Condition 1: gated paper profitable over >= 30 closed.
  const c1pass = paper.stats.closed >= 30 && paper.stats.totalUsd > 0;
  checks.push({
    name: `Paper green (need >$0 over >=30 closed; have $${paper.stats.totalUsd} over ${paper.stats.closed})`,
    pass: c1pass,
  });

  // Condition 2 + guardrails from the October window backtest.
  const win = {};
  const avgs = {};
  const streaks = {};
  for (const sym of SYMBOLS) {
    const bt = evaluateAll(sym);
    for (const tf of TFS) {
      const res = bt[tf].results.filter((r) => r.entry.time >= since);
      const tp1 = res.filter((r) => r.bt.hit.includes('TP1')).length;
      const sl = res.filter((r) => r.bt.status === 'SL').length;
      const dec = tp1 + sl;
      win[sym + tf] = { n: res.length, dec, winRate: dec ? Math.round((tp1 / dec) * 100) : 0 };
      avgs[sym + tf] = res.length ? res.reduce((a, r) => a + r.bt.realized, 0) / res.length : 0;
      let run = 0, maxRun = 0;
      for (const r of res) {
        if (r.bt.status === 'SL') { run++; if (run > maxRun) maxRun = run; }
        else run = 0;
      }
      streaks[sym + tf] = maxRun;
    }
  }
  const btc1d = win.BTC1D, eth1d = win.ETH1D;
  const c2pass = btc1d.dec >= 5 && eth1d.dec >= 5 && btc1d.winRate >= 60 && eth1d.winRate >= 60;
  checks.push({
    name: `1D edge holds (BTC ${btc1d.winRate}%/${btc1d.dec} decided, ETH ${eth1d.winRate}%/${eth1d.dec} decided; need >=60% each, >=5 decided)`,
    pass: c2pass,
  });

  // Guardrails.
  const badLegs = [];
  for (const sym of SYMBOLS) {
    for (const tf of TFS) {
      if (tf === '1D') continue;
      const w = win[sym + tf];
      if (w.n >= 10 && avgs[sym + tf] < -0.01) badLegs.push(`${sym} ${tf} (${(avgs[sym + tf] * 100).toFixed(2)}%/signal, n=${w.n})`);
    }
  }
  const worstStreak = Math.max(...SYMBOLS.map((s) => streaks[s + '1D']));
  const guardPass = badLegs.length === 0 && worstStreak <= 8;
  checks.push({
    name: `Guardrails (bleeding intraday legs: ${badLegs.length ? badLegs.join(', ') : 'none'}; worst 1D streak ${worstStreak} <= 8)`,
    pass: guardPass,
  });
  checks.push({ name: 'Rails ready (testnet fills, min size, kill switch, losable stake) — manual attestation', pass: railsReady });

  const passed = checks.filter((c) => c.pass).length;
  console.log(`Readiness exam — window since ${new Date(since).toISOString().slice(0, 10)} — ${new Date().toISOString()}`);
  for (const c of checks) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}`);
  const allGreen = checks.every((c) => c.pass);
  const btcEthDead = (win.BTC1D.dec >= 5 && win.BTC1D.winRate < 50) || (win.ETH1D.dec >= 5 && win.ETH1D.winRate < 50);
  if (allGreen) console.log('VERDICT: READY — TRADE Nov, min size, 1D only.');
  else if (btcEthDead) console.log('VERDICT: STOP — 1D edge dead, back to research.');
  else console.log(`VERDICT: NOT READY (${passed}/${checks.length}) — keep waiting, one named change at most.`);
  process.exit(allGreen ? 0 : 1);
}

try { main(); }
catch (e) { console.error('READINESS FAILED:', e.message); process.exit(2); }
