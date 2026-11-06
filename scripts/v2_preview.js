// Preview fixture — replays the deployed 4H rule to a historical cutoff and
// writes web/data/preview_4h.json. The dashboard loads it only with ?preview=1
// and labels it "historical replay, not the live account". It exists so the
// open-position and performance layouts can be tested before the first live
// paper fill.
//
// Usage:
//   node scripts/v2_preview.js                 # auto-pick a date with 2 open positions
//   node scripts/v2_preview.js --end 2025-03-15T00:00:00Z
//   node scripts/v2_preview.js --scan          # list candidate dates only
const fs = require('fs');
const path = require('path');
const { loadBars } = require('./v2_backtest');
const { runPortfolio } = require('./v2_portfolio');
const { dualGateStrat, FUT } = require('./v2_timeframes');
const { buildPayload } = require('./v2_paperlib');

const OUT = path.join(__dirname, '..', 'web', 'data', 'preview_4h.json');
const H4 = 144e5;
const REFERENCE = {
  label: 'Backtest 2017-2026 (4H futures, dual gate)',
  trades: 606, expectancyR: 0.44, profitFactor: 1.63,
  maxDDPct: -15.2, oosExpR: 0.39,
  note: 'Shared-account portfolio replay of the deployed rule — see analysis/V2_VALIDATION.md',
};

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--scan') out.scan = true;
    else if (a[i] === '--end') out.end = Date.parse(a[++i]);
  }
  return out;
}

function slice(barsBySym, endMs) {
  const o = {};
  for (const [sym, bars] of Object.entries(barsBySym)) o[sym] = bars.filter((b) => b.t <= endMs);
  return o;
}

function run(barsBySym, endMs) {
  const startMs = endMs - 120 * 864e5;
  const res = runPortfolio(slice(barsBySym, endMs), {
    allowShort: true, startMs,
    makeStrat: (sym, bars, ind) => dualGateStrat(sym)(bars, ind),
    maxHoldBars: 360, ...FUT,
  });
  return { res, startMs };
}

// Find a cutoff where two positions on different coins overlap, so the preview
// exercises the shared-account, two-open-position layout.
function autoCutoff(trades) {
  const tr = [...trades].sort((a, b) => a.entryT - b.entryT);
  let best = null;
  for (let i = 0; i < tr.length; i++) {
    for (let j = i + 1; j < tr.length; j++) {
      if (tr[i].sym === tr[j].sym) continue;
      const lo = Math.max(tr[i].entryT, tr[j].entryT);
      const hi = Math.min(tr[i].exitT, tr[j].exitT);
      if (hi - lo < 2 * 864e5) continue;
      const mid = Math.round((lo + hi) / 2 / H4) * H4;
      if (!best || mid > best) best = mid;
    }
  }
  return best;
}

function main() {
  const opts = args();
  const barsBySym = { BTC: loadBars('BTC', '4h'), ETH: loadBars('ETH', '4h') };
  const full = runPortfolio(barsBySym, {
    allowShort: true,
    makeStrat: (sym, bars, ind) => dualGateStrat(sym)(bars, ind),
    maxHoldBars: 360, ...FUT,
  });

  if (opts.scan) {
    const tr = full.trades;
    const cuts = [];
    for (let i = 0; i < tr.length; i++) {
      for (let j = i + 1; j < tr.length; j++) {
        if (tr[i].sym === tr[j].sym) continue;
        const lo = Math.max(tr[i].entryT, tr[j].entryT);
        const hi = Math.min(tr[i].exitT, tr[j].exitT);
        if (hi - lo < 2 * 864e5) continue;
        cuts.push(new Date(Math.round((lo + hi) / 2 / H4) * H4).toISOString());
      }
    }
    console.log('overlap cutoffs:', [...new Set(cuts)].slice(0, 40).join('\n'));
    return;
  }

  const endMs = opts.end || autoCutoff(full.trades);
  if (!endMs) throw new Error('no overlapping trade window found; pass --end');
  const { res, startMs } = run(barsBySym, endMs);

  if (!res.openPositions.length) {
    console.error(`cutoff ${new Date(endMs).toISOString()} has no open position; try another --end`);
    process.exit(1);
  }

  const payload = buildPayload(res, {
    strategy: 'PREVIEW — 4H Donchian 20/10 futures, dual daily gate, 2.5xATR stop, 0.75% risk/trade, BTC+ETH shared',
    rules: 'Historical replay of the deployed 4H rule (not the live paper account)',
    paperStart: new Date(startMs).toISOString(),
    reference: REFERENCE,
    now: endMs,
    extra: {
      preview: true,
      previewAsOf: new Date(endMs).toISOString(),
      previewNote: 'Historical replay for layout testing — NOT the live paper account.',
    },
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`preview ${new Date(endMs).toISOString()}: equity $${payload.equity}, open ${payload.open.length}, closed ${payload.stats.closed}`);
  for (const p of payload.open) console.log(`  OPEN ${p.sym} ${p.side} @ ${p.entry} stop ${p.stop} mark ${p.mark} (${p.unrealR}R, risk $${p.riskUsd})`);
}

if (require.main === module) main();
module.exports = { autoCutoff };
