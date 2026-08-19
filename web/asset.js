const params = new URLSearchParams(location.search);
const SYMBOL = (params.get('symbol') || 'BTC').toUpperCase();
const TF_ORDER = ['1H', '4H', '1D', '1M'];

let asset = null;
let activeTf = '1D';

function fmt(v, digits) {
  if (v === null || v === undefined) return '-';
  const d = digits !== undefined ? digits : v >= 10000 ? 0 : v >= 100 ? 2 : 4;
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: d });
}
function pct(v) {
  if (v === null || v === undefined) return '-';
  return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}
function verdictClass(v) {
  if (v.startsWith('BUY')) return 'sig-long';
  if (v === 'NO TRADE') return 'sig-out';
  return 'sig-watch';
}
function setupClass(t) {
  return t === 'BUY' ? 'sig-long' : t === 'SELL' ? 'sig-out' : t === 'RANGE' ? 'sig-watch' : 'sig-none';
}
function localTime(iso) {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

async function loadJson(apiUrl, staticPath) {
  try {
    const r = await fetch(apiUrl);
    if (r.ok) return r.json();
    throw new Error(String(r.status));
  } catch {
    const r2 = await fetch(staticPath);
    if (!r2.ok) throw new Error(staticPath + ' -> ' + r2.status);
    return r2.json();
  }
}

async function load() {
  const [asset, signals] = await Promise.all([
    loadJson('/api/asset?symbol=' + SYMBOL, 'data/asset_' + SYMBOL + '.json'),
    loadJson('/api/signals', 'data/signals.json'),
  ]);

  document.title = asset.name + ' — ' + SYMBOL + ' analysis';
  document.getElementById('assetTitle').textContent = asset.name + ' (' + SYMBOL + ')';
  document.getElementById('assetMeta').textContent = 'Data through ' + asset.updated + ' UTC';

  const strat = signals.signals.find((s) => s.symbol === SYMBOL);
  if (strat) {
    const el = document.getElementById('strategySignal');
    el.textContent = 'Strategy: ' + strat.signal;
    el.className = 'badge ' + (strat.signal.startsWith('LONG') ? 'sig-long' : 'sig-out');
  }

  const tfs = asset.timeframes;
  const buys = Object.values(tfs).filter((t) => t.setup && t.setup.type === 'BUY').length;
  const sells = Object.values(tfs).filter((t) => t.setup && t.setup.type === 'SELL').length;
  document.getElementById('summary').innerHTML =
    `<b>Multi-timeframe:</b> ${buys}/4 BUY setups, ${sells}/4 SELL setups. ` +
    (buys >= 3 ? 'Bias: BULLISH — trade the BUY setups (higher timeframes agree).' :
     sells >= 3 ? 'Bias: BEARISH — stand aside or trade the SELL setups only.' :
     'Bias: MIXED — wait for at least 2 timeframes to agree on direction.');

  const tabs = document.getElementById('tfTabs');
  tabs.innerHTML = TF_ORDER.map((tf) => `<button data-tf="${tf}" class="tf-tab">${tf}</button>`).join('');
  tabs.querySelectorAll('.tf-tab').forEach((b) =>
    b.addEventListener('click', () => selectTf(b.dataset.tf))
  );
  selectTf(activeTf);
}

function selectTf(tf) {
  activeTf = tf;
  document.querySelectorAll('.tf-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.tf === tf)
  );
  const t = asset.timeframes[tf];
  renderCandles(document.getElementById('chart'), t);

  const panel = document.getElementById('readPanel');
  panel.innerHTML = `
    <div class="read-head">
      <h2>${tf} — ${t.verdict}</h2>
      <div class="read-stats">
        <span>Price ${fmt(t.price)}</span>
        <span>1-bar ${pct(t.change1)}</span>
        <span>3-bar ${pct(t.change3)}</span>
        <span>RSI ${t.rsi === null ? '-' : t.rsi.toFixed(0)}</span>
        <span>ATR ${t.atrPct === null ? '-' : t.atrPct.toFixed(2) + '%'}</span>
        <span>MA20 ${fmt(t.ma20)}</span>
        <span>MA50 ${fmt(t.ma50)}</span>
        <span>vs MA200: ${t.maState}</span>
      </div>
    </div>
    <p class="read-text">${t.text}</p>`;

  const s = t.setup;
  document.getElementById('setupPanel').innerHTML = `
    <div class="setup-head">
      <span class="signal ${setupClass(s.type)}">SETUP: ${s.type}</span>
      <span class="setup-time">Updated ${localTime(s.updatedAt)}</span>
    </div>
    ${s.type === 'BUY' || s.type === 'SELL' ? `
    <div class="setup-grid">
      <div class="setup-box entry"><div class="box-label">ENTRY</div><div class="box-val">${fmt(s.entry)}</div><div class="box-sub">${s.trigger}</div></div>
      <div class="setup-box stop"><div class="box-label">STOP LOSS</div><div class="box-val">${fmt(s.stopLoss)}</div><div class="box-sub">risk ${s.risk}</div></div>
      <div class="setup-box tp"><div class="box-label">TP1 (40%)</div><div class="box-val">${fmt(s.tp1)}</div><div class="box-sub">RR 1:1</div></div>
      <div class="setup-box tp"><div class="box-label">TP2 (40%)</div><div class="box-val">${fmt(s.tp2)}</div><div class="box-sub">RR 1:2</div></div>
      <div class="setup-box tp"><div class="box-label">TP3 (20%)</div><div class="box-val">${fmt(s.tp3)}</div><div class="box-sub">RR 1:3</div></div>
    </div>` : ''}
    <p class="read-text">${s.text}</p>`;

  const log = (asset.logs && asset.logs[tf]) || [];
  const tl = document.getElementById('timeline');
  if (!log.length) {
    tl.innerHTML = '<h2>Signals — ' + tf + ' — none recorded yet (next interval close will add one)</h2>';
  } else {
    tl.innerHTML =
      '<h2>Signals — ' + tf + ' (oldest to newest, one per closed interval)</h2>' +
      log.map((e) => `
        <div class="tl-item">
          <span class="tl-time">${localTime(e.time)}</span>
          <span class="signal ${setupClass(e.type)}">${e.type}</span>
          <span class="tl-detail">
            ${e.entry ? 'entry ' + fmt(e.entry) : ''}
            ${e.stopLoss ? ' | SL ' + fmt(e.stopLoss) : ''}
            ${e.tp1 ? ' | TP1 ' + fmt(e.tp1) + ' TP2 ' + fmt(e.tp2) + ' TP3 ' + fmt(e.tp3) : ''}
            ${e.trigger ? ' | ' + e.trigger : ''}
          </span>
        </div>`).join('');
  }

  renderBacktest(tf);
}

function btClass(status) {
  if (status === 'SL') return 'sig-out';
  if (status === 'TP3') return 'sig-long';
  if (status === 'SL_AFTER_TP' || status === 'PARTIAL') return 'sig-watch';
  if (status === 'OPEN' || status === 'PENDING') return 'sig-none';
  return 'sig-watch';
}
function btLabel(r) {
  if (r.status === 'SL') return 'STOP HIT';
  if (r.status === 'SL_AFTER_TP') return 'STOP after ' + r.hit;
  if (r.status === 'TP3') return 'TP1+TP2+TP3 HIT (full)';
  if (r.status === 'PARTIAL') return 'PARTIAL — ' + r.hit + ' hit, rest open';
  if (r.status === 'OPEN') return 'OPEN — nothing hit yet';
  if (r.status === 'PENDING') return 'PENDING — no bars yet';
  if (r.status === 'NONE') return 'NO LEVELS';
  return r.status;
}
function btRealized(v) {
  const p = (v * 100).toFixed(2) + '%';
  return v > 0 ? '<span style="color:#4ade80">+' + p + '</span>' : '<span style="color:#f87171">' + p + '</span>';
}

function renderBacktest(tf) {
  const bt = asset.backtest && asset.backtest[tf];
  const log = (asset.logs && asset.logs[tf]) || [];
  const box = document.getElementById('backtestPanel');
  const noTrade = log.length - (bt ? bt.stats.total : 0);
  if (!bt || !bt.stats.total) {
    box.innerHTML = `
      <h2>Signal results — ${tf}</h2>
      <div class="bt-chips">
        <span class="chip sig-none">0 tradable signals yet</span>
        <span class="chip sig-watch">${noTrade} no-trade signals (RANGE/WATCH/NONE)</span>
      </div>
      <div class="bt-summary">Tradable signals are BUY/SELL with entry, stop and take-profits. RANGE/WATCH/NONE signals have no levels, so they can't hit or fail. Once a BUY/SELL signal fires, it appears here with its outcome — until then the signal stream above is your live feed.</div>`;
    return;
  }
  const s = bt.stats;
  const decided = s.sl + s.slAfterTp + s.tp3;
  const hitRate = decided ? Math.round(((s.tp1 + s.tp2 + s.tp3) / decided) * 100) : 0;
  const chips = `
    <div class="bt-chips">
      <span class="chip sig-out">${s.sl} stopped out</span>
      <span class="chip sig-watch">${s.slAfterTp} stopped after partial TP</span>
      <span class="chip sig-long">${s.tp1} hit TP1</span>
      <span class="chip sig-long">${s.tp2} hit TP2</span>
      <span class="chip sig-long">${s.tp3} hit TP3 (full)</span>
      <span class="chip sig-none">${s.open + s.partial} still open</span>
      ${noTrade ? `<span class="chip sig-watch">${noTrade} no-trade signals</span>` : ''}
    </div>
    <div class="bt-summary">
      ${s.total} tradable signals · ${decided} decided ·
      <b>hit rate ${hitRate}%</b> (${s.tp1 + s.tp2 + s.tp3} of ${decided} hit a target) ·
      avg realized <b>${btRealized(s.avgRealized)}</b> ·
      avg MFE <b>${btRealized(s.avgMfe)}</b> · avg MAE <b>${btRealized(s.avgMae)}</b>
    </div>`;
  const rows = bt.results
    .slice()
    .reverse()
    .map((r) => {
      const e = r.entry;
      return `<tr>
        <td class="tl-time">${localTime(e.time)}</td>
        <td><span class="signal ${setupClass(e.type)}">${e.type}</span></td>
        <td>${fmt(e.entry)}</td>
        <td>${fmt(e.stopLoss)}</td>
        <td>${fmt(e.tp1)} / ${fmt(e.tp2)} / ${fmt(e.tp3)}</td>
        <td><span class="signal ${btClass(r.bt.status)}">${btLabel(r.bt)}</span></td>
        <td>${btRealized(r.bt.realized)}</td>
        <td>${r.bt.daysHeld.toFixed(1)}d</td>
      </tr>`;
    })
    .join('');
  box.innerHTML = `
    <h2>Signal results — ${tf} (did entry/SL/TPs get hit?)</h2>
    ${chips}
    <div class="table-wrap"><table class="bt-table">
      <tr><th>Signal time</th><th>Type</th><th>Entry</th><th>SL</th><th>TP1 / TP2 / TP3</th><th>Outcome</th><th>Realized</th><th>Held</th></tr>
      ${rows}
    </table></div>`;
}

load().catch((e) => {
  document.getElementById('assetTitle').textContent = 'Error: ' + e.message;
});