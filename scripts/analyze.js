const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const OUT = path.join(__dirname, '..', 'analysis');
fs.mkdirSync(OUT, { recursive: true });

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function loadCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return {
      timestamp: c[0],
      open: num(c[1]),
      high: num(c[2]),
      low: num(c[3]),
      close: num(c[4]),
      volume: num(c[5]),
    };
  });
}

function pct(a, b) {
  return b / a - 1;
}

// ---------- Daily/weekly/monthly analysis ----------
function analyzeDaily(rows, label) {
  const clean = rows.filter((r) => r.close !== null);
  const out = [];

  // Yearly returns
  const byYear = new Map();
  for (const r of clean) {
    const y = r.timestamp.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }
  const years = [...byYear.keys()].sort();
  out.push(`--- ${label} | YEARLY RETURNS (1d data) ---`);
  let prevClose = null;
  const yearlyRet = [];
  for (const y of years) {
    const rowsY = byYear.get(y);
    const first = rowsY[0].close;
    const last = rowsY[rowsY.length - 1].close;
    const ret = prevClose !== null ? pct(prevClose, last) : null;
    prevClose = last;
    const gain = ret !== null ? ((ret * 100).toFixed(1) + '%') : '(start of data)';
    yearlyRet.push(ret);
    out.push(`${y}: open ${first.toFixed(2)} -> close ${last.toFixed(2)}  (${gain})`);
  }
  const posYears = yearlyRet.filter((r) => r !== null && r > 0).length;
  const totalYears = yearlyRet.filter((r) => r !== null).length;
  out.push(`Positive years: ${posYears}/${totalYears}`);

  // Monthly seasonality
  const byMonth = new Map();
  for (const r of clean) {
    const m = r.timestamp.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r);
  }
  const months = [...byMonth.keys()].sort();
  const monthRet = {}; // calendar month -> array of returns
  prevClose = null;
  for (const m of months) {
    const rowsM = byMonth.get(m);
    const last = rowsM[rowsM.length - 1].close;
    if (prevClose !== null) {
      const cal = parseInt(m.slice(5, 7), 10);
      if (!monthRet[cal]) monthRet[cal] = [];
      monthRet[cal].push(pct(prevClose, last));
    }
    prevClose = last;
  }
  out.push('');
  out.push('--- MONTHLY SEASONALITY (avg return per calendar month) ---');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let m = 1; m <= 12; m++) {
    const arr = monthRet[m] || [];
    if (!arr.length) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const pos = arr.filter((x) => x > 0).length;
    out.push(
      `${names[m - 1]}: avg ${(avg * 100).toFixed(2)}% | up ${pos}/${arr.length} months | values: ${arr
        .map((x) => (x * 100).toFixed(1) + '%')
        .join(', ')}`
    );
  }

  // Day of week
  out.push('');
  out.push('--- DAY-OF-WEEK EFFECT ---');
  const dow = {};
  prevClose = null;
  for (const r of clean) {
    if (prevClose !== null) {
      const d = new Date(r.timestamp);
      const wd = d.getUTCDay();
      if (!dow[wd]) dow[wd] = [];
      dow[wd].push(pct(prevClose, r.close));
    }
    prevClose = r.close;
  }
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let wd = 0; wd < 7; wd++) {
    const arr = dow[wd];
    if (!arr || !arr.length) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const pos = arr.filter((x) => x > 0).length;
    out.push(`${dowNames[wd]}: avg ${(avg * 100).toFixed(3)}% | up ${pos}/${arr.length} days`);
  }

  // Max drawdown
  let peak = -Infinity;
  let peakDate = null;
  let maxDD = 0;
  let ddStart = null;
  let ddEnd = null;
  for (const r of clean) {
    if (r.close > peak) {
      peak = r.close;
      peakDate = r.timestamp.slice(0, 10);
    } else {
      const dd = r.close / peak - 1;
      if (dd < maxDD) {
        maxDD = dd;
        ddStart = peakDate;
        ddEnd = r.timestamp.slice(0, 10);
      }
    }
  }
  out.push('');
  out.push(`--- MAX DRAWDOWN: ${(maxDD * 100).toFixed(1)}% (${ddStart} -> ${ddEnd}) ---`);

  // Volatility by year (annualized std of daily returns)
  out.push('');
  out.push('--- VOLATILITY BY YEAR (annualized) ---');
  for (const y of years) {
    const rowsY = byYear.get(y);
    const rets = [];
    for (let i = 1; i < rowsY.length; i++) {
      rets.push(Math.log(rowsY[i].close / rowsY[i - 1].close));
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    const vol = Math.sqrt(variance) * Math.sqrt(365) * 100;
    out.push(`${y}: ${vol.toFixed(1)}%`);
  }
  return out;
}

