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
  let peak = START_EQUITY;
  for (const p of res.curve) if (p.eq > peak) peak = p.eq;
  const dd = peak > 0 ? res.mtmEquity / peak - 1 : 0;
  let streak = 0;
  for (const t of [...res.trades].sort((a, b) => a.exitT - b.exitT)) streak = t.pnl < 0 ? streak + 1 : 0;

  // Display marks use the latest 1H close (trade decisions still use closed
  // 4H bars only) so unrealized P&L moves between 4H closes.
  const liveMark = {};
  for (const sym of Object.keys(barsBySym)) {
    try {
      const h1 = loadBarsAny(sym, '1h');
      if (h1.length) liveMark[sym] = h1[h1.length - 1].close;
    } catch { /* keep 4H mark */ }
  }
  for (const p of res.openPositions) {
    if (liveMark[p.sym]) {
      p.mark = liveMark[p.sym];
      p.unrealPnl = p.qty * (p.mark - p.entryFill) * p.dir;
    }
  }
  const mtmLive = res.finalEquity + res.openPositions.reduce((a, p) => a + p.unrealPnl, 0);

  const pub = {
    updatedAt: new Date().toISOString(),
    strategy: '4H Donchian 20/10 futures (simulated perps), dual daily gate (longs > SMA50, shorts < SMA200, both in the band), 2.5xATR stop, 0.75% risk/trade, BTC+ETH shared',
    paperStart: new Date(PAPER4H_START).toISOString(),
    startEquity: START_EQUITY,
    equity: +mtmLive.toFixed(2),
    realizedEquity: +res.finalEquity.toFixed(2),
    drawdownFromPeak: +(dd * 100).toFixed(2),
    losingStreak: streak,
    halted: dd < -0.25 || streak >= 15,
    killRule: 'Halt if drawdown from peak > 25% or 15 consecutive losers',
    open: res.openPositions.map((p) => ({
      sym: p.sym, side: p.dir === 1 ? 'LONG' : 'SHORT', entry: +p.entryFill.toFixed(2),
      stop: +p.stop.toFixed(2), mark: +p.mark.toFixed(2),
      openedAt: new Date(p.entryT).toISOString(), unrealUsd: +p.unrealPnl.toFixed(2),
      notionalUsd: +(p.qty * p.entryFill).toFixed(2),
    })),
    pending: res.pending.map((p) => ({
      sym: p.sym, side: p.dir === 1 ? 'LONG' : 'SHORT',
      signalAt: new Date(p.signalT).toISOString(), fillsAt: new Date(p.nextOpenT).toISOString(),
    })),
    closed: res.trades.slice(-50).map((t) => ({
      sym: t.sym, side: t.dir === 1 ? 'LONG' : 'SHORT',
      openedAt: new Date(t.entryT).toISOString(), closedAt: new Date(t.exitT).toISOString(),
      pnlUsd: +t.pnl.toFixed(2), r: +t.rMultiple.toFixed(2), reason: t.reason,
    })),
    stats: { closed: res.trades.length, open: res.openPositions.length },
  };
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(pub, null, 2), 'utf8');
  fs.writeFileSync(PUBLIC, JSON.stringify(pub, null, 2), 'utf8');
  console.log(`v2 4H futures paper: equity $${pub.equity}, open ${pub.open.length}, closed ${pub.stats.closed}, DD ${pub.drawdownFromPeak}%${pub.halted ? ' — HALTED' : ''}`);
  for (const p of pub.open) console.log(`  OPEN ${p.sym} ${p.side} @ ${p.entry} stop ${p.stop} mark ${p.mark} (${p.unrealUsd >= 0 ? '+' : ''}$${p.unrealUsd})`);
}

if (require.main === module) main();
module.exports = { loadBarsAny };
