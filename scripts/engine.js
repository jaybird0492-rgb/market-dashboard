const { annualized } = require('./lib');

function runBacktest(rows, positions, feePerSide) {
  const c = rows.map((r) => r.close);
  const n = c.length;
  let cash = 1;
  let pos = 0;
  let entryPrice = 0;
  let entryIdx = 0;
  let trades = 0;
  let wins = 0;
  let prevEq = 1;
  let peak = 1;
  let maxDD = 0;
  let curDD = 0;
  let maxDDdays = 0;
  const dailyRets = new Array(n).fill(0);
  const tradeList = [];
  for (let i = 0; i < n; i++) {
    const target = positions[i] ? 1 : 0;
    if (target !== pos) {
      if (target === 1) {
        cash *= 1 - feePerSide;
        entryPrice = c[i];
        entryIdx = i;
      } else {
        const ret = c[i] / entryPrice - 1;
        cash *= (1 + ret) * (1 - feePerSide);
        trades++;
        if (ret > 0) wins++;
        tradeList.push({
          from: rows[entryIdx].timestamp.slice(0, 10),
          to: rows[i].timestamp.slice(0, 10),
          ret,
        });
      }
      pos = target;
    }
    const eq = pos === 1 ? cash * (c[i] / entryPrice) : cash;
    if (i > 0) dailyRets[i] = eq / prevEq - 1;
    prevEq = eq;
    if (eq > peak) {
      peak = eq;
      curDD = 0;
    } else {
      curDD++;
      maxDDdays = Math.max(maxDDdays, curDD);
      maxDD = Math.min(maxDD, eq / peak - 1);
    }
  }
  if (pos === 1) {
    cash *= c[n - 1] / entryPrice;
    trades++;
    if (c[n - 1] > entryPrice) wins++;
  }
  const total = cash - 1;
  const rets = dailyRets.slice(1);
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
  const downs = rets.filter((r) => r < 0);
  const sdd = Math.sqrt(downs.reduce((a, b) => a + b * b, 0) / Math.max(downs.length - 1, 1));
  return {
    total,
    ann: annualized(total, n),
    sharpe: sd ? (m / sd) * Math.sqrt(365) : 0,
    sortino: sdd ? (m / sdd) * Math.sqrt(365) : 0,
    maxDD,
    maxDDdays,
    trades,
    wins,
    winRate: trades ? wins / trades : 0,
    inMarket: positions.reduce((a, b) => a + b, 0) / n,
    dailyRets,
    tradeList,
  };
}

function statsFromDaily(dailyRets) {
  const n = dailyRets.length;
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  for (let i = 1; i < n; i++) {
    eq *= 1 + dailyRets[i];
    peak = Math.max(peak, eq);
    maxDD = Math.min(maxDD, eq / peak - 1);
  }
  const total = eq - 1;
  const slice = dailyRets.slice(1);
  const m = slice.reduce((a, b) => a + b, 0) / slice.length;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / (slice.length - 1));
  const downs = slice.filter((r) => r < 0);
  const sdd = Math.sqrt(downs.reduce((a, b) => a + b * b, 0) / Math.max(downs.length - 1, 1));
  return {
    total,
    ann: annualized(total, n),
    sharpe: sd ? (m / sd) * Math.sqrt(365) : 0,
    sortino: sdd ? (m / sdd) * Math.sqrt(365) : 0,
    maxDD,
  };
}

module.exports = { runBacktest, statsFromDaily };
