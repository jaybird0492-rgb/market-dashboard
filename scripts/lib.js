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

function closes(rows) {
  return rows.map((r) => r.close);
}

function pct(a, b) {
  return b / a - 1;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function sma(arr, period) {
  const out = new Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= period) s -= arr[i - period];
    if (i >= period - 1) out[i] = s / period;
  }
  return out;
}

function rsi(closesArr, period = 14) {
  const out = new Array(closesArr.length).fill(null);
  if (closesArr.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closesArr[i] - closesArr[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closesArr.length; i++) {
    const ch = closesArr[i] - closesArr[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function fwd(closesArr, days) {
  return closesArr.map((c, i) =>
    i + days < closesArr.length ? closesArr[i + days] / c - 1 : null
  );
}

function annualized(totalRet, days) {
  return Math.pow(1 + totalRet, 365 / days) - 1;
}

function report(label, lines) {
  const txt = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, `report_${label}.txt`), txt, 'utf8');
  console.log(txt);
}

module.exports = {
  RAW,
  OUT,
  loadCsv,
  closes,
  pct,
  mean,
  sum,
  sma,
  rsi,
  fwd,
  annualized,
  report,
};
