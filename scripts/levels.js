const { RAW, loadCsv, closes, mean, pct, report } = require('./lib');
const path = require('path');

const ASSETS = [
  { s: 'AAPL', label: 'Apple', daily: 'AAPL_1d.csv' },
  { s: 'GOOGL', label: 'Alphabet', daily: 'GOOGL_1d.csv' },
  { s: 'AMZN', label: 'Amazon', daily: 'AMZN_1d.csv' },
  { s: 'BTC', label: 'Bitcoin', daily: 'BTC_1d.csv' },
  { s: 'ETH', label: 'Ethereum', daily: 'ETH_1d.csv' },
];

const out = [];

function findSwings(highs, lows, w) {
  const swingHighs = [];
  const swingLows = [];
  for (let i = w; i < highs.length - w; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (highs[j] > highs[i]) isH = false;
      if (lows[j] < lows[i]) isL = false;
    }
    if (isH) swingHighs.push({ idx: i, price: highs[i] });
    if (isL) swingLows.push({ idx: i, price: lows[i] });
  }
  return { swingHighs, swingLows };
}

function cluster(swings, tolPct) {
  const sorted = swings.slice().sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const sw of sorted) {
    let placed = false;
    for (const cl of clusters) {
      if (Math.abs(sw.price / cl.median - 1) < tolPct) {
        cl.points.push(sw);
        cl.median = mean(cl.points.map((p) => p.price));
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ median: sw.price, points: [sw] });
  }
  return clusters
    .filter((cl) => cl.points.length >= 3)
    .sort((a, b) => b.points.length - a.points.length);
}

for (const a of ASSETS) {
  const rows = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);
  const c = closes(rows);
  const tol = 0.06; // 6% clustering tolerance

  out.push('');
  out.push(`========== ${a.label} (${a.s}) — SUPPORT & RESISTANCE (swing w=3, ${tol * 100}% tol) ==========`);

  const { swingHighs, swingLows } = findSwings(highs, lows, 3);
  const resist = cluster(swingHighs, tol).slice(0, 6);
  const support = cluster(swingLows, tol).slice(0, 6);

  out.push('Resistance clusters (price | touches | last touch):');
  for (const cl of resist) {
    const last = new Date(rows[cl.points[cl.points.length - 1].idx].timestamp).toISOString().slice(0, 10);
    out.push(`  ~$${cl.median.toFixed(2)} | ${cl.points.length} touches | last ${last}`);
  }
  out.push('Support clusters (price | touches | last touch):');
  for (const cl of support) {
    const last = new Date(rows[cl.points[cl.points.length - 1].idx].timestamp).toISOString().slice(0, 10);
    out.push(`  ~$${cl.median.toFixed(2)} | ${cl.points.length} touches | last ${last}`);
  }

  // Bounce/rejection behavior around top support and resistance
  const f5 = [];
  const f10 = [];
  for (let i = 0; i < c.length; i++) {
    f5.push(i + 5 < c.length ? c[i + 5] / c[i] - 1 : null);
    f10.push(i + 10 < c.length ? c[i + 10] / c[i] - 1 : null);
  }
  const baseline5 = mean(f5.filter((v) => v !== null));
  const baseline10 = mean(f10.filter((v) => v !== null));

  if (support.length) {
    const L = support[0].median;
    const touches = support[0].points;
    const touchIdx = new Set(touches.map((t) => t.idx));
    const b5 = [];
    const b10 = [];
    for (const t of touches) {
      // look 2-6 bars after the swing for a touch of the level
      for (let d = 1; d <= 3; d++) {
        const i = t.idx + d;
        if (i >= rows.length) break;
        if (rows[i].low <= L) {
          b5.push(f5[i]);
          b10.push(f10[i]);
          break;
        }
      }
    }
    b5.filter((v) => v !== null);
    b10.filter((v) => v !== null);
    out.push(`Top support ~$${L.toFixed(2)}: after touch, 5d avg ${b5.length ? (mean(b5) * 100).toFixed(2) + '%' : 'n/a'} (baseline ${(baseline5 * 100).toFixed(2)}%) | 10d avg ${b10.length ? (mean(b10) * 100).toFixed(2) + '%' : 'n/a'} (baseline ${(baseline10 * 100).toFixed(2)}%)`);
  }
  if (resist.length) {
    const L = resist[0].median;
    const touches = resist[0].points;
    const b5 = [];
    const b10 = [];
    for (const t of touches) {
      for (let d = 1; d <= 3; d++) {
        const i = t.idx + d;
        if (i >= rows.length) break;
        if (rows[i].high >= L) {
          b5.push(f5[i]);
          b10.push(f10[i]);
          break;
        }
      }
    }
    out.push(`Top resistance ~$${L.toFixed(2)}: after touch, 5d avg ${b5.length ? (mean(b5) * 100).toFixed(2) + '%' : 'n/a'} (baseline ${(baseline5 * 100).toFixed(2)}%) | 10d avg ${b10.length ? (mean(b10) * 100).toFixed(2) + '%' : 'n/a'} (baseline ${(baseline10 * 100).toFixed(2)}%)`);
  }
}

report('levels', out);
