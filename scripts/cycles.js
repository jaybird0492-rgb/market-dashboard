const { RAW, loadCsv, closes, mean, pct, report } = require('./lib');
const path = require('path');

const out = [];

// ---------- BTC halving cycle ----------
const HALVINGS = ['2016-07-09', '2020-05-11', '2024-04-19'];
const rows = loadCsv(path.join(RAW, 'BTC_1d.csv')).filter((r) => r.close !== null);
const c = closes(rows);

out.push('========== BTC HALVING CYCLE ANALYSIS ==========');
out.push('Average DAILY return by phase relative to halving (dates: ' + HALVINGS.join(', ') + ')');
const phases = [
  { name: '12m before halving', lo: -365, hi: 0 },
  { name: '12m after halving', lo: 0, hi: 365 },
  { name: 'months 12-24', lo: 365, hi: 730 },
  { name: 'months 24-36', lo: 730, hi: 1095 },
];
for (const ph of phases) {
  const daily = [];
  for (const h of HALVINGS) {
    const hd = new Date(h).getTime();
    const days = [];
    for (const r of rows) {
      const d = new Date(r.timestamp).getTime();
      const delta = (d - hd) / 86400000;
      if (delta > ph.lo && delta <= ph.hi) days.push(r);
    }
    if (!days.length) continue;
    for (let i = 1; i < days.length; i++) {
      daily.push(days[i].close / days[i - 1].close - 1);
    }
  }
  out.push(`  ${ph.name}: ${daily.length ? (mean(daily) * 100).toFixed(3) + '%/day' : 'no data'}`);
}

// Year-after-halving yearly returns
out.push('');
out.push('BTC yearly returns relative to halving years:');
for (let i = 0; i < HALVINGS.length; i++) {
  const hy = parseInt(HALVINGS[i].slice(0, 4), 10);
  const cy = byYear(rows, hy + 1);
  const cy2 = byYear(rows, hy + 2);
  out.push(`  Halving ${hy}: +1y=${cy} | +2y=${cy2}`);
}
function byYear(rows, y) {
  const ys = rows.filter((r) => r.timestamp.slice(0, 4) === String(y));
  if (ys.length < 2) return 'n/a';
  return ((ys[ys.length - 1].close / ys[0].close - 1) * 100).toFixed(0) + '%';
}

// ---------- Drawdown recovery ----------
out.push('');
out.push('========== DRAWDOWN RECOVERY ==========');
const ASSETS = [
  { s: 'AAPL', label: 'Apple', daily: 'AAPL_1d.csv', thr: 0.2 },
  { s: 'GOOGL', label: 'Alphabet', daily: 'GOOGL_1d.csv', thr: 0.2 },
  { s: 'AMZN', label: 'Amazon', daily: 'AMZN_1d.csv', thr: 0.2 },
  { s: 'BTC', label: 'Bitcoin', daily: 'BTC_1d.csv', thr: 0.3 },
  { s: 'ETH', label: 'Ethereum', daily: 'ETH_1d.csv', thr: 0.3 },
];
for (const a of ASSETS) {
  const rowsA = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  let peak = -Infinity;
  let peakIdx = 0;
  let ddStartIdx = 0;
  let ddBottomIdx = 0;
  let ddDepth = 0;
  let inDD = false;
  const episodes = [];
  const recoveries = [];
  for (let i = 0; i < rowsA.length; i++) {
    const pr = rowsA[i].close;
    if (pr > peak) {
      if (inDD) {
        recoveries.push(i - ddStartIdx);
        episodes.push({
          dd: ddDepth,
          from: rowsA[ddStartIdx].timestamp.slice(0, 10),
          bottom: rowsA[ddBottomIdx].timestamp.slice(0, 10),
          daysToBottom: ddBottomIdx - ddStartIdx,
        });
      }
      peak = pr;
      peakIdx = i;
      inDD = false;
    } else {
      const dd = pr / peak - 1;
      if (!inDD && dd <= -a.thr) {
        inDD = true;
        ddStartIdx = peakIdx;
        ddDepth = dd;
        ddBottomIdx = i;
      } else if (inDD && dd < ddDepth) {
        ddDepth = dd;
        ddBottomIdx = i;
      }
    }
  }
  out.push(`${a.label}: ${episodes.length} drawdown episodes below ${a.thr * 100}%`);
  for (const d of episodes.slice(0, 4)) {
    out.push(`  peak ${d.from} -> bottom ${d.bottom} | ${(d.dd * 100).toFixed(0)}% | ${d.daysToBottom}d to bottom`);
  }
  const valid = recoveries.filter((v) => Number.isFinite(v));
  if (valid.length) {
    out.push(`  Recoveries to new high: ${valid.length} | avg ${(mean(valid)).toFixed(0)} days | median ${valid.slice().sort((a, b) => a - b)[Math.floor(valid.length / 2)]} days | max ${Math.max(...valid)} days`);
  }
}

report('cycles', out);
