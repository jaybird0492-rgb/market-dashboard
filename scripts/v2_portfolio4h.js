// Portfolio-level check of the DEPLOYED 4H rule: BTC+ETH sharing one $10k
// account, Donchian 20/10 + transition daily gate (longs when the last daily
// close > SMA50, shorts when < SMA200, both in the band) + the native 4H
// SMA200 filter inside stratA. Same costs/fills as the paper bot
// (scripts/v2_paper4h.js) and the same risk sizing as v2_portfolio.js.
//
// Why this exists: per-coin "silo" stats understate drawdown. BTC and ETH
// trends fire together (247 overlapping entries in 2017-2026), so the shared
// account is the honest number to quote for this layer.
// Reviewer item M2, 2026-11-04.
//
// Usage: node scripts/v2_portfolio4h.js
const { loadBars } = require('./v2_backtest');
const { runPortfolio, portfolioStats } = require('./v2_portfolio');
const { dualGateStrat, FUT } = require('./v2_timeframes');

const barsBySym = { BTC: loadBars('BTC', '4h'), ETH: loadBars('ETH', '4h') };
const res = runPortfolio(barsBySym, {
  allowShort: true,
  makeStrat: (sym, bars, ind) => dualGateStrat(sym)(bars, ind),
  maxHoldBars: 360,
  ...FUT,
});
const s = portfolioStats(res, barsBySym);
const exp = (ts) => (ts.length ? ts.reduce((a, x) => a + x.rMultiple, 0) / ts.length : 0);
const exTop3 = exp([...res.trades].sort((a, b) => b.rMultiple - a.rMultiple).slice(3));
const OOS = Date.parse('2023-01-01T00:00:00Z');
const oos = res.trades.filter((t) => t.entryT >= OOS);
const oosEx3 = exp([...oos].sort((a, b) => b.rMultiple - a.rMultiple).slice(3));
console.log(
  `PORTFOLIO 4H 20/10 + dual gate, BTC+ETH shared $10k: n=${s.n} win=${(s.winRate * 100).toFixed(1)}% ` +
  `expR=${s.expectancyR.toFixed(2)}±${s.ci95.toFixed(2)} exTop3=${exTop3.toFixed(2)} PF=${s.profitFactor.toFixed(2)} ` +
  `ret=${(s.totalRet * 100).toFixed(1)}% CAGR=${(s.cagr * 100).toFixed(1)}% maxDD=${(s.maxDD * 100).toFixed(1)}% ` +
  `| IS n=${s.isN} expR=${s.isExpR.toFixed(2)} | OOS n=${s.oosN} expR=${s.oosExpR.toFixed(2)} exTop3=${oosEx3.toFixed(2)} ` +
  `| 50/50 B&H ret=${(s.bhRet * 100).toFixed(1)}% DD=${(s.bhDD * 100).toFixed(1)}%`
);
let both = 0;
const tr = [...res.trades].sort((a, b) => a.entryT - b.entryT);
for (let i = 1; i < tr.length; i++) if (tr[i].sym !== tr[i - 1].sym && tr[i].entryT < tr[i - 1].exitT) both++;
console.log(`   trades by coin: BTC=${tr.filter((x) => x.sym === 'BTC').length} ETH=${tr.filter((x) => x.sym === 'ETH').length}; overlapping entries=${both}; open at end=${res.openPositions.length}`);
