// v2 paper bot — candidate A (Donchian daily, BTC+ETH, long+short) trading a
// shared paper $10,000 account from 2026-10-29. NO real orders, no API keys.
//
// Design: every run replays the portfolio engine from PAPER_START over the
// latest daily bars and rewrites state from scratch. Replay-derived state
// cannot fork or drift (the v1 bot's cursor state could). Indicators warm up
// on full history; only signals on/after PAPER_START may open trades.
// The still-forming current UTC daily bar is dropped — closed bars only.
//
// Kill rule (written 2026-10-29, before first trade): HALT and review if
// paper equity drawdown from peak exceeds 25%, or after 15 consecutive
// losing closed trades. Halting = remove the daily workflow step; the
// replay makes resuming trivial and auditable.
//
// Usage: node scripts/v2_paper.js   (run scripts/fetch_history.js first)
const fs = require('fs');
const path = require('path');
const { loadBars } = require('./v2_backtest');
const { runPortfolio, portfolioStats, START_EQUITY } = require('./v2_portfolio');

const PAPER_START = Date.parse('2026-10-29T00:00:00Z');
const STATE = path.join(__dirname, '..', 'data', 'v2', 'paper_state.json');
const PUBLIC = path.join(__dirname, '..', 'web', 'data', 'v2.json');

function closedDailyBars(sym) {
  const bars = loadBars(sym, '1d');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return bars.filter((b) => b.t < today.getTime());
}

function main() {
  const barsBySym = { BTC: closedDailyBars('BTC'), ETH: closedDailyBars('ETH') };
  const res = runPortfolio(barsBySym, { allowShort: true, startMs: PAPER_START });
  const s = portfolioStats(runPortfolio(barsBySym, { allowShort: true }), barsBySym); // full-history backtest stats
  const lastClose = {};
  for (const [sym, bars] of Object.entries(barsBySym)) lastClose[sym] = bars[bars.length - 1].close;

  let peak = START_EQUITY, dd = 0;
  for (const p of res.curve) { if (p.eq > peak) peak = p.eq; }
  dd = peak > 0 ? res.mtmEquity / peak - 1 : 0;
  let streak = 0;
  for (const t of [...res.trades].sort((a, b) => a.exitT - b.exitT)) streak = t.pnl < 0 ? streak + 1 : 0;
  const halted = dd < -0.25 || streak >= 15;

  const pub = {
    updatedAt: new Date().toISOString(),
    strategy: 'Donchian 55/20 daily + SMA200 filter, 2.5xATR stop, 0.75% risk/trade, BTC+ETH shared account, long+short',
    paperStart: new Date(PAPER_START).toISOString(),
    startEquity: START_EQUITY,
    equity: +res.mtmEquity.toFixed(2),
    realizedEquity: +res.finalEquity.toFixed(2),
    drawdownFromPeak: +(dd * 100).toFixed(2),
    losingStreak: streak,
    halted,
    killRule: 'Halt if drawdown from peak > 25% or 15 consecutive losers',
    lastClose,
    open: res.openPositions.map((p) => ({
      sym: p.sym, side: p.dir === 1 ? 'LONG' : 'SHORT',
      entry: +p.entryFill.toFixed(2), stop: +p.stop.toFixed(2),
      mark: +p.mark.toFixed(2), openedAt: new Date(p.entryT).toISOString(),
      unrealUsd: +p.unrealPnl.toFixed(2),
    })),
    closed: res.trades.slice(-50).map((t) => ({
      sym: t.sym, side: t.dir === 1 ? 'LONG' : 'SHORT',
      openedAt: new Date(t.entryT).toISOString(), closedAt: new Date(t.exitT).toISOString(),
      pnlUsd: +t.pnl.toFixed(2), r: +t.rMultiple.toFixed(2), reason: t.reason,
    })),
    stats: { closed: res.trades.length, open: res.openPositions.length },
    backtest2017_2026: {
      note: 'Same engine, full history, shared account — see analysis/V2_VALIDATION.md',
      trades: s.n, expectancyR: +s.expectancyR.toFixed(2), profitFactor: +s.profitFactor.toFixed(2),
      totalRetPct: +(s.totalRet * 100).toFixed(1), maxDDPct: +(s.maxDD * 100).toFixed(1),
      oosExpR: +s.oosExpR.toFixed(2), buyHoldRetPct: +(s.bhRet * 100).toFixed(1), buyHoldDDPct: +(s.bhDD * 100).toFixed(1),
    },
  };

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(pub, null, 2), 'utf8');
  fs.writeFileSync(PUBLIC, JSON.stringify(pub, null, 2), 'utf8');
  console.log(`v2 paper: equity $${pub.equity} (realized $${pub.realizedEquity}), open ${pub.open.length}, closed ${pub.stats.closed}, DD ${pub.drawdownFromPeak}%, streak ${streak}${halted ? ' — HALTED (kill rule)' : ''}`);
  for (const p of pub.open) console.log(`  OPEN ${p.sym} ${p.side} @ ${p.entry} stop ${p.stop} mark ${p.mark} (${p.unrealUsd >= 0 ? '+' : ''}$${p.unrealUsd})`);
}

if (require.main === module) main();
module.exports = { PAPER_START };
