// Signal autopsy — classifies WHY each stopped-out signal failed and ranks
// biggest mistakes vs strengths across coins x timeframes.
// Pure post-trade accounting: uses stamped log factors + backtest MFE/MAE only.
const { evaluateAll } = require('./setup_backtest');

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'HYPE'];
const TFS = ['1H', '4H', '1D'];

function diagnose(e, bt) {
  const f = e.factors || {};
  const long = e.type === 'BUY';
  const slDist = Math.abs(e.entry - e.stopLoss) / e.entry;
  const maeMult = slDist > 0 ? Math.abs(bt.mae) / slDist : 99;
  const mfeR = slDist > 0 ? bt.mfe / slDist : 0;
  if ((e.trigger || '').includes('against 1D bias')) return { mistake: 'COUNTER_BIAS', note: 'traded against 1D bias' };
  if (long && (f.rsi ?? 50) >= 70) return { mistake: 'CHASING_OVERBOUGHT', note: `RSI ${f.rsi} at entry` };
  if (!long && (f.rsi ?? 50) <= 30) return { mistake: 'CHASING_OVERSOLD', note: `RSI ${f.rsi} at entry` };
  if ((f.adx ?? 99) < 18 && Math.abs(f.direction ?? 1) < 0.15) return { mistake: 'CHOP_NO_TREND', note: `ADX ${f.adx}, dir ${f.direction}` };
  if (long && (f.structure ?? 0) < -0.2) return { mistake: 'BROKEN_STRUCTURE', note: `structure ${f.structure}, bought into breakdown` };
  if (!long && (f.structure ?? 0) > 0.2) return { mistake: 'BROKEN_STRUCTURE', note: `structure ${f.structure}, sold into breakout` };
  if (mfeR >= 1) return { mistake: 'WICKED_OUT', note: `reached ${mfeR.toFixed(1)}R then reversed to stop` };
  if (maeMult < 1.3) return { mistake: 'STOP_TOO_TIGHT', note: `wiggle ${(Math.abs(bt.mae) * 100).toFixed(2)}% vs stop ${(slDist * 100).toFixed(2)}%` };
  return { mistake: 'DIRECTION_WRONG', note: `trend call wrong, fell ${(Math.abs(bt.mae) * 100).toFixed(2)}% (${maeMult.toFixed(1)}x stop)` };
}

const FIX = {
  COUNTER_BIAS: 'Never take counter-bias 1H/4H at full size — bot already skips these on weak coins.',
  CHASING_OVERBOUGHT: 'Cap entries at RSI 68 on longs (momentum fades above it).',
  CHASING_OVERSOLD: 'Cap entries at RSI 32 on shorts.',
  CHOP_NO_TREND: 'Require ADX 18+ with direction for intraday entries.',
  BROKEN_STRUCTURE: 'No longs when structure factor is negative (and mirror for shorts).',
  WICKED_OUT: 'Breakeven-after-TP1 already covers the TP1 cases; same-bar wicks need wider stops.',
  STOP_TOO_TIGHT: 'Widen the ATR stop multiple for this coin x timeframe.',
  DIRECTION_WRONG: 'Genuine trend-call errors — reduce via weak-band sizing (already live).',
};

function buildAutopsy() {
  const perAsset = {}; // perAsset[sym][tf] = {sl, mistakes:{}, recent:[...]}
  const mistakeTotals = {}; // mistake -> {count, syms}
  const unitPerf = []; // per sym x tf: {sym, tf, n, winRate, avgPct}
  for (const sym of SYMBOLS) {
    const bt = evaluateAll(sym);
    perAsset[sym] = {};
    for (const tf of TFS) {
      const results = bt[tf].results;
      const sls = results.filter((r) => r.bt.status === 'SL');
      const mistakes = {};
      const recent = [];
      for (const r of sls) {
        const d = diagnose(r.entry, r.bt);
        mistakes[d.mistake] = (mistakes[d.mistake] || 0) + 1;
        const mkey = tf + ':' + d.mistake;
        mistakeTotals[mkey] = mistakeTotals[mkey] || { tf, mistake: d.mistake, count: 0, syms: {} };
        mistakeTotals[mkey].count++;
        mistakeTotals[mkey].syms[sym] = (mistakeTotals[mkey].syms[sym] || 0) + 1;
        recent.push({
          time: r.entry.time, type: r.entry.type, entry: r.entry.entry,
          score: r.entry.score, mistake: d.mistake, note: d.note,
          maePct: +(r.bt.mae * 100).toFixed(2),
        });
      }
      recent.sort((a, b) => b.time - a.time);
      const decided = results.filter((r) => r.bt.hit.includes('TP1') || r.bt.status === 'SL').length;
      const tp1 = results.filter((r) => r.bt.hit.includes('TP1')).length;
      const avg = results.length ? results.reduce((a, r) => a + r.bt.realized, 0) / results.length : 0;
      let run = 0, maxRun = 0, worst = 0;
      for (const r of results) {
        if (r.bt.status === 'SL') { run++; if (run > maxRun) maxRun = run; }
        else run = 0;
        if (r.bt.realized < worst) worst = r.bt.realized;
      }
      perAsset[sym][tf] = {
        sl: sls.length, mistakes,
        recent: recent.slice(0, 8),
        n: results.length,
        winRate: decided ? Math.round((tp1 / decided) * 100) : 0,
        avgPct: +(avg * 100).toFixed(2),
        pain: { maxConsecSL: maxRun, worstPct: +(worst * 100).toFixed(2) },
      };
      unitPerf.push({ sym, tf, n: results.length, winRate: perAsset[sym][tf].winRate, avgPct: perAsset[sym][tf].avgPct });
    }
  }
  const mistakes = Object.values(mistakeTotals)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((m) => ({ ...m, syms: Object.keys(m.syms).join(','), fix: FIX[m.mistake] }));
  const strengths = unitPerf
    .filter((u) => u.n >= 5 && u.winRate >= 50 && u.avgPct > 0)
    .sort((a, b) => b.avgPct - a.avgPct)
    .slice(0, 8);
  return { updatedAt: new Date().toISOString(), mistakes, strengths, perAsset };
}

if (require.main === module) {
  const a = buildAutopsy();
  console.log('Top mistakes:');
  for (const m of a.mistakes) console.log(`  ${m.tf} ${m.mistake} x${m.count} [${m.syms}]`);
  console.log('Top strengths:');
  for (const s of a.strengths) console.log(`  ${s.sym} ${s.tf} n=${s.n} win=${s.winRate}% avg=${s.avgPct}%`);
}

module.exports = { buildAutopsy, diagnose };
