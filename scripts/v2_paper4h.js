// v2 4H futures paper layer — simulated USDT-perp account, BTC+ETH shared
// $10,000. Rules from 2026-11-04: Donchian 20/10 on 4H with the dual daily
// gate (longs need the daily close above SMA50, shorts need it below SMA200;
// both sides open in the band between the two averages). This replaced the
// single SMA50 gate (F3) after it blocked valid recovery longs on both coins
// while price was still above its 200-day trend. Gate matrix and evidence:
// scripts/v2_gates.js. 4H 20/10 + dual gate: BTC +0.47R (OOS +0.43),
// ETH +0.42R (OOS +0.35), maxDD -9% both, ~32 trades/yr/coin. The paper
// clock restarts here because this is a rule change; the old F3 record
// (2 trades, -0.80R combined) is kept in analysis/V2_VALIDATION.md.
// Costs: Binance perp taker fee 0.05%/side, slippage 0.02%/side, funding
// drag 0.03%/day. Replay-derived state from PAPER4H_START on every run —
// cannot fork. Only closed 4H bars are used (the forming bar is dropped).
// Kill rule (same as daily layer): halt if drawdown from peak > 25% or
// 15 consecutive losers. Halting = remove the step from the workflow.
//
// Usage: node scripts/v2_paper4h.js  (after fetch_history --live, or with
// full data/history present it replays from there)
const fs = require('fs');
const path = require('path');
const { runPortfolio, START_EQUITY } = require('./v2_portfolio');
const { dualGateStrat } = require('./v2_timeframes');
const { buildPayload } = require('./v2_paperlib');

const H4 = 144e5;
const PAPER4H_START = Date.parse('2026-11-04T16:00:00Z');
const STATE = path.join(__dirname, '..', 'data', 'v2', 'paper4h_state.json');
const PUBLIC = path.join(__dirname, '..', 'web', 'data', 'v2_4h.json');

function loadBarsAny(sym, tf) {
  const live = path.join(__dirname, '..', 'data', 'live', `${sym}_${tf}_live.csv`);
  const file = fs.existsSync(live) ? live : path.join(__dirname, '..', 'data', 'history', `${sym}_${tf}_binance.csv`);
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const p = l.split(',');
    return { t: Date.parse(p[0]), open: +p[1], high: +p[2], low: +p[3], close: +p[4] };
  }).filter((b) => Number.isFinite(b.t) && b.close > 0);
}
function closedBars(sym) {
  const now = Date.now();
  return loadBarsAny(sym, '4h').filter((b) => b.t + H4 <= now);
}

function main() {
  const barsBySym = { BTC: closedBars('BTC'), ETH: closedBars('ETH') };
  const res = runPortfolio(barsBySym, {
    allowShort: true, startMs: PAPER4H_START,
    makeStrat: (sym, bars, ind) => dualGateStrat(sym)(bars, ind),
    maxHoldBars: 360, feeSide: 0.0005, slipSide: 0.0002, fundingDay: 0.0003,
  });
  const pub = buildPayload(res, {
    strategy: '4H Donchian 20/10 futures (simulated perps), dual daily gate (longs > SMA50, shorts < SMA200, both in the band), 2.5xATR stop, 0.75% risk/trade, BTC+ETH shared',
    rules: '4H Donchian 20/10 + dual daily gate (long > SMA50, short < SMA200, both in band) + native 4H SMA200 filter, 2.5xATR stop, 0.75% risk/trade, BTC+ETH shared',
    paperStart: new Date(PAPER4H_START).toISOString(),
    startEquity: START_EQUITY,
    reference: {
      label: 'Backtest 2017-2026 (4H futures, dual gate)',
      trades: 606, expectancyR: 0.44, profitFactor: 1.63,
      maxDDPct: -15.2, oosExpR: 0.39,
      note: 'Shared-account portfolio replay of the deployed rule — see analysis/V2_VALIDATION.md',
    },
  });

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(pub, null, 2), 'utf8');
  fs.writeFileSync(PUBLIC, JSON.stringify(pub, null, 2), 'utf8');
  console.log(`v2 4H futures paper: equity $${pub.equity}, open ${pub.open.length}, closed ${pub.stats.closed}, DD ${pub.drawdownFromPeak}%${pub.halted ? ' — HALTED' : ''}`);
  for (const p of pub.open) console.log(`  OPEN ${p.sym} ${p.side} @ ${p.entry} stop ${p.stop} mark ${p.mark} (${p.unrealUsd >= 0 ? '+' : ''}$${p.unrealUsd}, ${p.unrealR}R)`);
}

if (require.main === module) main();
module.exports = { loadBarsAny };
