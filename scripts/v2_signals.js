// v2 signals — the three-layer view per coin, computed from closed bars only:
//   context (1D): trend regime + risk mode. Updated daily.
//   setup   (4H): Donchian trigger levels + distance. The trade layer.
//   warning (1H): APPROACHING / BREAKOUT / FAKEOUT / QUIET + the coin's
//                 historical 1H-warning confirmation rate (last 180 days:
//                 did a 4H close confirm the 1H break within 24h?).
// The 1H layer never trades. It exists so a human can see a move building
// and learn, from counted stats, how often it was a fake warning.
// Output: web/data/signals.json. Run hourly after fetch_history --live.
const fs = require('fs');
const path = require('path');
const { loadBars, smaArr, atrArr, priorHigh, priorLow } = require('./v2_backtest');
const { loadBarsAny } = require('./v2_paper4h');

const DAY = 864e5, H4 = 144e5, H1 = 36e5;
const OUT = path.join(__dirname, '..', 'web', 'data', 'signals.json');
const closed = (bars, span) => bars.filter((b) => b.t + span <= Date.now());

function triggers(bars, i) {
  // levels for the NEXT bar: extremes of the 55 bars ending at i
  return { up: priorHigh(bars, i + 1, 55), dn: priorLow(bars, i + 1, 55) };
}

function fakeoutStats(bars1h, bars4h, sym) {
  const since = Date.now() - 180 * DAY;
  // 4H confirmation lookup: list of {closeT, dir} where a 4H close broke its range
  const confirms = [];
  for (let j = 55; j < bars4h.length; j++) {
    const up = priorHigh(bars4h, j, 55), dn = priorLow(bars4h, j, 55);
    if (up !== null && bars4h[j].close > up) confirms.push({ t: bars4h[j].t + H4, dir: 1 });
    if (dn !== null && bars4h[j].close < dn) confirms.push({ t: bars4h[j].t + H4, dir: -1 });
  }
  let events = 0, confirmed = 0;
  for (let i = 55; i < bars1h.length; i++) {
    if (bars1h[i].t < since) continue;
    const up = priorHigh(bars1h, i, 55), dn = priorLow(bars1h, i, 55);
    if (up === null) continue;
    let dir = 0, level = 0;
    if (bars1h[i].close > up && bars1h[i - 1].close <= up) { dir = 1; level = up; }
    else if (bars1h[i].close < dn && bars1h[i - 1].close >= dn) { dir = -1; level = dn; }
    if (!dir) continue;
    events++;
    const t0 = bars1h[i].t;
    if (confirms.some((c) => c.dir === dir && c.t > t0 && c.t <= t0 + 24 * H1)) confirmed++;
  }
  return { events, confirmed, ratePct: events ? Math.round((confirmed / events) * 100) : null };
}

function warningState(bars1h, bars4h) {
  const i = bars1h.length - 1;
  if (i < 60) return { state: 'QUIET', dir: 0, detail: 'not enough data' };
  const px = bars1h[i].close;
  const { up, dn } = triggers(bars1h, i);
  // active breakout on the last closed 1H bar?
  const upPrev = priorHigh(bars1h, i, 55), dnPrev = priorLow(bars1h, i, 55);
  if (upPrev !== null && px > upPrev) return { state: 'BREAKOUT', dir: 1, detail: 'last 1H close broke its 55-bar high — waiting for 4H confirmation', level: +upPrev.toFixed(2) };
  if (dnPrev !== null && px < dnPrev) return { state: 'BREAKOUT', dir: -1, detail: 'last 1H close broke its 55-bar low — waiting for 4H confirmation', level: +dnPrev.toFixed(2) };
  // recent fakeout: a cross in the last 12 bars that fell back inside
  for (let j = Math.max(55, i - 12); j <= i; j++) {
    const u = priorHigh(bars1h, j, 55), d = priorLow(bars1h, j, 55);
    if (u !== null && bars1h[j].close > u && px < u) return { state: 'FAKEOUT', dir: 1, detail: `1H broke above $${u.toFixed(2)} within the last 12h and fell back inside — fake warning`, level: +u.toFixed(2) };
    if (d !== null && bars1h[j].close < d && px > d) return { state: 'FAKEOUT', dir: -1, detail: `1H broke below $${d.toFixed(2)} within the last 12h and recovered inside — fake warning`, level: +d.toFixed(2) };
  }
  const pctUp = (up / px - 1) * 100, pctDn = (px / dn - 1) * 100;
  if (pctUp <= 1) return { state: 'APPROACHING', dir: 1, detail: `1H is ${pctUp.toFixed(2)}% below its breakout level`, level: +up.toFixed(2) };
  if (pctDn <= 1) return { state: 'APPROACHING', dir: -1, detail: `1H is ${pctDn.toFixed(2)}% above its breakdown level`, level: +dn.toFixed(2) };
  return { state: 'QUIET', dir: 0, detail: `nearest 1H levels: +${pctUp.toFixed(1)}% up / -${pctDn.toFixed(1)}% down` };
}

