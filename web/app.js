async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

async function loadJson(apiUrl, staticPath) {
  try {
    return await fetchJson(apiUrl);
  } catch {
    return fetchJson(staticPath + '?v=' + Date.now());
  }
}

function fmtPrice(v) {
  if (typeof v !== 'number') return v;
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function signalAge(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

const TF_ORDER = ['1H', '4H', '1D'];

function setupClass(type) {
  return type === 'BUY' ? 'sig-long' : type === 'SELL' ? 'sig-out' : type === 'RANGE' ? 'sig-watch' : 'sig-none';
}

function biasLabel(bias) {
  if (bias === 'LONG') return 'bullish';
  if (bias === 'SHORT') return 'bearish';
  return 'neutral';
}

function renderSignals(data) {
  document.getElementById('updatedAt').textContent =
    'Updated: ' + new Date(data.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hour12: false }) + ' AWST';
  const wrap = document.getElementById('signalCards');
  wrap.innerHTML = '';
  for (const [symbol, s] of Object.entries(data.setups)) {
    const buys = TF_ORDER.filter((tf) => s.timeframes[tf] && s.timeframes[tf].type === 'BUY').length;
    const sells = TF_ORDER.filter((tf) => s.timeframes[tf] && s.timeframes[tf].type === 'SELL').length;
    const biasCls = s.bias === 'LONG' ? 'sig-long' : s.bias === 'SHORT' ? 'sig-out' : 'sig-watch';
    const tfCells = TF_ORDER.map((tf) => {
      const st = s.timeframes[tf];
      if (!st) return '';
      const conv = (st.score === null || st.score === undefined) ? '–' : ((st.score >= 0 ? '+' : '') + st.score);
      const entry = st.entry ? ' @ ' + fmtPrice(st.entry) : '';
      const age = signalAge(st.updatedAt);
      return '<div class="tf-cell"><span class="tf-label">' + tf + '</span>' +
        '<span class="signal ' + setupClass(st.type) + '">' + st.type + '</span>' +
        '<span class="tf-conv">Conviction ' + conv + '</span>' +
        '<span class="tf-entry">' + entry + '</span>' +
        (age ? '<span class="tf-age">' + age + '</span>' : '') + '</div>';
    }).join('');

    const card = document.createElement('a');
    card.className = 'card';
    card.href = 'asset.html?symbol=' + symbol;
    card.innerHTML = `
      <div class="card-head"><span class="sym">${symbol}</span><span class="name">${s.name}</span></div>
      <div class="price">${fmtPrice(s.price)}</div>
      <div class="signal ${biasCls}">${s.bias} bias — ${biasLabel(s.bias)}</div>
      <div class="tf-row">${tfCells}</div>
      <div class="detail">${buys} BUY / ${sells} SELL across ${TF_ORDER.length} timeframes</div>
      <div class="meta">click for 1H/4H/1D charts + track record</div>
    `;
    wrap.appendChild(card);
  }
  document.getElementById('portfolioNote').textContent = 'Conviction runs -100 (max bearish) to +100 (max bullish); further from zero = stronger. Built from trend · RSI · ADX · breakout. 1D sets the bias — 1H/4H trade only aligned setups.';
}

function fmtSignedPctFrac(frac) {
  if (frac === null || frac === undefined) return '-';
  const v = frac * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function renderTrack(data) {
  const o = data.overall;
  const decided = o.tp1 + o.sl;
  const winRate = decided ? Math.round((o.tp1 / decided) * 100) : 0;
  const chips = document.getElementById('trackChips');
  chips.innerHTML =
    '<span class="chip sig-long">' + o.tp1 + ' hit TP1</span>' +
    '<span class="chip sig-long">' + o.tp2 + ' hit TP1+TP2</span>' +
    '<span class="chip sig-long">' + o.tp3 + ' hit full TP1+TP2+TP3</span>' +
    '<span class="chip sig-out">' + o.sl + ' stopped out</span>' +
    '<span class="chip sig-watch">' + o.slAfterTp + ' stopped after banking TP</span>' +
    '<span class="chip sig-none">' + (o.partial + o.open) + ' still open</span>' +
    '<span class="chip sig-watch">' + o.noTrade + ' no-trade signals</span>';
  let html = '<tr><th>Coin</th><th>Signals</th><th>TP1</th><th>TP1+TP2</th><th>Full TP3</th><th>Stopped</th><th>SL after TP</th><th>Open</th><th>Realized</th></tr>';
  for (const [sym, c] of Object.entries(data.perCoin)) {
    const rCls = c.sumRealized >= 0 ? 'pos' : 'neg';
    html += '<tr><td class="sym-cell"><a href="asset.html?symbol=' + sym + '">' + sym + '</a></td>' +
      '<td>' + c.total + '</td><td>' + c.tp1 + '</td><td>' + c.tp2 + '</td><td>' + c.tp3 + '</td>' +
      '<td>' + c.sl + '</td><td>' + c.slAfterTp + '</td><td>' + (c.partial + c.open) + '</td>' +
      '<td class="' + rCls + '">' + fmtSignedPctFrac(c.sumRealized) + '</td></tr>';
  }
  document.getElementById('trackTable').innerHTML = html;
  document.getElementById('trackNote').textContent =
    o.total + ' tradable BUY/SELL signals across 1H/4H/1D · TP1 win rate ' + winRate + '% (' + o.tp1 + ' of ' + decided + ' decided) · ' +
    'combined realized ' + fmtSignedPctFrac(o.sumRealized) + ' (sum of per-signal %, 40/40/20 partials, stop checked before targets — conservative). ' +
    'TP2 implies TP1 hit, full TP3 implies all three. New coins start at n=1 and build hourly.';
}

function renderPaper(data) {
  const s = data.stats;
  const tCls = s.totalUsd >= 0 ? 'sig-long' : 'sig-out';
  document.getElementById('paperChips').innerHTML =
    '<span class="chip sig-long">' + s.open + ' open</span>' +
    '<span class="chip sig-watch">' + s.closed + ' closed</span>' +
    '<span class="chip sig-long">' + s.wins + ' wins</span>' +
    '<span class="chip ' + tCls + '">$' + s.totalUsd.toFixed(2) + ' total</span>';
  let openHtml = '<tr><th>Coin</th><th>TF</th><th>Entry</th><th>Stop</th><th>TP1</th><th>Mark</th><th>Unrealized</th></tr>';
  const sorted = (data.open || []).slice().sort((a, b) => (a.sym + a.tf < b.sym + b.tf ? -1 : 1));
  for (const p of sorted) {
    const uCls = (p.unrealizedUsd === null || p.unrealizedUsd >= 0) ? 'pos' : 'neg';
    const tp1 = p.tp1hit ? fmtPrice(p.tp1) + ' ✓' : fmtPrice(p.tp1);
    const stop = fmtPrice(p.stop) + (p.breakeven ? ' (BE)' : '');
    openHtml += '<tr><td class="sym-cell"><a href="asset.html?symbol=' + p.sym + '">' + p.sym + '</a></td>' +
      '<td>' + p.tf + '</td><td>' + fmtPrice(p.entry) + '</td><td>' + stop + '</td><td>' + tp1 + '</td>' +
      '<td>' + (p.mark === null ? '-' : fmtPrice(p.mark)) + '</td>' +
      '<td class="' + uCls + '">' + (p.unrealizedUsd === null ? '-' : '$' + p.unrealizedUsd.toFixed(2)) + '</td></tr>';
  }
  if (!sorted.length) openHtml += '<tr><td colspan="7">No open paper positions.</td></tr>';
  document.getElementById('paperOpen').innerHTML = openHtml;
  let closedHtml = '<tr><th>Closed</th><th>Coin</th><th>TF</th><th>Outcome</th><th>Realized</th></tr>';
  const recent = (data.closed || []).slice().reverse().slice(0, 15);
  for (const c of recent) {
    const rCls = c.realizedUsd >= 0 ? 'pos' : 'neg';
    const oCls = c.status === 'TP3' ? 'sig-long' : (c.status === 'SL' ? 'sig-out' : 'sig-watch');
    closedHtml += '<tr><td class="tl-time">' + signalAge(c.closedAt) + '</td>' +
      '<td class="sym-cell">' + c.sym + '</td><td>' + c.tf + '</td>' +
      '<td><span class="signal ' + oCls + '">' + c.status + '</span></td>' +
      '<td class="' + rCls + '">$' + c.realizedUsd.toFixed(2) + '</td></tr>';
  }
  if (!recent.length) closedHtml += '<tr><td colspan="5">No closed paper trades yet.</td></tr>';
  document.getElementById('paperClosed').innerHTML = closedHtml;
  document.getElementById('paperNote').textContent =
    'Paper only — no real orders. $' + data.notional + ' notional per trade, long + flat, stop moves to entry at TP1.';
}

async function init() {
  try {
    const setups = await loadJson('/api/setups', 'data/setups.json');
    renderSignals(setups);
  } catch (e) {
    document.getElementById('updatedAt').textContent = 'Error loading: ' + e.message;
  }
  try {
    const track = await loadJson('/api/track', 'data/track_record.json');
    renderTrack(track);
  } catch (e) {
    document.getElementById('trackNote').textContent = 'Track record unavailable: ' + e.message;
  }
  try {
    const paper = await loadJson('/api/paper', 'data/paper.json');
    renderPaper(paper);
  } catch (e) {
    document.getElementById('paperNote').textContent = 'Paper bot unavailable: ' + e.message;
  }
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  try {
    await loadJson('/api/refresh', 'data/last_updated.json');
    await init();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh signals';
  }
});

init();
