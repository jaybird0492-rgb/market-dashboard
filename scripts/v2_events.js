// v2 events layer — fast market context that price-only systems miss:
//   - Fear & Greed index (alternative.me, free, no key)
//   - Futures data per coin (Bybit public; Binance futures fallback):
//     24h change, last funding rate, open interest.
//   - News headlines (CoinDesk + Cointelegraph RSS) with keyword severity:
//     CRITICAL (hack/exploit/halt/insolvency/ETF decision...), HIGH
//     (liquidations/crash/surge/breakout...), else NORMAL. Last 48h, max 14.
//   - Price shocks from the last closed 1H bars: a 1H move larger than
//     2.5x the average absolute hourly move of the past 24h, flagged with
//     direction and size. This is how a crash/hack shows up in data within
//     the hour even before headlines are confirmed.
// Every source fails independently; the script always exits 0 and writes
// whatever it could get. Output: web/data/events.json.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'web', 'data', 'events.json');
const LIVE = path.join(__dirname, '..', 'data', 'live');
const UA = { 'User-Agent': 'Mozilla/5.0 (market-analysis v2 events)' };

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

const CRITICAL = ['hack', 'hacked', 'exploit', 'breach', 'stolen', 'withdrawals halted', 'withdrawals paused', 'suspends withdrawals', 'insolvent', 'bankrupt', 'etf approved', 'etf rejected', 'sec charges', 'lawsuit', 'depeg', 'collapse'];
const HIGH = ['liquidat', 'crash', 'plunge', 'plummet', 'surge', 'rally', 'breakout', 'all-time high', 'record high', 'selloff', 'sell-off', 'tumble', 'soar', 'rate cut', 'rate hike', 'cpi', 'fed '];
function severity(title) {
  const t = title.toLowerCase();
  if (CRITICAL.some((k) => t.includes(k))) return 'CRITICAL';
  if (HIGH.some((k) => t.includes(k))) return 'HIGH';
  return 'NORMAL';
}
function parseRss(xml, source) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 30) {
    const b = m[1];
    const pick = (tag) => {
      const mm = b.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
      return mm ? mm[1].trim() : '';
    };
    const title = pick('title').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    const when = Date.parse(pick('pubDate'));
    if (title && Number.isFinite(when)) items.push({ source, title, link: pick('link'), publishedAt: new Date(when).toISOString(), severity: severity(title) });
  }
  return items;
}

function shocks(sym) {
  const file = path.join(LIVE, `${sym}_1h_live.csv`);
  if (!fs.existsSync(file)) return [];
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
    const p = l.split(',');
    return { t: Date.parse(p[0]), open: +p[1], high: +p[2], low: +p[3], close: +p[4], volume: +p[5] };
  }).filter((b) => b.close > 0 && b.t + 36e5 <= Date.now());
  const out = [];
  for (let i = Math.max(25, rows.length - 72); i < rows.length; i++) {
    const rets = [];
    for (let j = i - 24; j < i; j++) rets.push(Math.abs(rows[j].close / rows[j - 1].close - 1));
    const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
    const r = rows[i].close / rows[i - 1].close - 1;
    if (avg > 0 && Math.abs(r) > 2.5 * avg) {
      const volAvg = rows.slice(i - 24, i).reduce((a, b) => a + b.volume, 0) / 24;
      out.push({
        sym, at: new Date(rows[i].t).toISOString(), dir: r > 0 ? 'UP' : 'DOWN',
        movePct: +(r * 100).toFixed(2), vsAvgMove: +(Math.abs(r) / avg).toFixed(1),
        volumeSpike: volAvg > 0 ? +(rows[i].volume / volAvg).toFixed(1) : null,
      });
    }
  }
  return out.slice(-6);
}

async function main() {
  const out = { updatedAt: new Date().toISOString(), fearGreed: null, market: [], headlines: [], shocks: [], errors: [] };

  try {
    const fng = await getJson('https://api.alternative.me/fng/');
    const d = fng.data[0];
    out.fearGreed = { value: +d.value, label: d.value_classification };
  } catch (e) { out.errors.push('fearGreed: ' + e.message); }

  for (const sym of ['BTC', 'ETH']) {
    try {
      const j = await getJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}USDT`);
      const t = j.result.list[0];
      out.market.push({
        sym, price: +t.lastPrice, chg24hPct: +((+t.price24hPcnt) * 100).toFixed(2),
        high24h: +t.highPrice24h, low24h: +t.lowPrice24h,
        fundingPct: +((+t.fundingRate) * 100).toFixed(4), openInterest: +t.openInterest,
      });
    } catch (e) {
      try {
        const j = await getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}USDT`);
        out.market.push({ sym, price: +j.markPrice, chg24hPct: null, fundingPct: +((+j.lastFundingRate) * 100).toFixed(4), openInterest: null });
      } catch (e2) { out.errors.push(`market ${sym}: ` + e.message + ' / ' + e2.message); }
    }
  }

  let headlines = [];
  for (const [src, url] of [['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'], ['Cointelegraph', 'https://cointelegraph.com/rss']]) {
    try { headlines = headlines.concat(parseRss(await getText(url), src)); }
    catch (e) { out.errors.push(`rss ${src}: ` + e.message); }
  }
  const cutoff = Date.now() - 48 * 36e5;
  out.headlines = headlines.filter((h) => Date.parse(h.publishedAt) >= cutoff)
    .sort((a, b) => (a.severity === 'CRITICAL' ? 0 : a.severity === 'HIGH' ? 1 : 2) - (b.severity === 'CRITICAL' ? 0 : b.severity === 'HIGH' ? 1 : 2) || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 14);

  try { out.shocks = [...shocks('BTC'), ...shocks('ETH')].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8); }
  catch (e) { out.errors.push('shocks: ' + e.message); }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(`events: F&G=${out.fearGreed ? out.fearGreed.value + ' ' + out.fearGreed.label : 'n/a'} | market=${out.market.map((m) => `${m.sym} $${m.price} (${m.chg24hPct}%)`).join(' ')} | headlines=${out.headlines.length} (critical=${out.headlines.filter((h) => h.severity === 'CRITICAL').length}) | shocks=${out.shocks.length}${out.errors.length ? ' | errors: ' + out.errors.join('; ') : ''}`);
  for (const s of out.shocks) console.log(`  SHOCK ${s.sym} ${s.dir} ${s.movePct}% at ${s.at} (${s.vsAvgMove}x avg move, vol ${s.volumeSpike}x)`);
}

main().catch((e) => { console.error('events failed (non-fatal):', e.message); process.exit(0); });
