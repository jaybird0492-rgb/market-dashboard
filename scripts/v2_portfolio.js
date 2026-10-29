// v2 portfolio test — candidate A (Donchian daily) on BTC+ETH sharing ONE
// account, the way it would actually be traded. Per-symbol silo results
// (v2_backtest.js) overstate capital and ignore that BTC/ETH trends fire
// together. Rules (fixed before running, 2026-10-29):
//   - Shared equity starting $10,000. Each trade risks 0.75% of equity.
//   - Max 2 open positions (one per coin), total open risk cap 1.5% of equity.
//   - Per-position notional cap 60% of equity; no leverage.
//   - Same fills/costs as v2_backtest.js: next-open fills, intrabar disaster
//     stop at worse of open/stop, 0.10% fee + 0.05% slippage per side,
//     0.01%/day funding drag both sides.
//   - Benchmark: 50/50 BTC/ETH buy & hold over the same window.
// Usage: node scripts/v2_portfolio.js [--json]
const { loadBars, stratA, smaArr, atrArr, FEE_SIDE, SLIP_SIDE, FUNDING_DAY, RISK_FRAC } = require('./v2_backtest');

const START_EQUITY = 10000;
const MAX_POSITIONS = 2;
const TOTAL_RISK_CAP = 0.015;
const NOTIONAL_CAP = 0.60;

function runPortfolio(barsBySym, { allowShort = true, startMs = -Infinity } = {}) {
  const syms = Object.keys(barsBySym);
  const state = {};
  for (const sym of syms) {
    const bars = barsBySym[sym];
    const closes = bars.map((b) => b.close);
    const ind = { sma20: smaArr(closes, 20), sma50: smaArr(closes, 50), sma200: smaArr(closes, 200), atr: atrArr(bars, 14) };
    state[sym] = { bars, ind, strat: stratA(bars, ind, 1), i: 0, pendingEntry: 0, pendingExit: false };
  }
  // merged timeline of all bar timestamps
  const times = [...new Set(syms.flatMap((s) => barsBySym[s].map((b) => b.t)))].sort((a, b) => a - b);
  let equity = START_EQUITY;
  const positions = {}; // sym -> pos
  const trades = [];
  const curve = [];
  const slip = (raw, isBuy) => raw * (1 + (isBuy ? SLIP_SIDE : -SLIP_SIDE));

  function closePos(sym, t, rawPrice, reason) {
    const pos = positions[sym];
    const fill = slip(rawPrice, pos.dir === -1);
    const gross = pos.qty * (fill - pos.entryFill) * pos.dir;
    const fees = FEE_SIDE * pos.qty * (pos.entryFill + fill);
    const days = (t - pos.entryT) / 864e5;
    const funding = FUNDING_DAY * days * pos.qty * pos.entryFill;
    const pnl = gross - fees - funding;
    equity += pnl;
    trades.push({ sym, dir: pos.dir, entryT: pos.entryT, exitT: t, pnl, rMultiple: pnl / (pos.equityBefore * RISK_FRAC), reason });
    delete positions[sym];
    state[sym].pendingExit = false;
  }

  const lastClose = {}; // forward-filled marks for symbols missing a bar at t
  for (const t of times) {
    const dayStartEquity = equity; // sizing uses yesterday's settled equity, so an
    // intraday stop on one coin cannot fund another coin's open fill the same day
    // advance each symbol to its bar at t (bars are daily-aligned; a symbol
    // may lack a bar on t in early history — it simply sits that day out)
    for (const sym of syms) {
      const S = state[sym];
      while (S.i < S.bars.length && S.bars[S.i].t < t) S.i++;
      if (S.i >= S.bars.length || S.bars[S.i].t !== t) continue;
      const b = S.bars[S.i];
      lastClose[sym] = b.close;
      const pos = positions[sym];

      if (pos && S.pendingExit) closePos(sym, t, b.open, 'SIGNAL');
      if (!positions[sym] && S.pendingEntry !== 0 && t >= startMs && S.ind.atr[S.i - 1]) {
        const dir = S.pendingEntry;
        const openCount = Object.keys(positions).length;
        const openRisk = Object.values(positions).reduce((a, p) => a + p.riskFrac, 0);
        if (openCount < MAX_POSITIONS && openRisk + RISK_FRAC <= TOTAL_RISK_CAP + 1e-9) {
          const entryFill = slip(b.open, dir === 1);
          const stopDist = 2.5 * S.ind.atr[S.i - 1];
          let qty = (dayStartEquity * RISK_FRAC) / stopDist;
          qty = Math.min(qty, (dayStartEquity * NOTIONAL_CAP) / entryFill);
          if (qty > 0) {
            positions[sym] = { dir, entryFill, qty, equityBefore: dayStartEquity, riskFrac: RISK_FRAC, stop: dir === 1 ? entryFill - stopDist : entryFill + stopDist, entryBar: S.i, entryT: t };
          }
        }
      }
      S.pendingEntry = 0;

      const cur = positions[sym];
      if (cur && (cur.dir === 1 ? b.low <= cur.stop : b.high >= cur.stop)) {
        closePos(sym, t, cur.dir === 1 ? Math.min(b.open, cur.stop) : Math.max(b.open, cur.stop), 'STOP');
      }
      if (positions[sym]) {
        if (S.strat.exitHit(S.i, positions[sym]) || S.i - positions[sym].entryBar >= 365) S.pendingExit = true;
      } else if (t >= startMs) {
        const dir = S.strat.entryDir(S.i);
        if (dir !== 0 && (dir === 1 || allowShort) && S.ind.atr[S.i]) S.pendingEntry = dir;
      }
    }
    let mtm = equity;
    for (const [sym, p] of Object.entries(positions)) {
      if (lastClose[sym] !== undefined) mtm += p.qty * (lastClose[sym] - p.entryFill) * p.dir;
    }
    curve.push({ t, eq: mtm });
  }

  const openPositions = Object.entries(positions).map(([sym, p]) => {
    const S = state[sym];
    const last = S.bars[S.bars.length - 1];
    return { sym, dir: p.dir, entryFill: p.entryFill, entryT: p.entryT, stop: p.stop, qty: p.qty, mark: last.close, unrealPnl: p.qty * (last.close - p.entryFill) * p.dir };
  });
  return { trades, curve, openPositions, finalEquity: equity, mtmEquity: curve.length ? curve[curve.length - 1].eq : equity };
}

