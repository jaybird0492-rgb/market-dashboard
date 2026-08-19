const { RAW, loadCsv, closes, sma, pct, fwd, mean, report } = require('./lib');
const path = require('path');

const ASSETS = [
  { s: 'AAPL', label: 'Apple', daily: 'AAPL_1d.csv' },
  { s: 'GOOGL', label: 'Alphabet', daily: 'GOOGL_1d.csv' },
  { s: 'AMZN', label: 'Amazon', daily: 'AMZN_1d.csv' },
  { s: 'BTC', label: 'Bitcoin', daily: 'BTC_1d.csv' },
  { s: 'ETH', label: 'Ethereum', daily: 'ETH_1d.csv' },
];

const out = [];

for (const a of ASSETS) {
  const rows = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  const c = closes(rows);
  const ma50 = sma(c, 50);
  const ma200 = sma(c, 200);
  const f30 = fwd(c, 30);
  const f90 = fwd(c, 90);
  const f365 = fwd(c, 365);

  out.push('');
  out.push(`========== ${a.label} (${a.s}) — TREND STRUCTURE, 1d ==========`);

  // Regime: % days above MA200, % days MA50>MA200
  let above200 = 0;
  let bullRegime = 0;
  for (let i = 200; i < c.length; i++) {
    if (c[i] > ma200[i]) above200++;
    if (ma50[i] > ma200[i]) bullRegime++;
  }
  const n = c.length - 200;
  out.push(`Days above MA200: ${((above200 / n) * 100).toFixed(1)}% | Days MA50>MA200 (bull regime): ${((bullRegime / n) * 100).toFixed(1)}%`);

  // Golden / death crosses and forward returns
  let lastState = null;
  const crosses = [];
  for (let i = 200; i < c.length; i++) {
    const state = ma50[i] > ma200[i] ? 1 : 0;
    if (lastState !== null && state !== lastState) {
      crosses.push({ idx: i, type: state === 1 ? 'GOLDEN' : 'DEATH', price: c[i] });
    }
    lastState = state;
  }
  out.push(`Crosses (MA50/MA200): ${crosses.length} (${crosses.filter((x) => x.type === 'GOLDEN').length} golden, ${crosses.filter((x) => x.type === 'DEATH').length} death)`);
  for (const kind of ['GOLDEN', 'DEATH']) {
    const list = crosses.filter((x) => x.type === kind);
    if (!list.length) continue;
    const r30 = list.map((x) => f30[x.idx]).filter((v) => v !== null);
    const r90 = list.map((x) => f90[x.idx]).filter((v) => v !== null);
    const r365 = list.map((x) => f365[x.idx]).filter((v) => v !== null);
    const fmt = (arr) =>
      arr.length ? `${(mean(arr) * 100).toFixed(1)}% (${arr.map((v) => (v * 100).toFixed(0) + '%').join(', ')})` : 'n/a';
    out.push(`  After ${kind} cross: 30d ${fmt(r30)} | 90d ${fmt(r90)} | 365d ${fmt(r365)}`);
  }

  // Year-by-year regime classification
  out.push('');
  out.push('Year-by-year: [return] [maxDD] [days>MA200] [regime]');
  const byYear = new Map();
  for (const r of rows) {
    const y = r.timestamp.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }
  const years = [...byYear.keys()].sort();
  let prevClose = null;
  let upStreak = 0;
  let maxUpStreak = 0;
  let downStreak = 0;
  let maxDownStreak = 0;
  for (const y of years) {
    const ry = byYear.get(y);
    const first = ry[0];
    const last = ry[ry.length - 1];
    const ret = prevClose !== null ? pct(prevClose, last.close) : null;
    prevClose = last.close;
    let peak = -Infinity;
    let maxDD = 0;
    let above = 0;
    for (const r of ry) {
      if (r.close > peak) peak = r.close;
      else maxDD = Math.min(maxDD, r.close / peak - 1);
      const idx = rows.indexOf(r);
      if (idx >= 200 && r.close > ma200[idx]) above++;
    }
    const totalDays = ry.length;
    const pctAbove = ((above / totalDays) * 100).toFixed(0);
    let regime;
    if (ret !== null && ret > 0.15 && maxDD > -0.15) regime = 'BULL';
    else if (ret !== null && ret < -0.1) regime = 'BEAR';
    else if (pctAbove > 60) regime = 'BULL';
    else if (pctAbove < 40) regime = 'BEAR';
    else regime = 'RANGE';
    if (ret !== null && ret > 0) {
      upStreak++;
      downStreak = 0;
    } else if (ret !== null) {
      downStreak++;
      upStreak = 0;
    }
    maxUpStreak = Math.max(maxUpStreak, upStreak);
    maxDownStreak = Math.max(maxDownStreak, downStreak);
    out.push(
      `${y}: ${ret === null ? 'n/a' : (ret * 100).toFixed(1) + '%'} | ${(maxDD * 100).toFixed(0)}% | ${pctAbove}% | ${regime}`
    );
  }
  out.push(`Longest streak of up years: ${maxUpStreak} | down years: ${maxDownStreak}`);
}

report('trends', out);
