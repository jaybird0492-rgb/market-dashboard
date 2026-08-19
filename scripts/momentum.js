const { RAW, loadCsv, closes, sma, rsi, fwd, mean, pct, report } = require('./lib');
const path = require('path');

const ASSETS = [
  { s: 'AAPL', label: 'Apple', daily: 'AAPL_1d.csv' },
  { s: 'GOOGL', label: 'Alphabet', daily: 'GOOGL_1d.csv' },
  { s: 'AMZN', label: 'Amazon', daily: 'AMZN_1d.csv' },
  { s: 'BTC', label: 'Bitcoin', daily: 'BTC_1d.csv' },
  { s: 'ETH', label: 'Ethereum', daily: 'ETH_1d.csv' },
];

const out = [];

function bucketize(idxList, fwds) {
  const res = [];
  for (const [label, idxs] of Object.entries(idxList)) {
    const parts = [label.padEnd(14), String(idxs.length).padEnd(6)];
    for (const f of fwds) {
      const vals = idxs.map((i) => f[1][i]).filter((v) => v !== null);
      parts.push(vals.length ? (mean(vals) * 100).toFixed(2) + '%' : 'n/a');
    }
    res.push(parts.join(' | '));
  }
  return res;
}

for (const a of ASSETS) {
  const rows = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  const c = closes(rows);
  const r = rsi(c, 14);
  const f5 = fwd(c, 5);
  const f10 = fwd(c, 10);
  const f20 = fwd(c, 20);
  const f60 = fwd(c, 60);
  const ma20 = sma(c, 20);
  const vol20 = sma(rows.map((x) => x.volume), 20);
  const ma200 = sma(c, 200);

  out.push('');
  out.push(`========== ${a.label} (${a.s}) — MOMENTUM & SENTIMENT, 1d ==========`);

  // RSI buckets
  const rsiBuckets = { '<30 (oversold)': [], '30-45': [], '45-55': [], '55-70': [], '>70 (overbought)': [] };
  for (let i = 14; i < c.length; i++) {
    const v = r[i];
    if (v === null) continue;
    const bucket =
      v < 30 ? '<30 (oversold)' : v < 45 ? '30-45' : v < 55 ? '45-55' : v < 70 ? '55-70' : '>70 (overbought)';
    rsiBuckets[bucket].push(i);
  }
  out.push('RSI(14) buckets -> 5d | 10d | 20d | 60d avg fwd return:');
  for (const line of bucketize(rsiBuckets, [['5d', f5], ['10d', f10], ['20d', f20], ['60d', f60]])) out.push('  ' + line);

  // Streaks
  const up3 = [], down3 = [], up5 = [], down5 = [];
  let streak = 0;
  let dir = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] > c[i - 1] ? 1 : c[i] < c[i - 1] ? -1 : 0;
    if (d !== 0) {
      if (d === dir) streak++;
      else { streak = 1; dir = d; }
    } else {
      streak = 0;
      dir = 0;
    }
    if (streak >= 3 && dir === 1) up3.push(i);
    if (streak >= 3 && dir === -1) down3.push(i);
    if (streak >= 5 && dir === 1) up5.push(i);
    if (streak >= 5 && dir === -1) down5.push(i);
  }
  out.push('Consecutive-day streaks -> 5d | 10d | 20d avg fwd return:');
  for (const line of bucketize({ '3+ up days': up3, '3+ down days': down3, '5+ up days': up5, '5+ down days': down5 }, [['5d', f5], ['10d', f10], ['20d', f20]])) out.push('  ' + line);

  // Volume spikes
  const volSpike = [];
  for (let i = 20; i < c.length; i++) {
    if (rows[i].volume > 2 * vol20[i]) volSpike.push(i);
  }
  out.push('Volume spike (>2x 20d avg) -> 5d | 10d | 20d avg fwd return:');
  for (const line of bucketize({ spike: volSpike }, [['5d', f5], ['10d', f10], ['20d', f20]])) out.push('  ' + line);

  // 52-week high / low
  const hi52 = [], lo52 = [];
  for (let i = 252; i < c.length; i++) {
    const win = c.slice(i - 252, i);
    if (c[i] > Math.max(...win) * 0.999) hi52.push(i);
    if (c[i] < Math.min(...win) * 1.001) lo52.push(i);
  }
  out.push('52-week high breakout / low breakdown -> 20d | 60d avg fwd return:');
  for (const line of bucketize({ '52w high': hi52, '52w low': lo52 }, [['20d', f20], ['60d', f60]])) out.push('  ' + line);

  // Extended moves from MA200
  const extUp = [], extDown = [];
  for (let i = 200; i < c.length; i++) {
    const ratio = c[i] / ma200[i];
    if (ratio > 1.3) extUp.push(i);
    if (ratio < 0.8) extDown.push(i);
  }
  out.push('Price vs MA200 (extended) -> 20d | 60d avg fwd return:');
  for (const line of bucketize({ '>30% above MA200': extUp, '<20% below MA200': extDown }, [['20d', f20], ['60d', f60]])) out.push('  ' + line);

  // Gap analysis (stocks only)
  if (a.s !== 'BTC' && a.s !== 'ETH') {
    const gaps = [];
    for (let i = 1; i < c.length; i++) {
      const g = rows[i].open / c[i - 1] - 1;
      if (Math.abs(g) > 0.01) gaps.push({ i, g });
    }
    const upGaps = gaps.filter((x) => x.g > 0);
    const dnGaps = gaps.filter((x) => x.g < 0);
    const f1 = fwd(c, 1);
    const fmt = (arr, f) => {
      const vals = arr.map((x) => f[x.i]).filter((v) => v !== null);
      return vals.length ? (mean(vals) * 100).toFixed(2) + '%' : 'n/a';
    };
    out.push(`Gaps >1%: up ${upGaps.length} | down ${dnGaps.length} | next-day avg fwd: up-gap ${fmt(upGaps, f1)}, down-gap ${fmt(dnGaps, f1)}`);
  }
}

// Correlation matrix on daily returns
out.push('');
out.push('========== CORRELATION OF DAILY RETURNS ==========');
const all = {};
for (const a of ASSETS) {
  const rows = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  all[a.s] = { rows };
}
function corrPairs(x, y) {
  const mapX = new Map(x.rows.map((r) => [r.timestamp.slice(0, 10), r.close]));
  const pairs = [];
  for (const r of y.rows) {
    const k = r.timestamp.slice(0, 10);
    const cx = mapX.get(k);
    if (cx !== undefined && cx !== null) {
      const px = x.rows.find((rr) => rr.timestamp.slice(0, 10) === k);
      if (px) pairs.push([cx, r.close]);
    }
  }
  return pairs;
}
function pearson(pairs) {
  const n = pairs.length;
  if (n < 30) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pairs) { mx += x; my += y; }
  mx /= n; my /= n;
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
const syms = ['AAPL', 'GOOGL', 'AMZN', 'BTC', 'ETH'];
out.push('  ' + syms.map((s) => s.padStart(6)).join(''));
for (const x of syms) {
  const row = [x.padStart(4)];
  for (const y of syms) {
    if (x === y) { row.push('  1.00'); continue; }
    const pairs = corrPairs(all[y], all[x]);
    const rets = pairs.slice(1).map((p, i) => [p[0] / pairs[i][0] - 1, p[1] / pairs[i][1] - 1]);
    const corr = pearson(rets);
    row.push((corr === null ? 'n/a' : corr.toFixed(2)).padStart(6));
  }
  out.push(row.join(''));
}

report('momentum', out);
