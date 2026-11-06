// Shared exporter for the two paper accounts (daily core + 4H futures).
// One schema, one set of performance definitions, so the dashboard cannot
// disagree with itself. The engine replays the full history from the paper
// start on every run, so this file only formats what runPortfolio already
// knows — it never changes trading rules.
//
// Schema v3 fields are documented in analysis/DASHBOARD_PLAN.md.
const START_EQUITY = 10000;
const DAY = 864e5;

const r2 = (v) => (Number.isFinite(v) ? +v.toFixed(2) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function downsample(curve, max = 400) {
  if (curve.length <= max) return curve;
  const out = [curve[0]];
  const step = (curve.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) out.push(curve[Math.round(i * step)]);
  out.push(curve[curve.length - 1]);
  return out;
}

function drawdown(curve) {
  let peak = -Infinity, dd = 0;
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) dd = Math.min(dd, p.equity / peak - 1);
  }
  return dd;
}

// Consecutive losses at the end of the closed-trade sequence.
function losingStreak(trades) {
  let s = 0;
  for (const t of [...trades].sort((a, b) => a.exitT - b.exitT)) s = t.pnl < 0 ? s + 1 : 0;
  return s;
}

function computeStats(trades, curve, { startEquity, openRiskUsd, paperStart }) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = sum(wins.map((t) => t.pnl));
  const grossLoss = -sum(losses.map((t) => t.pnl));
  const rs = trades.map((t) => (Number.isFinite(t.rMultipleActual) ? t.rMultipleActual : t.rMultiple));
  const winRs = wins.map((t) => (Number.isFinite(t.rMultipleActual) ? t.rMultipleActual : t.rMultiple));
  const lossRs = losses.map((t) => (Number.isFinite(t.rMultipleActual) ? t.rMultipleActual : t.rMultiple));
  const streak = losingStreak(trades);
  const stated = curve.length ? curve[curve.length - 1].equity : startEquity;
  const maxDDPct = drawdown(curve) * 100;
  return {
    closed: n,
    open: 0, // filled by buildPayload (keeps this function trade-only)
    wins: wins.length,
    losses: losses.length,
    winRatePct: n ? r2((wins.length / n) * 100) : null,
    avgWinR: winRs.length ? r2(mean(winRs)) : null,
    avgLossR: lossRs.length ? r2(mean(lossRs)) : null,
    expectancyR: n ? r2(mean(rs)) : null,
    profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : null,
    totalR: n ? r2(sum(rs)) : null,
    totalPnlUsd: r2(stated - startEquity),
    netPnlUsd: null, // filled by buildPayload (includes open unrealized)
    maxDDPct: r2(maxDDPct),
    currentStreak: streak,
    bestR: n ? r2(Math.max(...rs)) : null,
    worstR: n ? r2(Math.min(...rs)) : null,
    avgHoldHours: n ? r2(mean(trades.map((t) => t.holdHours))) : null,
    openRiskUsd: r2(openRiskUsd),
    since: new Date(paperStart).toISOString(),
    lastTradeAt: n ? new Date(Math.max(...trades.map((t) => t.exitT))).toISOString() : null,
    // Pre-registered honesty rule: do not read an edge below 10 trades.
    sampleStatus: n < 10 ? 'insufficient' : n < 30 ? 'building' : 'usable',
  };
}