function coinSignals(sym) {
  const d1 = closed(loadBars(sym, '1d'), DAY);
  const h4 = closed(loadBarsAny(sym, '4h'), H4);
  const h1 = closed(loadBarsAny(sym, '1h'), H1);
  const ci = d1.length - 1;
  const closes = d1.map((b) => b.close);
  const s50 = smaArr(closes, 50)[ci], s200 = smaArr(closes, 200)[ci];
  const px = d1[ci].close;
  let regime = 'TRANSITION';
  if (px > s200 && s50 > s200) regime = 'TREND UP';
  else if (px < s200 && s50 < s200) regime = 'TREND DOWN';
  const dt = triggers(d1, ci);
  const i4 = h4.length - 1;
  const t4 = triggers(h4, i4);
  const atr4 = atrArr(h4, 14)[i4];
  const px4 = h4[i4].close;
  const s200_4 = smaArr(h4.map((b) => b.close), 200)[i4];
  return {
    sym,
    context1d: {
      regime, price: +px.toFixed(2), asOf: new Date(d1[ci].t).toISOString().slice(0, 10),
      aboveSma200: px > s200, sma50Above200: s50 > s200,
      longTrigger: +dt.up.toFixed(2), shortTrigger: +dt.dn.toFixed(2),
      riskMode: regime === 'TREND UP' ? 'Longs allowed at full size; shorts blocked' : regime === 'TREND DOWN' ? 'Shorts allowed at full size; longs blocked' : 'No new trades — market in transition',
    },
    setup4h: {
      price: +px4.toFixed(2), asOf: new Date(h4[i4].t).toISOString(),
      longTrigger: +t4.up.toFixed(2), pctToLong: +((t4.up / px4 - 1) * 100).toFixed(2),
      shortTrigger: +t4.dn.toFixed(2), pctToShort: +((px4 / t4.dn - 1) * 100).toFixed(2),
      aboveSma200: px4 > s200_4,
      atr: +atr4.toFixed(2), stopDistPct: +((2.5 * atr4 / px4) * 100).toFixed(2),
      riskUsdPerTrade: 75, // 0.75% of the $10k paper account
      approxSizeUsd: Math.round(75 / (2.5 * atr4 / px4)),
    },
    warning1h: { ...warningState(h1, h4), asOf: new Date(h1[h1.length - 1].t).toISOString(), stats180d: fakeoutStats(h1, h4, sym) },
  };
}

function main() {
  const out = { updatedAt: new Date().toISOString(), coins: [coinSignals('BTC'), coinSignals('ETH')] };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  for (const c of out.coins) {
    console.log(`${c.sym} 1D=${c.context1d.regime} | 4H long>${c.setup4h.longTrigger} (${c.setup4h.pctToLong}%) short<${c.setup4h.shortTrigger} (${c.setup4h.pctToShort}%) | 1H=${c.warning1h.state}${c.warning1h.dir ? (c.warning1h.dir === 1 ? ' LONG' : ' SHORT') : ''} — ${c.warning1h.detail} | 1H warnings confirmed ${c.warning1h.stats180d.ratePct}% (${c.warning1h.stats180d.confirmed}/${c.warning1h.stats180d.events}, 180d)`);
  }
}

if (require.main === module) main();
