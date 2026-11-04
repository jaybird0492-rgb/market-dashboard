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
const { dailyGateFactory } = require('./v2_timeframes');

const DAY = 864e5, H4 = 144e5, H1 = 36e5;
const OUT = path.join(__dirname, '..', 'web', 'data', 'signals.json');
const closed = (bars, span) => bars.filter((b) => b.t + span <= Date.now());
const fmtLevel = (v) => (v >= 1000 ? '$' + Math.round(v).toLocaleString('en-US') : '$' + v.toFixed(2));

function triggers(bars, i, n = 55) {
  // levels for the NEXT bar: extremes of the n bars ending at i
  return { up: priorHigh(bars, i + 1, n), dn: priorLow(bars, i + 1, n) };
}

function fakeoutStats(bars1h, bars4h, sym) {
  const since = Date.now() - 180 * DAY;
  // 4H confirmation lookup: list of {closeT, dir} where a 4H close broke its range
  const confirms = [];
  for (let j = 20; j < bars4h.length; j++) {
    const up = priorHigh(bars4h, j, 20), dn = priorLow(bars4h, j, 20);
    if (up !== null && bars4h[j].close > up) confirms.push({ t: bars4h[j].t + H4, dir: 1 });
    if (dn !== null && bars4h[j].close < dn) confirms.push({ t: bars4h[j].t + H4, dir: -1 });
  }
  let events = 0, confirmed = 0;
  for (let i = 20; i < bars1h.length; i++) {
    if (bars1h[i].t < since) continue;
    const up = priorHigh(bars1h, i, 20), dn = priorLow(bars1h, i, 20);
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
  if (i < 25) return { state: 'QUIET', dir: 0, detail: 'not enough data' };
  const px = bars1h[i].close;
  const { up, dn } = triggers(bars1h, i, 20);
  // active breakout on the last closed 1H bar?
  const upPrev = priorHigh(bars1h, i, 20), dnPrev = priorLow(bars1h, i, 20);
  if (upPrev !== null && px > upPrev) return { state: 'BREAKOUT', dir: 1, detail: 'last 1H close broke its 20-bar high — waiting for 4H confirmation', level: +upPrev.toFixed(2) };
  if (dnPrev !== null && px < dnPrev) return { state: 'BREAKOUT', dir: -1, detail: 'last 1H close broke its 20-bar low — waiting for 4H confirmation', level: +dnPrev.toFixed(2) };
  // recent fakeout: a cross in the last 12 bars that fell back inside
  for (let j = Math.max(20, i - 12); j <= i; j++) {
    const u = priorHigh(bars1h, j, 20), d = priorLow(bars1h, j, 20);
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
  const t4 = triggers(h4, i4, 20); // traded layer: Donchian 20/10 (variant F3)
  const atr4 = atrArr(h4, 14)[i4];
  const px4 = h4[i4].close;
  const s200_4hArr = smaArr(h4.map((b) => b.close), 200);
  const s200_4h = s200_4hArr[i4];
  const nativeLong = px4 > s200_4h, nativeShort = px4 < s200_4h;
  // Dual gate: longs need the daily close above SMA50, shorts need it below
  // SMA200. Between the averages both sides are open. The 4H Donchian also
  // carries its own native 4H SMA200 filter — effective permission needs both.
  const gateAt = dailyGateFactory(sym);
  const g = gateAt(Date.now()) || { long: px > s50, short: px < s200, px, sma50: s50, sma200: s200, at: d1[ci].t };
  const effLong = !!g.long && nativeLong, effShort = !!g.short && nativeShort;
  const gateLabel = g.long && g.short
    ? 'BOTH sides open (price between SMA50 and SMA200)'
    : g.long ? 'LONG side open (close above SMA50)'
      : g.short ? 'SHORT side open (close below SMA200)'
        : 'No side open';
  // Most recent closed 4H breakout, and whether the full rule allowed it
  // (daily gate + native 4H SMA200 filter). A blocked breakout is a decision,
  // not a missing feed.
  let lastBreakout = null;
  for (let j = i4; j >= Math.max(20, i4 - 6); j--) {
    const u = priorHigh(h4, j, 20), dn = priorLow(h4, j, 20);
    const br = u !== null && h4[j].close > u ? 1 : dn !== null && h4[j].close < dn ? -1 : 0;
    if (br) {
      const gg = gateAt(h4[j].t);
      const dailyOk = !!(gg && (br === 1 ? gg.long : gg.short));
      const nativeOk = br === 1 ? h4[j].close > s200_4hArr[j] : h4[j].close < s200_4hArr[j];
      lastBreakout = {
        dir: br === 1 ? 'LONG' : 'SHORT',
        at: new Date(h4[j].t).toISOString(),
        close: +h4[j].close.toFixed(2),
        level: +(br === 1 ? u : dn).toFixed(2),
        allowed: dailyOk && nativeOk,
        blockedBy: dailyOk && nativeOk ? null : !dailyOk ? 'daily gate' : '4H trend filter',
      };
      break;
    }
  }
  return {
    sym,
    context1d: {
      regime, price: +px.toFixed(2), asOf: new Date(d1[ci].t).toISOString().slice(0, 10),
      aboveSma200: px > s200, sma50Above200: s50 > s200, aboveSma50: px > s50,
      sma50: +s50.toFixed(2), sma200: +s200.toFixed(2),
      pctToSma50: +((s50 / px - 1) * 100).toFixed(2), pctToSma200: +((s200 / px - 1) * 100).toFixed(2),
      longTrigger: +dt.up.toFixed(2), shortTrigger: +dt.dn.toFixed(2),
      gate4h: gateLabel, gateAsOf: g.at,
      gateDetail: `Daily close ${fmtLevel(g.px)} · SMA50 ${fmtLevel(g.sma50)} · SMA200 ${fmtLevel(g.sma200)} — ${g.long && g.short ? 'both sides open (price between the averages)' : g.long ? 'long side open (above SMA50)' : g.short ? 'short side open (below SMA200)' : 'no side open'}.`,
      riskMode: g.long && g.short
        ? '4H layer: both directions open (daily price between SMA50 and SMA200); 0.75% risk per trade'
        : g.long ? '4H layer: long entries only; short entries blocked by the daily gate'
          : g.short ? '4H layer: short entries only; long entries blocked by the daily gate'
            : '4H layer: no entries — daily gate blocks both sides',
    },
    setup4h: {
      rules: 'Donchian 20/10, dual daily gate (long above SMA50, short below SMA200, both in between) + native 4H SMA200 filter',
      price: +px4.toFixed(2), asOf: new Date(h4[i4].t).toISOString(),
      longTrigger: +t4.up.toFixed(2), pctToLong: +((t4.up / px4 - 1) * 100).toFixed(2),
      shortTrigger: +t4.dn.toFixed(2), pctToShort: +((px4 / t4.dn - 1) * 100).toFixed(2),
      // Daily gate (what the daily averages permit) …
      dailyLong: !!g.long, dailyShort: !!g.short,
      gateAllows: g.long && g.short ? 'BOTH' : g.long ? 'LONG' : g.short ? 'SHORT' : 'NONE',
      // … and the native 4H trend filter that stratA applies to every entry.
      sma200_4h: +s200_4h.toFixed(2), pctTo4hSma200: +((s200_4h / px4 - 1) * 100).toFixed(2),
      nativeLong, nativeShort,
      // Effective permission = daily gate AND native 4H filter.
      longAllowed: effLong, shortAllowed: effShort,
      effectiveAllows: effLong && effShort ? 'BOTH' : effLong ? 'LONG' : effShort ? 'SHORT' : 'NONE',
      atr: +atr4.toFixed(2), stopDistPct: +((2.5 * atr4 / px4) * 100).toFixed(2),
      riskUsdPerTrade: 75, // 0.75% of the $10k paper account — indicative
      approxSizeUsd: Math.round(75 / (2.5 * atr4 / px4)),
      lastBreakout,
    },
    series1h: h1.slice(-48).map((b) => +b.close.toFixed(2)),
    warning1h: { ...warningState(h1, h4), asOf: new Date(h1[h1.length - 1].t).toISOString(), stats180d: fakeoutStats(h1, h4, sym) },
  };
}

function main() {
  const now = Date.now();
  const out = {
    updatedAt: new Date(now).toISOString(),
    next4hCloseAt: new Date(Math.ceil(now / H4) * H4).toISOString(),
    coins: [coinSignals('BTC'), coinSignals('ETH')],
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  for (const c of out.coins) {
    const s = c.setup4h, b = s.lastBreakout;
    console.log(`${c.sym} 1D=${c.context1d.regime} | daily gate ${s.gateAllows} · effective ${s.effectiveAllows} | 4H long>${s.longTrigger} (${s.pctToLong}%) short<${s.shortTrigger} (${s.pctToShort}%) | 1H=${c.warning1h.state}${c.warning1h.dir ? (c.warning1h.dir === 1 ? ' LONG' : ' SHORT') : ''} — ${c.warning1h.detail} | 1H warnings confirmed ${c.warning1h.stats180d.ratePct}% (${c.warning1h.stats180d.confirmed}/${c.warning1h.stats180d.events}, 180d)${b ? ` | last 4H breakout ${b.dir} at ${b.at.slice(5, 16)} ${b.allowed ? 'ALLOWED' : 'BLOCKED by ' + b.blockedBy}` : ''}`);
  }
}

if (require.main === module) main();
