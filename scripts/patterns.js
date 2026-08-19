const { RAW, loadCsv, closes, mean, fwd, report } = require('./lib');
const path = require('path');

const ASSETS = [
  { s: 'AAPL', label: 'Apple', daily: 'AAPL_1d.csv' },
  { s: 'GOOGL', label: 'Alphabet', daily: 'GOOGL_1d.csv' },
  { s: 'AMZN', label: 'Amazon', daily: 'AMZN_1d.csv' },
  { s: 'BTC', label: 'Bitcoin', daily: 'BTC_1d.csv' },
  { s: 'ETH', label: 'Ethereum', daily: 'ETH_1d.csv' },
];

const out = [];

function patterns(rows) {
  const n = rows.length;
  const res = { BE: [], LE: [], HAMMER: [], SHOOTING: [], DOJI: [] };
  for (let i = 1; i < n; i++) {
    const o = rows[i].open, h = rows[i].high, l = rows[i].low, c = rows[i].close;
    const po = rows[i - 1].open, pc = rows[i - 1].close;
    const body = Math.abs(c - o);
    const range = h - l;
    if (range === 0) continue;
    const prevBody = Math.abs(pc - po);
    const upperWick = h - Math.max(o, c);
    const lowerWick = Math.min(o, c) - l;
    // Bullish engulfing
    if (pc < po && c > o && body > prevBody && c >= po && o <= pc) res.LE.push(i);
    // Bearish engulfing
    if (pc > po && c < o && body > prevBody && o >= pc && c <= po) res.BE.push(i);
    // Hammer (after downtrend-ish: prev close < prev open)
    if (pc < po && lowerWick >= 2 * body && upperWick <= body * 0.5 && body > range * 0.05) res.HAMMER.push(i);
    // Shooting star (after uptrend-ish: prev close > prev open)
    if (pc > po && upperWick >= 2 * body && lowerWick <= body * 0.5 && body > range * 0.05) res.SHOOTING.push(i);
    // Doji
    if (body <= range * 0.1) res.DOJI.push(i);
  }
  return res;
}

for (const a of ASSETS) {
  const rows = loadCsv(path.join(RAW, a.daily)).filter((r) => r.close !== null);
  const c = closes(rows);
  const horizons = [1, 5, 10, 20];
  const fwds = horizons.map((d) => fwd(c, d));
  const baselines = horizons.map((d) => mean(fwds[horizons.indexOf(d)].filter((v) => v !== null)));

  out.push('');
  out.push(`========== ${a.label} (${a.s}) — CANDLESTICK PATTERNS, 1d ==========`);
  out.push('Pattern | count | 1d | 5d | 10d | 20d (avg fwd return %; baseline in parens)');
  out.push(`Baseline (all days): ${baselines.map((b) => (b * 100).toFixed(2) + '%').join(' | ')}`);

  const pats = patterns(rows);
  for (const [name, idxs] of Object.entries(pats)) {
    const parts = [name.padEnd(9), String(idxs.length).padEnd(6)];
    for (let k = 0; k < horizons.length; k++) {
      const vals = idxs.map((i) => fwds[k][i]).filter((v) => v !== null);
      if (!vals.length) {
        parts.push('n/a');
        continue;
      }
      const avg = (mean(vals) * 100).toFixed(2);
      const base = (baselines[k] * 100).toFixed(2);
      parts.push(`${avg}% (${base}%)`);
    }
    out.push(parts.join(' | '));
  }
}

report('patterns', out);
