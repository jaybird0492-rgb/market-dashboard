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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
      const score = (st.score === null || st.score === undefined) ? '' : ' ' + (st.score >= 0 ? '+' : '') + st.score;
      const entry = st.entry ? ' @ ' + fmtPrice(st.entry) : '';
      const age = signalAge(st.updatedAt);
      return '<div class="tf-cell"><span class="tf-label">' + tf + '</span>' +
        '<span class="signal ' + setupClass(st.type) + '">' + st.type + score + '</span>' +
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
      <div class="meta">click for 1H/4H/1D charts</div>
    `;
    wrap.appendChild(card);
  }
  document.getElementById('portfolioNote').textContent = 'Multi-factor signals (score = trend · RSI · ADX · breakout). 1D sets the bias — 1H/4H trade only aligned setups.';
}

let equityChart = null;

const CHART_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtRangeMonth(ymd) {
  if (!ymd) return '';
  const p = ymd.split('-');
  return CHART_MONTHS[+p[1] - 1] + ' ' + p[0];
}

function fmtSignedPct(frac) {
  const v = frac * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(0) + '%';
}

function renderEquity(data) {
  const title = document.getElementById('perfTitle');
  if (title && data.from && data.to) {
    title.textContent = 'Buy-and-hold baselines (' + fmtRangeMonth(data.from) + ' – ' + fmtRangeMonth(data.to) + ')';
  }
  const ctx = document.getElementById('equityChart');
  if (equityChart) equityChart.destroy();
  equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.dates,
      datasets: [
        { label: '55/45 buy & hold', data: data.plain, borderColor: '#f59e0b', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
        { label: 'BTC only', data: data.btc, borderColor: '#f7931a', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
        { label: 'ETH only', data: data.eth, borderColor: '#627eea', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#e2e8f0' } },
        tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtSignedPct(c.parsed.y) } },
      },
      scales: {
        x: { ticks: { color: '#94a3b8', maxTicksLimit: 10 }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#94a3b8', callback: (v) => fmtSignedPct(v) }, grid: { color: '#1e293b' } },
      },
    },
  });
  const row = document.getElementById('statsRow');
  row.innerHTML = '';
  for (const [key, label] of [['plain', '55/45 buy & hold'], ['btc', 'BTC only'], ['eth', 'ETH only']]) {
    const s = data.stats[key];
    const dd = (s.maxDD === null || s.maxDD === undefined) ? '–' : fmtSignedPct(s.maxDD);
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = `<b>${label}</b><br>CAGR ${s.ann}%<br>Total ${fmtSignedPct(s.total)}<br>Worst fall ${dd}`;
    row.appendChild(el);
  }
  const note = document.getElementById('perfNote');
  if (note && data.dates && data.plain) {
    let peakI = 0;
    for (let i = 1; i < data.plain.length; i++) if (data.plain[i] > data.plain[peakI]) peakI = i;
    const dd = (k) => (data.stats[k] && data.stats[k].maxDD != null) ? fmtSignedPct(data.stats[k].maxDD) : '–';
    note.textContent = 'How to read this: every line starts at 0% — your profit or loss if you bought once at the start and never sold. ' +
      'The story is the ' + fmtRangeMonth(data.dates[peakI]) + ' peak and the fall after it: the 55/45 mix fell as far as ' + dd('plain') +
      ', BTC ' + dd('btc') + ', ETH ' + dd('eth') + '. ' +
      'This is background context, not a grade of the live signals above — those are short-term trades, this is two years of sitting still.';
  }
}

function renderSeasonality(data) {
  const table = document.getElementById('seasonalityTable');
  let html = '<tr><th>Asset</th>' + MONTHS.map((m) => '<th>' + m + '</th>').join('') + '</tr>';
  for (const [sym, months] of Object.entries(data.seasonality)) {
    html += '<tr><td class="sym-cell">' + sym + '</td>';
    for (const v of months) {
      if (v === null) { html += '<td>-</td>'; continue; }
      const cls = v > 2 ? 'pos-strong' : v > 0 ? 'pos' : v > -2 ? 'neg' : 'neg-strong';
      html += '<td class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '</td>';
    }
    html += '</tr>';
  }
  table.innerHTML = html;
}

function renderSetups(data) {
  const table = document.getElementById('setupsTable');
  const TFS = ['1H', '4H', '1D'];
  let html = '<tr><th>Asset</th>' + TFS.map((t) => '<th>' + t + '</th>').join('') + '</tr>';
  for (const [sym, s] of Object.entries(data.setups)) {
    html += `<tr><td class="sym-cell"><a href="asset.html?symbol=${sym}">${sym}</a></td>`;
    for (const tf of TFS) {
      const st = s.timeframes[tf];
      const cls = st.type === 'BUY' ? 'sig-long' : st.type === 'SELL' ? 'sig-out' : st.type === 'RANGE' ? 'sig-watch' : 'sig-none';
      const score = (st.score === null || st.score === undefined) ? '' : ' ' + (st.score >= 0 ? '+' : '') + st.score;
      html += `<td><span class="signal ${cls}">${st.type}${score}</span><br><span class="sub">${st.entry !== null ? fmtPrice(st.entry) + ' | SL ' + fmtPrice(st.stopLoss) : st.trigger}</span></td>`;
    }
    html += '</tr>';
  }
  table.innerHTML = html;
}

async function init() {
  try {
    const [setups, equity] = await Promise.all([
      loadJson('/api/setups', 'data/setups.json'),
      loadJson('/api/equity', 'data/equity.json'),
    ]);
    renderSignals(setups);
    renderEquity(equity);
    renderSeasonality(equity);
    renderSetups(setups);
  } catch (e) {
    document.getElementById('updatedAt').textContent = 'Error loading: ' + e.message;
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