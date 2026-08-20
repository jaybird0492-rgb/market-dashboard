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

function signalClass(sig) {
  return sig.startsWith('LONG') ? 'sig-long' : 'sig-out';
}

function renderSignals(data) {
  document.getElementById('updatedAt').textContent =
    'Updated: ' + new Date(data.updatedAt).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  const wrap = document.getElementById('signalCards');
  wrap.innerHTML = '';
  for (const s of data.signals) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = 'asset.html?symbol=' + s.symbol;
    card.innerHTML = `
      <div class="card-head"><span class="sym">${s.symbol}</span><span class="name">${s.name}</span></div>
      <div class="price">${fmtPrice(s.price)}</div>
      <div class="signal ${signalClass(s.signal)}">${s.signal}</div>
      <div class="detail">${s.detail}</div>
      <div class="meta">click for 1H/4H/1D/1M charts</div>
    `;
    wrap.appendChild(card);
  }
  document.getElementById('portfolioNote').textContent = data.portfolio.note;
}

let equityChart = null;

function renderEquity(data) {
  const ctx = document.getElementById('equityChart');
  if (equityChart) equityChart.destroy();
  equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.dates,
      datasets: [
        { label: 'Final strategy (+rules)', data: data.final, borderColor: '#22c55e', borderWidth: 2, pointRadius: 0, tension: 0.1 },
        { label: '60/25/15 no rules', data: data.plain, borderColor: '#f59e0b', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
        { label: 'ETF variant (+rules)', data: data.etf, borderColor: '#38bdf8', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
        { label: 'SPY only (benchmark)', data: data.spy, borderColor: '#94a3b8', borderWidth: 1.5, pointRadius: 0, tension: 0.1 },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#e2e8f0' } },
        tooltip: { callbacks: { label: (c) => c.dataset.label + ': +' + (c.parsed.y * 100).toFixed(0) + '%' } },
      },
      scales: {
        x: { ticks: { color: '#94a3b8', maxTicksLimit: 10 }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#94a3b8', callback: (v) => '+' + Math.round(v * 100) + '%' }, grid: { color: '#1e293b' } },
      },
    },
  });
  const row = document.getElementById('statsRow');
  row.innerHTML = '';
  for (const [key, label] of [['final', 'Final strategy'], ['plain', 'No rules'], ['etf', 'ETF variant'], ['spy', 'SPY']]) {
    const s = data.stats[key];
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = `<b>${label}</b><br>CAGR ${s.ann}%<br>Total +${(s.total * 100).toFixed(0)}%`;
    row.appendChild(el);
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
  const TFS = ['1H', '4H', '1D', '1M'];
  let html = '<tr><th>Asset</th>' + TFS.map((t) => '<th>' + t + '</th>').join('') + '</tr>';
  for (const [sym, s] of Object.entries(data.setups)) {
    html += `<tr><td class="sym-cell"><a href="asset.html?symbol=${sym}">${sym}</a></td>`;
    for (const tf of TFS) {
      const st = s.timeframes[tf];
      const cls = st.type === 'BUY' ? 'sig-long' : st.type === 'SELL' ? 'sig-out' : st.type === 'RANGE' ? 'sig-watch' : 'sig-none';
      const entry = st.entry !== null ? ' @ ' + fmtPrice(st.entry) : '';
      html += `<td><span class="signal ${cls}">${st.type}</span><br><span class="sub">${st.entry !== null ? fmtPrice(st.entry) + ' | SL ' + fmtPrice(st.stopLoss) : st.trigger}</span></td>`;
    }
    html += '</tr>';
  }
  table.innerHTML = html;
}

async function init() {
  try {
    const [signals, equity, setups] = await Promise.all([
      loadJson('/api/signals', 'data/signals.json'),
      loadJson('/api/equity', 'data/equity.json'),
      loadJson('/api/setups', 'data/setups.json'),
    ]);
    renderSignals(signals);
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