function buildPayload(res, {
  strategy,
  rules,
  paperStart,
  startEquity = START_EQUITY,
  killRule = 'Halt if drawdown from peak > 25% or 15 consecutive losers',
  reference = null,
  now = Date.now(),
  daysTotal = 42,
  extra = {},
}) {
  const startMs = Date.parse(paperStart);
  const trades = res.trades || [];
  const open = res.openPositions || [];

  const realizedEquity = res.finalEquity;
  const openUnreal = sum(open.map((p) => p.unrealPnl));
  const equity = realizedEquity + openUnreal;
  const openRiskUsd = sum(open.map((p) => p.riskUsd));
  const openNotional = sum(open.map((p) => p.notionalUsd));

  // Curve: keep only the paper period, make sure it starts exactly at the
  // start equity, and append the current mark so the last point matches the
  // headline equity.
  let curve = (res.curve || [])
    .filter((p) => p.t >= startMs)
    .map((p) => ({ t: p.t, equity: p.eq }));
  if (!curve.length || curve[0].t > startMs) curve.unshift({ t: startMs, equity: startEquity });
  if (curve[0].t === startMs) curve[0].equity = startEquity;
  const lastT = curve.length ? curve[curve.length - 1].t : startMs;
  if (now > lastT) curve.push({ t: now, equity });
  curve = downsample(curve);

  const stats = computeStats(trades, curve, { startEquity, openRiskUsd, paperStart });
  stats.open = open.length;
  stats.netPnlUsd = r2(equity - startEquity);
  stats.totalPnlUsd = r2(realizedEquity - startEquity);
  stats.maxDDPct = r2(drawdown(curve) * 100);

  const closed = trades.map((t) => ({
    id: `${t.sym}-${t.entryT}-${t.dir}`,
    sym: t.sym,
    side: t.dir === 1 ? 'LONG' : 'SHORT',
    entry: r2(t.entryFill),
    exit: r2(t.exitFill),
    openedAt: new Date(t.entryT).toISOString(),
    closedAt: new Date(t.exitT).toISOString(),
    holdHours: r2(t.holdHours),
    barsHeld: t.barsHeld,
    pnlUsd: r2(t.pnl),
    feesUsd: r2(t.fees),
    fundingUsd: r2(t.funding),
    riskUsd: r2(t.riskUsd),
    riskPct: t.equityBefore > 0 ? r2((t.riskUsd / t.equityBefore) * 100) : null,
    r: r2(t.rMultipleActual),
    rNominal: r2(t.rMultiple),
    mfeR: r2(t.mfeR),
    maeR: r2(t.maeR),
    reason: t.reason,
    equityAfter: r2(t.equityAfter),
  }));

  const openMapped = open.map((p) => {
    const holdHours = (now - p.entryT) / 36e5;
    const riskPct = equity > 0 ? (p.riskUsd / equity) * 100 : 0;
    return {
      sym: p.sym,
      side: p.dir === 1 ? 'LONG' : 'SHORT',
      entry: r2(p.entryFill),
      stop: r2(p.stop),
      mark: r2(p.mark),
      markAt: new Date(p.markT).toISOString(),
      qty: +p.qty.toFixed(8),
      notionalUsd: r2(p.notionalUsd),
      riskUsd: r2(p.riskUsd),
      riskPct: r2(riskPct),
      stopDistPct: r2(p.stopDistPct),
      pctToStop: r2(p.pctToStop),
      unrealUsd: r2(p.unrealPnl),
      unrealR: r2(p.unrealR),
      openedAt: new Date(p.entryT).toISOString(),
      barsHeld: p.barsHeld,
      holdHours: r2(holdHours),
      mfeR: r2(p.mfeR),
      maeR: r2(p.maeR),
    };
  });

  const pending = (res.pending || []).map((p) => ({
    sym: p.sym,
    side: p.dir === 1 ? 'LONG' : 'SHORT',
    signalAt: new Date(p.signalT).toISOString(),
    fillsAt: new Date(p.nextOpenT).toISOString(),
  }));

  return {
    schema: 3,
    updatedAt: new Date(now).toISOString(),
    strategy,
    rules,
    paperStart: new Date(startMs).toISOString(),
    startEquity,
    equity: r2(equity),
    realizedEquity: r2(realizedEquity),
    openRiskUsd: r2(openRiskUsd),
    openRiskPct: r2(equity > 0 ? (openRiskUsd / equity) * 100 : 0),
    openNotionalUsd: r2(openNotional),
    drawdownFromPeak: stats.maxDDPct,
    losingStreak: stats.currentStreak,
    halted: stats.maxDDPct < -25 || stats.currentStreak >= 15,
    killRule,
    daysElapsed: Math.max(1, Math.floor((now - startMs) / DAY) + 1),
    daysTotal,
    open: openMapped,
    pending,
    closed,
    stats,
    equityCurve: curve.map((p) => ({ t: new Date(p.t).toISOString(), equity: r2(p.equity) })),
    reference,
    ...extra,
  };
}

module.exports = { buildPayload, computeStats, downsample, drawdown, START_EQUITY };
