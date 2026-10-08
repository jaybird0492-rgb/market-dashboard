const fs = require('fs');
const path = require('path');
const { computeEquity, seasonality, annualized } = require('./sim');
const { getAsset } = require('./ta');
const { computeAll, loadLog } = require('./setups');
const { evaluateAll } = require('./setup_backtest');
const { buildAutopsy } = require('./autopsy');

const WEB = path.join(__dirname, '..', 'web', 'data');
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'HYPE'];

function write(name, obj) {
  fs.mkdirSync(WEB, { recursive: true });
  fs.writeFileSync(path.join(WEB, name), JSON.stringify(obj), 'utf8');
}

function buildEquity() {
  const plain = computeEquity({ BTC: 0.55, ETH: 0.45 });
  const btc = computeEquity({ BTC: 1 });
  const eth = computeEquity({ ETH: 1 });
  const step = 3;
  const dates = [], p = [], b = [], e = [];
  for (let i = 0; i < plain.n; i += step) {
    dates.push(plain.dates[i]);
    p.push(+(plain.equity[i] - 1).toFixed(4));
    b.push(+(btc.equity[i] - 1).toFixed(4));
    e.push(+(eth.equity[i] - 1).toFixed(4));
  }
  const calc = (eq) => {
    const total = eq.equity[eq.n - 1] - 1;
    let peak = eq.equity[0], maxDD = 0;
    for (const v of eq.equity) {
      if (v > peak) peak = v;
      const dd = peak > 0 ? (v - peak) / peak : 0;
      if (dd < maxDD) maxDD = dd;
    }
    return { total: +total.toFixed(3), ann: +(annualized(total, eq.n) * 100).toFixed(1), maxDD: +maxDD.toFixed(3) };
  };
  return {
    dates, plain: p, btc: b, eth: e,
    from: plain.dates[0] || null,
    to: plain.dates[plain.n - 1] || null,
    stats: {
      plain: calc(plain), btc: calc(btc), eth: calc(eth),
    },
    seasonality: seasonality(),
  };
}

function bandOf(score) {
  const sc = Math.abs(score || 0);
  return sc >= 50 ? '50+' : sc >= 35 ? '35-50' : sc >= 20 ? '20-35' : '0-20';
}

function buildTrack() {
  const log = loadLog();
  const perCoin = {};
  const perTf = {};
  const bands = {}; // bands[sym][tf][band] = {n, winRate, avgPct, weak}
  const overall = { total: 0, sl: 0, slAfterTp: 0, tp1: 0, tp2: 0, tp3: 0, partial: 0, open: 0, sumRealized: 0, noTrade: 0 };
  const d1stats = {};
  for (const sym of SYMBOLS) {
    const bt = evaluateAll(sym);
    const coin = { total: 0, sl: 0, slAfterTp: 0, tp1: 0, tp2: 0, tp3: 0, partial: 0, open: 0, sumRealized: 0, noTrade: 0 };
    bands[sym] = {};
    for (const tf of Object.keys(bt)) {
      const s = bt[tf].stats;
      const sumR = bt[tf].results.reduce((a, r) => a + r.bt.realized, 0);
      const noTrade = ((log[sym] && log[sym][tf]) || []).length - s.total;
      const t = (perTf[tf] = perTf[tf] || { total: 0, sl: 0, slAfterTp: 0, tp1: 0, tp2: 0, tp3: 0, partial: 0, open: 0, sumRealized: 0, noTrade: 0 });
      for (const k of ['total', 'sl', 'slAfterTp', 'tp1', 'tp2', 'tp3', 'partial', 'open']) {
        coin[k] += s[k]; t[k] += s[k]; overall[k] += s[k];
      }
      coin.sumRealized += sumR; t.sumRealized += sumR; overall.sumRealized += sumR;
      coin.noTrade += noTrade; t.noTrade += noTrade; overall.noTrade += noTrade;
      if (tf === '1D') {
        const dec = bt[tf].results.filter((r) => r.bt.hit.includes('TP1') || r.bt.status === 'SL');
        const w = dec.filter((r) => r.bt.hit.includes('TP1')).length;
        d1stats[sym] = { winRate: dec.length ? Math.round((w / dec.length) * 100) : 0, n: dec.length };
      }
      // Score-band history for this coin x TF.
      const bb = (bands[sym][tf] = {});
      for (const r of bt[tf].results) {
        const key = bandOf(r.entry.score);
        bb[key] = bb[key] || { n: 0, w: 0, l: 0, sum: 0 };
        bb[key].n++;
        if (r.bt.hit.includes('TP1')) bb[key].w++;
        if (r.bt.status === 'SL') bb[key].l++;
        bb[key].sum += r.bt.realized;
      }
      for (const key of Object.keys(bb)) {
        const v = bb[key];
        const dec = v.w + v.l;
        const winRate = dec ? Math.round((v.w / dec) * 100) : 0;
        bb[key] = { n: v.n, winRate, avgPct: +(v.sum / v.n * 100).toFixed(2), weak: v.n >= 5 && winRate < 40 };
      }
    }
    for (const k of Object.keys(coin)) {
      if (k !== 'sumRealized') coin[k] = Math.round(coin[k]);
      else coin[k] = +coin[k].toFixed(4);
    }
    perCoin[sym] = coin;
  }
  for (const k of Object.keys(overall)) {
    if (k !== 'sumRealized') overall[k] = Math.round(overall[k]);
    else overall[k] = +overall[k].toFixed(4);
  }
  for (const tf of Object.keys(perTf)) {
    for (const k of Object.keys(perTf[tf])) {
      if (k !== 'sumRealized') perTf[tf][k] = Math.round(perTf[tf][k]);
      else perTf[tf][k] = +perTf[tf][k].toFixed(4);
    }
  }
  // Per-coin sizing follows DECIDED 1D outcomes only (TP1-hit or stopped; OPEN
  // marks excluded so sizing never flip-flops on unrealized swings): FULL at
  // >=50% win over >=2 decisions, else REDUCED-1D-ONLY. Intraday stays
  // band-gated on every coin regardless.
  for (const sym of SYMBOLS) {
    const d = d1stats[sym] || { winRate: 0, n: 0 };
    perCoin[sym].d1winRate = d.winRate;
    perCoin[sym].size = (d.n >= 2 && d.winRate >= 50) ? 'FULL' : 'REDUCED-1D-ONLY';
  }
  return { updatedAt: new Date().toISOString(), overall, perCoin, perTf, bands };
}

function buildAll() {
  write('equity.json', buildEquity());
  write('track_record.json', buildTrack());
  write('autopsy.json', buildAutopsy());
  const setups = computeAll();
  write('setups.json', { updatedAt: new Date().toISOString(), setups: setups.setups, logs: setups.logs });
  for (const sym of SYMBOLS) {
    const data = getAsset(sym);
    if (!data) continue;
    data.logs = loadLog()[sym] || {};
    data.backtest = evaluateAll(sym);
    write('asset_' + sym + '.json', data);
  }
  write('last_updated.json', { time: new Date().toISOString() });
  console.log('Precomputed static data ->', WEB);
}

if (require.main === module) {
  try {
    buildAll();
  } catch (e) {
    console.error('PRECOMPUTE FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}
module.exports = { buildAll, buildTrack, bandOf, buildAutopsy };