function portfolioStats(res, barsBySym) {
  const trades = res.trades;
  const n = trades.length;
  const wins = trades.filter((x) => x.pnl > 0);
  const gp = wins.reduce((a, x) => a + x.pnl, 0);
  const gl = -trades.filter((x) => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0);
  let peak = -Infinity, maxDD = 0;
  for (const p of res.curve) { if (p.eq > peak) peak = p.eq; if (peak > 0) maxDD = Math.min(maxDD, p.eq / peak - 1); }
  const years = res.curve.length ? (res.curve[res.curve.length - 1].t - res.curve[0].t) / (365.25 * 864e5) : 0;
  const totalRet = res.mtmEquity / START_EQUITY - 1;
  const mean = n ? trades.reduce((a, x) => a + x.rMultiple, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(trades.reduce((a, x) => a + (x.rMultiple - mean) ** 2, 0) / (n - 1)) : 0;
  // 50/50 buy & hold from first bar where both symbols trade
  const t0 = Math.max(...Object.values(barsBySym).map((b) => b[200].t));
  let bhRet = 0, bhPeak = -Infinity, bhDD = 0, bh = 1;
  const closes = {};
  for (const [sym, bars] of Object.entries(barsBySym)) closes[sym] = new Map(bars.map((b) => [b.t, b.close]));
  const startPx = {}; for (const sym of Object.keys(barsBySym)) startPx[sym] = closes[sym].get(t0);
  const retByT = new Map();
  const ff = {}; // forward-filled last close at or before p.t (never a future price)
  for (const sym of Object.keys(barsBySym)) ff[sym] = startPx[sym];
  for (const p of res.curve) {
    if (p.t < t0) continue;
    for (const sym of Object.keys(barsBySym)) if (closes[sym].has(p.t)) ff[sym] = closes[sym].get(p.t);
    const r = Object.keys(barsBySym).reduce((a, sym) => a + 0.5 * (ff[sym] / startPx[sym] - 1), 0);
    retByT.set(p.t, r);
    bh = 1 + r;
    if (bh > bhPeak) bhPeak = bh;
    if (bhPeak > 0) bhDD = Math.min(bhDD, bh / bhPeak - 1);
  }
  bhRet = bh - 1;
  const OOS = Date.parse('2023-01-01T00:00:00Z');
  const oos = trades.filter((x) => x.entryT >= OOS), is = trades.filter((x) => x.entryT < OOS);
  const exp = (ts) => (ts.length ? ts.reduce((a, x) => a + x.rMultiple, 0) / ts.length : 0);
  const bothOpen = trades.length; // placeholder clarity
  return {
    n, winRate: n ? wins.length / n : 0, expectancyR: mean, ci95: n > 1 ? 1.96 * sd / Math.sqrt(n) : 0,
    profitFactor: gl > 0 ? gp / gl : Infinity, totalRet,
    cagr: years > 0 ? Math.pow(1 + totalRet, 1 / years) - 1 : 0, maxDD, years,
    isExpR: exp(is), isN: is.length, oosExpR: exp(oos), oosN: oos.length,
    bhRet, bhDD, bothOpen,
  };
}

function main() {
  const barsBySym = { BTC: loadBars('BTC', '1d'), ETH: loadBars('ETH', '1d') };
  for (const mode of ['long', 'longshort']) {
    const res = runPortfolio(barsBySym, { allowShort: mode === 'longshort' });
    const s = portfolioStats(res, barsBySym);
    const exTop3 = (() => { const ts = [...res.trades].sort((a, b) => b.rMultiple - a.rMultiple).slice(3); return ts.length ? ts.reduce((a, x) => a + x.rMultiple, 0) / ts.length : 0; })();
    console.log(
      `PORTFOLIO A-donchian-1d/${mode === 'long' ? 'L' : 'LS'} BTC+ETH shared $10k: n=${s.n} win=${(s.winRate * 100).toFixed(1)}% ` +
      `expR=${s.expectancyR.toFixed(2)}±${s.ci95.toFixed(2)} exTop3=${exTop3.toFixed(2)} PF=${s.profitFactor.toFixed(2)} ret=${(s.totalRet * 100).toFixed(1)}% ` +
      `CAGR=${(s.cagr * 100).toFixed(1)}% maxDD=${(s.maxDD * 100).toFixed(1)}% | IS n=${s.isN} expR=${s.isExpR.toFixed(2)} | OOS n=${s.oosN} expR=${s.oosExpR.toFixed(2)} ` +
      `| 50/50 B&H ret=${(s.bhRet * 100).toFixed(1)}% DD=${(s.bhDD * 100).toFixed(1)}%`
    );
    // overlap: how often were both coins in a trade at once?
    let both = 0;
    const tr = [...res.trades].sort((a, b) => a.entryT - b.entryT);
    for (let i = 1; i < tr.length; i++) if (tr[i].sym !== tr[i - 1].sym && tr[i].entryT < tr[i - 1].exitT) both++;
    console.log(`   trades by coin: BTC=${tr.filter((x) => x.sym === 'BTC').length} ETH=${tr.filter((x) => x.sym === 'ETH').length}; overlapping BTC+ETH entries=${both}; open at end=${res.openPositions.length}`);
  }
  if (process.argv.includes('--json')) {
    const res = runPortfolio(barsBySym, { allowShort: true });
    console.log(JSON.stringify({ stats: portfolioStats(res, barsBySym), trades: res.trades }));
  }
}

if (require.main === module) main();
module.exports = { runPortfolio, portfolioStats, START_EQUITY };
