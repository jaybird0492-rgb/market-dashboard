const TFS = ['1H', '4H', '1D', '1M'];
const ASSETS = [
  { sym: 'AAPL', name: 'Apple', group: 'stocks' },
  { sym: 'GOOGL', name: 'Alphabet', group: 'stocks' },
  { sym: 'AMZN', name: 'Amazon', group: 'stocks' },
  { sym: 'SPY', name: 'S&P 500 ETF', group: 'stocks' },
  { sym: 'QQQ', name: 'Nasdaq 100 ETF', group: 'stocks' },
  { sym: 'BTC', name: 'Bitcoin', group: 'crypto' },
  { sym: 'ETH', name: 'Ethereum', group: 'crypto' },
];

function fmtPrice(v) {
  if (v === null || v === undefined) return '-';
  return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtTime(t) {
  if (!t) return '-';
  const d = new Date(t);
  const now = new Date();
  const diffH = Math.round((now - d) / 3600000);
  if (diffH < 1) return 'just now';
  if (diffH < 24) return diffH + 'h ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function signalClass(type) {
  if (type === 'BUY') return 'sig-long';
  if (type === 'SELL') return 'sig-out';
  if (type === 'RANGE' || type === 'WAIT') return 'sig-watch';
  return 'sig-none';
}

function statusFor(type) {
  if (type === 'BUY' || type === 'SELL') return 'LIVE';
  if (type === 'WAIT') return 'PIPELINE';
  if (type === 'RANGE') return 'RANGE';
  return 'NONE';
}

function statusClass(type) {
  if (type === 'BUY' || type === 'SELL') return 'status-live';
  if (type === 'WAIT') return 'status-pipeline';
  if (type === 'RANGE') return 'status-range';
  return 'status-none';
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

async function loadJson(apiUrl, staticPath) {
  try { return await fetchJson(apiUrl); } catch { return fetchJson(staticPath + '?v=' + Date.now()); }
}

let prevSignals = {};

function detectChanges(setups, logs) {
  const changes = [];
  for (const a of ASSETS) {
    for (const tf of TFS) {
      const cur = setups.setups[a.sym]?.timeframes[tf];
      if (!cur) continue;
      const key = a.sym + ':' + tf;
      const prev = prevSignals[key];
      if (prev && prev.type !== cur.type) {
        changes.push({
          sym: a.sym, tf, name: a.name,
          oldType: prev.type, newType: cur.type,
          entry: cur.entry, time: new Date().toISOString(),
        });
      }
      prevSignals[key] = { type: cur.type, entry: cur.entry };
    }
  }
  return changes;
}

function notifyBrowser(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔔</text></svg>' });
  }
}

function renderPipeline(setups, logs) {
  const wrap = document.getElementById('pipeline');
  const groups = { stocks: 'Stocks', crypto: 'Crypto' };
  let html = '';

  for (const [grp, grpLabel] of Object.entries(groups)) {
    const assets = ASSETS.filter((a) => a.group === grp);
    html += '<div class="pipe-group"><h2>' + grpLabel + '</h2>';

    for (const a of assets) {
      const s = setups.setups[a.sym];
      if (!s) continue;

      html += '<div class="pipe-asset">';
      html += '<div class="pipe-asset-head">';
      html += '<a href="asset.html?symbol=' + a.sym + '" class="pipe-sym">' + a.sym + '</a>';
      html += '<span class="pipe-name">' + a.name + '</span>';
      html += '</div>';

      html += '<div class="pipe-tfs">';
      for (const tf of TFS) {
        const st = s.timeframes[tf];
        if (!st) continue;
        const type = st.type;
        const status = statusFor(type);
        const log = (logs && logs[a.sym] && logs[a.sym][tf]) || [];
        const lastEntry = log.length ? log[log.length - 1] : null;

        html += '<div class="pipe-tf ' + statusClass(type) + '">';
        html += '<div class="pipe-tf-head">';
        html += '<span class="pipe-tf-label">' + tf + '</span>';
        html += '<span class="pipe-status pipe-' + status.toLowerCase() + '">' + status + '</span>';
        html += '</div>';

        html += '<div class="pipe-signal">';
        html += '<span class="signal ' + signalClass(type) + '">' + type + '</span>';
        html += '</div>';

        if (type === 'BUY' || type === 'SELL') {
          html += '<div class="pipe-levels">';
          html += '<div class="pipe-level"><span class="pipe-lbl">Entry</span><span class="pipe-val entry">' + fmtPrice(st.entry) + '</span></div>';
          html += '<div class="pipe-level"><span class="pipe-lbl">SL</span><span class="pipe-val stop">' + fmtPrice(st.stopLoss) + '</span></div>';
          html += '<div class="pipe-level"><span class="pipe-lbl">TP1</span><span class="pipe-val tp">' + fmtPrice(st.tp1) + '</span></div>';
          html += '<div class="pipe-level"><span class="pipe-lbl">TP2</span><span class="pipe-val tp">' + fmtPrice(st.tp2) + '</span></div>';
          html += '<div class="pipe-level"><span class="pipe-lbl">TP3</span><span class="pipe-val tp">' + fmtPrice(st.tp3) + '</span></div>';
          html += '</div>';
          html += '<div class="pipe-trigger">' + (st.trigger || '') + '</div>';
        } else {
          html += '<div class="pipe-wait">' + (st.trigger || 'Waiting for setup') + '</div>';
        }

        if (lastEntry) {
          html += '<div class="pipe-last">Last: ' + fmtTime(lastEntry.time) + ' — ' + lastEntry.type + '</div>';
        }

        html += '</div>';
      }
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  wrap.innerHTML = html;
}

function renderChangeLog(changes) {
  if (!changes.length) return '';
  let html = '<div class="change-log"><h3>Recent signal changes</h3>';
  for (const c of changes.slice(-10).reverse()) {
    const cls = c.newType === 'BUY' ? 'sig-long' : c.newType === 'SELL' ? 'sig-out' : 'sig-watch';
    html += '<div class="change-item">';
    html += '<span class="change-time">' + fmtTime(c.time) + '</span>';
    html += '<span class="change-sym">' + c.sym + '</span>';
    html += '<span class="change-tf">' + c.tf + '</span>';
    html += '<span class="signal ' + cls + '">' + c.oldType + ' → ' + c.newType + '</span>';
    if (c.entry) html += '<span class="change-entry">' + fmtPrice(c.entry) + '</span>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

let changeLog = [];

async function init() {
  try {
    const [setups, logs] = await Promise.all([
      loadJson('/api/setups', 'data/setups.json'),
      loadJson('/api/setups', 'data/setups.json').catch(() => null),
    ]);

    document.getElementById('updatedAt').textContent =
      'Updated: ' + new Date(setups.updatedAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

    const changes = detectChanges(setups, setups.logs);
    if (changes.length) {
      changeLog = changeLog.concat(changes);
      for (const c of changes) {
        notifyBrowser(
          c.sym + ' ' + c.tf + ': ' + c.oldType + ' → ' + c.newType,
          c.newType === 'BUY' || c.newType === 'SELL'
            ? 'Entry: ' + fmtPrice(c.entry)
            : 'Signal changed'
        );
      }
    }

    renderPipeline(setups, setups.logs);
    const logHtml = renderChangeLog(changeLog);
    if (logHtml) {
      document.getElementById('pipeline').insertAdjacentHTML('afterbegin', logHtml);
    }
  } catch (e) {
    document.getElementById('updatedAt').textContent = 'Error: ' + e.message;
  }
}

document.getElementById('notifBtn').addEventListener('click', () => {
  if (Notification.permission === 'default') {
    Notification.requestPermission().then((p) => {
      document.getElementById('notifBtn').textContent = p === 'granted' ? 'Notifications on' : 'Notifications blocked';
    });
  } else if (Notification.permission === 'granted') {
    notifyBrowser('Test notification', 'Pipeline alerts are active');
  }
});

init();
setInterval(init, 60000);
