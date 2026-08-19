const { RAW, loadCsv, report, mean } = require('./lib');
const path = require('path');

// Monthly returns per asset
function monthlyReturns(file) {
  const rows = loadCsv(path.join(RAW, file)).filter((r) => r.close !== null);
  const byMonth = new Map();
  for (const r of rows) {
    const m = r.timestamp.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r);
  }
  const months = [...byMonth.keys()].sort();
  const out = [];
  let prev = null;
  for (const m of months) {
    const ms = byMonth.get(m);
    const last = ms[ms.length - 1].close;
    if (prev !== null) out.push({ cal: parseInt(m.slice(5, 7), 10), ym: m, ret: last / prev - 1 });
    prev = last;
  }
  return out;
}

// Permutation test: is the avg return of target month extreme vs random label assignment?
function permTest(months, targetCal, direction = 'gt', nPerm = 10000) {
  const entries = months.map((m) => m.ret);
  const targetEntries = months.filter((m) => m.cal === targetCal);
  if (targetEntries.length < 5) return null;
  const actual = mean(targetEntries.map((m) => m.ret));
  const targetN = targetEntries.length;
  const labels = months.map((m) => m.cal);
  let extreme = 0;
  for (let p = 0; p < nPerm; p++) {
    for (let i = labels.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [labels[i], labels[j]] = [labels[j], labels[i]];
    }
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === targetCal) {
        sum += entries[i];
        cnt++;
      }
    }
    const avg = sum / cnt;
    if (direction === 'gt' && avg >= actual) extreme++;
    if (direction === 'lt' && avg <= actual) extreme++;
  }
  return { actual, targetN, pValue: (extreme + 1) / (nPerm + 1) };
}

const out = [];
out.push('========== SEASONALITY SIGNIFICANCE (permutation tests, 10,000 shuffles) ==========');
out.push('p-value = probability that a random month label assignment produces at least as extreme a return.');

const tests = [
  { label: 'AAPL July (avg +7.02%, up 10/10)', file: 'AAPL_1d.csv', cal: 7, dir: 'gt' },
  { label: 'GOOGL July (avg +5.85%, up 8/10)', file: 'GOOGL_1d.csv', cal: 7, dir: 'gt' },
  { label: 'AMZN July (avg +6.37%, up 7/10)', file: 'AMZN_1d.csv', cal: 7, dir: 'gt' },
  { label: 'BTC October (avg +17.91%, up 8/10)', file: 'BTC_1d.csv', cal: 10, dir: 'gt' },
  { label: 'BTC April (avg +11.76%, up 7/10)', file: 'BTC_1d.csv', cal: 4, dir: 'gt' },
  { label: 'BTC June (avg -4.04%)', file: 'BTC_1d.csv', cal: 6, dir: 'lt' },
  { label: 'ETH June (avg -11.67%, up 2/9)', file: 'ETH_1d.csv', cal: 6, dir: 'lt' },
  { label: 'ETH January (avg +14.70%)', file: 'ETH_1d.csv', cal: 1, dir: 'gt' },
  { label: 'AAPL September (avg -1.96%)', file: 'AAPL_1d.csv', cal: 9, dir: 'lt' },
];

for (const t of tests) {
  const months = monthlyReturns(t.file);
  const r = permTest(months, t.cal, t.dir);
  if (!r) {
    out.push(`  ${t.label}: insufficient data`);
    continue;
  }
  const sig = r.pValue < 0.05 ? 'SIGNIFICANT' : r.pValue < 0.1 ? 'weak' : 'not significant';
  out.push(`  ${t.label} -> actual avg ${(r.actual * 100).toFixed(2)}% | p=${r.pValue.toFixed(4)} | ${sig}`);
}

report('significance', out);
