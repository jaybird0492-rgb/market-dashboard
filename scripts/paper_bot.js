// Paper trading bot — watches stamped signals, tracks 40/40/20 partials,
// moves STOP to ENTRY (breakeven) once TP1 is hit. Long + flat only:
// BUY opens a paper long, SELL closes it to flat (no shorts).
// No API keys, no real orders — state lives in data/live/paper_state.json.
// Usage: node scripts/paper_bot.js [--since <ISO>]  (--since replays log history)
const fs = require('fs');
const path = require('path');
const { loadCsv, validRows, resample } = require('./ta');
const { loadLog } = require('./setups');

const LIVE = path.join(__dirname, '..', 'data', 'live');
const RAW = path.join(__dirname, '..', 'data', 'raw');
const WEB = path.join(__dirname, '..', 'web', 'data');
const STATE_FILE = path.join(LIVE, 'paper_state.json');
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'HYPE'];
const TFS = ['1H', '4H', '1D'];
const HOUR = 3600e3;

// Placeholder sizing until tuned on paper results: fixed notional per position.
const NOTIONAL_USD = 1000;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { cursor: {}, open: {}, closed: [], initialized: false }; }
}
function saveState(s) {
  fs.mkdirSync(LIVE, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}

const barCache = {};
function getBars(sym, tf) {
  const key = sym + '|' + tf;
  if (barCache[key]) return barCache[key];
  const hourly = validRows(loadCsv(path.join(RAW, sym + '_1h.csv')));
  const daily = validRows(loadCsv(path.join(RAW, sym + '_1d.csv')));
  const bars = tf === '1D' ? daily : tf === '4H' ? resample(hourly, 4 * HOUR) : hourly;
  barCache[key] = bars;
  return bars;
}
const barT = (b) => (typeof b.t === 'number' ? b.t : Date.parse(b.t));
function closeRet(entry, price) { return price / entry - 1; } // longs only

function openPosition(entry) {
  return {
    sym: entry.sym, tf: entry.tf, side: entry.type,
    entry: entry.entry, stop: entry.stopLoss,
    tp1: entry.tp1, tp2: entry.tp2, tp3: entry.tp3,
    openedAt: entry.time, score: entry.score,
    filled1: false, filled2: false, filled3: false,
    remaining: 1, realized: 0,
  };
}

// Walk bars from position open; returns {pos(updated), closedRecord|null}.
function track(pos, bars) {
  let start = bars.findIndex((b) => barT(b) >= pos.openedAt);
  if (start < 0) return { pos, closed: null };
  let sl = pos.stop;
  for (let i = start; i < bars.length; i++) {
    const b = bars[i];
    // Stop checked BEFORE targets (conservative — worst fill assumed).
    const stopHit = sl !== null && b.low <= sl;
    const t1 = !pos.filled1 && pos.tp1 !== null && b.high >= pos.tp1;
    const t2 = !pos.filled2 && pos.tp2 !== null && b.high >= pos.tp2;
    const t3 = !pos.filled3 && pos.tp3 !== null && b.high >= pos.tp3;
    if (stopHit && !t1 && !t2 && !t3) {
      pos.realized += pos.remaining * closeRet(pos.entry, sl);
      pos.remaining = 0;
      return { pos, closed: finish(pos, pos.filled1 || pos.filled2 ? 'SL_AFTER_TP' : 'SL', b) };
    }
    if (t1) {
      pos.realized += 0.4 * closeRet(pos.entry, pos.tp1);
      pos.remaining -= 0.4; pos.filled1 = true;
      sl = pos.entry; pos.stop = pos.entry; // <-- breakeven move
    }
    if (t2) {
      pos.realized += 0.4 * closeRet(pos.entry, pos.tp2);
      pos.remaining -= 0.4; pos.filled2 = true;
    }
    if (t3) {
      pos.realized += Math.max(pos.remaining, 0) * closeRet(pos.entry, pos.tp3);
      pos.remaining = 0; pos.filled3 = true;
      return { pos, closed: finish(pos, 'TP3', b) };
    }
    if (stopHit) { // stop hit on the same bar as a target fill
      pos.realized += pos.remaining * closeRet(pos.entry, sl);
      pos.remaining = 0;
      return { pos, closed: finish(pos, 'SL_AFTER_TP', b) };
    }
  }
  return { pos, closed: null }; // still open
}
function finish(pos, status, bar) {
  return {
    sym: pos.sym, tf: pos.tf, side: pos.side,
    entry: pos.entry, openedAt: pos.openedAt,
    closedAt: new Date(barT(bar)).toISOString(), status,
    realizedPct: +(pos.realized * 100).toFixed(2),
    realizedUsd: +(pos.realized * NOTIONAL_USD).toFixed(2),
    score: pos.score,
  };
}

// Public summary for the dashboard (no internal cursor data).
function buildPublic(state) {
  const open = [];
  for (const p of Object.values(state.open || {})) {
    let mark = null, unrealized = null;
    try {
      const bars = getBars(p.sym, p.tf);
      if (bars.length) {
        mark = bars[bars.length - 1].close;
        unrealized = posUnrealized(p, mark);
      }
    } catch (e) { /* bars for a delisted feed — leave null */ }
    open.push({
      sym: p.sym, tf: p.tf, side: p.side, entry: p.entry, stop: p.stop,
      tp1: p.tp1, tp2: p.tp2, tp3: p.tp3, openedAt: p.openedAt, score: p.score,
      tp1hit: p.filled1, breakeven: p.stop === p.entry,
      mark, unrealizedPct: unrealized === null ? null : +(unrealized * 100).toFixed(2),
      unrealizedUsd: unrealized === null ? null : +(unrealized * NOTIONAL_USD).toFixed(2),
    });
  }
  const closed = (state.closed || []).slice(-50);
  const all = state.closed || [];
  const wins = all.filter((c) => c.realizedUsd > 0).length;
  return {
    updatedAt: new Date().toISOString(),
    notional: NOTIONAL_USD,
    stats: {
      open: open.length, closed: all.length, wins,
      totalUsd: +all.reduce((a, c) => a + c.realizedUsd, 0).toFixed(2),
    },
    open, closed,
  };
}
function posUnrealized(p, mark) {
  return p.realized + p.remaining * closeRet(p.entry, mark);
}

function main() {
  const sinceArg = process.argv.indexOf('--since');
  const since = sinceArg >= 0 ? Date.parse(process.argv[sinceArg + 1]) : null;
  const log = loadLog();
  const state = loadState();
  const changes = [];

  for (const sym of SYMBOLS) {
    for (const tf of TFS) {
      const entries = ((log[sym] && log[sym][tf]) || []).filter((e) => e.entry !== null && e.entry !== undefined);
      if (!entries.length) continue;
      const key = sym + '_' + tf;
      // First run: take the latest signal as the starting position (no history replay).
      if (!state.initialized && since === null) {
        const latest = entries[entries.length - 1];
        state.cursor[key] = latest.time;
        if (latest.type === 'BUY') {
          state.open[key] = openPosition({ sym, tf, ...latest });
          changes.push(`OPEN ${sym} ${tf} BUY @ ${latest.entry} (SL ${latest.stopLoss}, TP1 ${latest.tp1})`);
        } else {
          changes.push(`FLAT ${sym} ${tf} — latest is ${latest.type}, no position`);
        }
      }
      const cursor = state.cursor[key] || 0;
      const fresh = entries.filter((e) => e.time > cursor);

      for (const e of fresh) {
        const cur = state.open[key];
        if (e.type === 'BUY') {
          if (!cur) {
            state.open[key] = openPosition({ sym, tf, ...e });
            changes.push(`OPEN ${sym} ${tf} BUY @ ${e.entry} (SL ${e.stopLoss}, TP1 ${e.tp1})`);
          } else {
            changes.push(`SKIP ${sym} ${tf} BUY @ ${e.entry} — already in position from ${cur.entry}`);
          }
        } else if (e.type === 'SELL') {
          if (cur) {
            const bars = getBars(sym, tf);
            const last = bars[bars.length - 1];
            cur.realized += cur.remaining * closeRet(cur.entry, last.close);
            cur.remaining = 0;
            state.closed.push(finish(cur, 'FLAT_ON_SELL', last));
            delete state.open[key];
            changes.push(`FLAT ${sym} ${tf} @ ${last.close} on SELL signal`);
          }
        }
        state.cursor[key] = e.time;
      }

      // Advance any open position to the latest bar.
      if (state.open[key]) {
        try {
          const bars = getBars(sym, tf);
          const { pos, closed } = track(state.open[key], bars);
          state.open[key] = pos;
          if (closed) {
            state.closed.push(closed);
            delete state.open[key];
            changes.push(`CLOSE ${sym} ${tf} ${closed.status} ${closed.realizedPct >= 0 ? '+' : ''}${closed.realizedPct}% ($${closed.realizedUsd})`);
          } else if (pos.filled1) {
            changes.push(`HOLD ${sym} ${tf} — TP1 banked, stop at breakeven ${pos.entry}`);
          }
        } catch (err) {
          console.error(`  ${sym} ${tf} track FAILED:`, err.message);
        }
      }
    }
  }

  state.initialized = true;
  saveState(state);
  try {
    fs.mkdirSync(WEB, { recursive: true });
    fs.writeFileSync(path.join(WEB, 'paper.json'), JSON.stringify(buildPublic(state)), 'utf8');
  } catch (e) { console.error('  paper.json write FAILED:', e.message); }

  console.log('Paper bot:', new Date().toISOString(), `(notional $${NOTIONAL_USD}/trade)`);
  if (!changes.length) console.log('  No changes');
  for (const c of changes) console.log('  ' + c);
  const openKeys = Object.keys(state.open);
  console.log(`  Open: ${openKeys.length} | Closed: ${state.closed.length}`);
  for (const k of openKeys) {
    const p = state.open[k];
    console.log(`    ${p.sym} ${p.tf} ${p.side} @ ${p.entry} stop ${p.stop} TP1 ${p.tp1}${p.filled1 ? ' (hit, breakeven on)' : ''}`);
  }
  const tot = state.closed.reduce((a, c) => a + c.realizedUsd, 0);
  const wins = state.closed.filter((c) => c.realizedUsd > 0).length;
  console.log(`  Closed P&L: $${tot.toFixed(2)} over ${state.closed.length} trades (${wins} wins)`);
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('PAPER BOT FAILED:', e.message); console.error(e.stack); process.exit(1); }
}
module.exports = { buildPublic, NOTIONAL_USD };