// ---------- Intraday (1h) analysis ----------
function analyzeHourly(rows, label) {
  const clean = rows.filter((r) => r.close !== null);
  const out = [];
  const first = clean[0];
  const last = clean[clean.length - 1];
  out.push('');
  out.push(`--- ${label} | 1h ANALYSIS (${first.timestamp.slice(0, 10)} -> ${last.timestamp.slice(0, 10)}) ---`);

  // Hour-of-day effect (UTC)
  const hourRet = {};
  for (let i = 1; i < clean.length; i++) {
    const d = new Date(clean[i - 1].timestamp);
    const h = d.getUTCHours();
    if (!hourRet[h]) hourRet[h] = [];
    hourRet[h].push(pct(clean[i - 1].close, clean[i].close));
  }
  out.push('Average return by hour of day (UTC):');
  for (let h = 0; h < 24; h++) {
    const arr = hourRet[h];
    if (!arr || !arr.length) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    out.push(`  ${String(h).padStart(2, '0')}:00 -> ${(avg * 100).toFixed(4)}% (n=${arr.length})`);
  }

  // Volatility by hour
  out.push('');
  out.push('Hourly volatility (avg |return| %):');
  for (let h = 0; h < 24; h++) {
    const arr = hourRet[h];
    if (!arr || !arr.length) continue;
    const avgAbs = arr.reduce((a, b) => a + Math.abs(b), 0) / arr.length;
    out.push(`  ${String(h).padStart(2, '0')}:00 -> ${(avgAbs * 100).toFixed(4)}%`);
  }

  // Day-of-week on 1h data
  const dow = {};
  for (let i = 1; i < clean.length; i++) {
    const d = new Date(clean[i - 1].timestamp);
    const wd = d.getUTCDay();
    if (!dow[wd]) dow[wd] = [];
    dow[wd].push(pct(clean[i - 1].close, clean[i].close));
  }
  out.push('');
  out.push('Average return by day of week (1h data):');
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let wd = 0; wd < 7; wd++) {
    const arr = dow[wd];
    if (!arr || !arr.length) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    out.push(`  ${dowNames[wd]}: ${(avg * 100).toFixed(4)}%`);
  }
  return out;
}

// ---------- 4h analysis (crypto only) ----------
function analyzeFourHour(rows, label) {
  const clean = rows.filter((r) => r.close !== null);
  const out = [];
  out.push('');
  out.push(`--- ${label} | 4h ANALYSIS (${clean.length} bars) ---`);
  const blockRet = {};
  for (let i = 1; i < clean.length; i++) {
    const d = new Date(clean[i - 1].timestamp);
    const h = d.getUTCHours();
    const block = Math.floor(h / 4);
    if (!blockRet[block]) blockRet[block] = [];
    blockRet[block].push(pct(clean[i - 1].close, clean[i].close));
  }
  out.push('Average return by 4h block (UTC):');
  for (let b = 0; b < 6; b++) {
    const arr = blockRet[b];
    if (!arr || !arr.length) continue;
    const avg = arr.reduce((a, c) => a + c, 0) / arr.length;
    const pos = arr.filter((x) => x > 0).length;
    out.push(`  ${b * 4}:00-${b * 4 + 4}:00 -> ${(avg * 100).toFixed(4)}% | up ${pos}/${arr.length}`);
  }
  return out;
}

// ---------- Main ----------
const assets = [
  { symbol: 'AAPL', label: 'Apple (AAPL)', intraday: true },
  { symbol: 'GOOGL', label: 'Alphabet (GOOGL)', intraday: true },
  { symbol: 'AMZN', label: 'Amazon (AMZN)', intraday: true },
  { symbol: 'BTC', label: 'Bitcoin (BTC)', intraday: true, fourHour: true },
  { symbol: 'ETH', label: 'Ethereum (ETH)', intraday: true, fourHour: true },
];

for (const a of assets) {
  const daily = loadCsv(path.join(RAW, `${a.symbol}_1d.csv`));
  const lines = analyzeDaily(daily, a.label);
  if (a.fourHour) {
    const fh = loadCsv(path.join(RAW, `${a.symbol}_4h.csv`));
    lines.push(...analyzeFourHour(fh, a.label));
  }
  if (a.intraday) {
    const hourly = loadCsv(path.join(RAW, `${a.symbol}_1h.csv`));
    lines.push(...analyzeHourly(hourly, a.label));
  }
  const file = path.join(OUT, `report_${a.symbol}.txt`);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  console.log(lines.join('\n'));
  console.log('');
}
console.log('Reports saved to', OUT);