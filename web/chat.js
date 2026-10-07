// Site chat bot — answers questions using the dashboard's own data files.
// Rules-based (keyword intents + data lookup). No AI, no network beyond static JSON.
(function () {
  const COINS = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', HYPE: 'Hyperliquid' };
  const ALIAS = { BITCOIN: 'BTC', ETHEREUM: 'ETH', SOLANA: 'SOL', RIPPLE: 'XRP', BINANCE: 'BNB', HYPERLIQUID: 'HYPE' };
  const TFS = ['1H', '4H', '1D'];
  let DATA = {};

  async function getJSON(path) {
    const r = await fetch(path + '?v=' + Date.now());
    if (!r.ok) throw new Error(path);
    return r.json();
  }
  async function ensure() {
    if (DATA.setups) return DATA;
    const base = '';
    const [setups, track, paper, autopsy] = await Promise.all([
      getJSON(base + 'data/setups.json').catch(() => null),
      getJSON(base + 'data/track_record.json').catch(() => null),
      getJSON(base + 'data/paper.json').catch(() => null),
      getJSON(base + 'data/autopsy.json').catch(() => null),
    ]);
    DATA = { setups, track, paper, autopsy };
    return DATA;
  }

  function fmtP(v) {
    if (v === null || v === undefined) return '-';
    return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 10000 ? 0 : 2 });
  }
  function findCoin(q) {
    for (const s of Object.keys(COINS)) if (q.includes(s)) return s;
    for (const [name, s] of Object.entries(ALIAS)) if (q.includes(name)) return s;
    return null;
  }
  function findTf(q) {
    for (const t of TFS) if (q.includes(t)) return t;
    if (q.includes('HOURLY') || q.includes('HOUR')) return '1H';
    if (q.includes('DAILY')) return '1D';
    return null;
  }
  function bandOf(score) {
    const sc = Math.abs(score || 0);
    return sc >= 50 ? '50+' : sc >= 35 ? '35-50' : sc >= 20 ? '20-35' : '0-20';
  }

  function coinLine(sym) {
    const s = DATA.setups.setups[sym];
    if (!s) return sym + ': no data.';
    const parts = TFS.map((tf) => {
      const t = s.timeframes[tf];
      return t ? tf + ' ' + t.type + ' (' + (t.score >= 0 ? '+' : '') + t.score + ')' : tf + ' n/a';
    });
    return s.name + ' (' + sym + '): ' + fmtP(s.price) + ', bias ' + s.bias + ' — ' + parts.join(' · ') + '.';
  }

  function signalDetail(sym, tf) {
    const s = DATA.setups.setups[sym];
    if (!s || !s.timeframes[tf]) return 'No ' + tf + ' data for ' + sym + '.';
    const t = s.timeframes[tf];
    if (t.entry === null || t.entry === undefined) {
      return sym + ' ' + tf + ' is ' + t.type + ' (' + (t.trigger || 'waiting') + ') — no entry levels.';
    }
    return sym + ' ' + tf + ' ' + t.type + ': entry ' + fmtP(t.entry) + ', stop ' + fmtP(t.stopLoss) +
      ' (' + t.risk + ' risk), TP1 ' + fmtP(t.tp1) + ' / TP2 ' + fmtP(t.tp2) + ' / TP3 ' + fmtP(t.tp3) +
      ', score ' + (t.score >= 0 ? '+' : '') + t.score + '. ' + (t.trigger || '');
  }

  function whyLine(sym, tf) {
    const s = DATA.setups.setups[sym];
    const t = s && s.timeframes[tf];
    if (!t || !t.factors) return 'No factor data for ' + sym + ' ' + (tf || '') + '.';
    const f = t.factors;
    const bits = [
      'trend ' + f.trend + ' (' + (f.trend >= 0.8 ? 'strongly up' : f.trend >= 0.3 ? 'leaning up' : f.trend <= -0.8 ? 'strongly down' : f.trend <= -0.3 ? 'leaning down' : 'flat') + ')',
      'RSI ' + f.rsi, 'ADX ' + f.adx + ' (' + (f.adx < 18 ? 'chop' : f.adx < 25 ? 'forming' : 'strong trend') + ')',
      'direction ' + f.direction,
    ];
    let hist = '';
    const b = DATA.track && DATA.track.bands && DATA.track.bands[sym] && DATA.track.bands[sym][tf]
      ? DATA.track.bands[sym][tf][bandOf(t.score)] : null;
    if (b) hist = ' This band won ' + b.winRate + '% over ' + b.n + ' past signals' + (b.weak ? ' — flagged WEAK, half size or skip.' : '.');
    return sym + ' ' + tf + ' ' + t.type + ' because: ' + bits.join(' · ') + '.' + hist;
  }

  function answer(q) {
    const Q = ' ' + q.toUpperCase() + ' ';
    const sym = findCoin(Q);
    const tf = findTf(Q);
    const has = (...ws) => ws.some((w) => Q.includes(w));

    if (has('HELLO', 'HI ', 'HEY', 'THANKS', 'THANK YOU')) {
      return has('THANK') ? 'Anytime. Ask me about any coin, signal, or the paper profit.'
        : 'Hi. Ask me things like "BTC signal?", "ETH 1H stop loss?", "why is SOL 4H BUY?", "paper profit?", "biggest mistakes?".';
    }
    if (has('HELP', 'WHAT CAN YOU', 'COMMANDS', 'HOW DO I')) {
      return 'I understand: coin signals ("BTC?"), entries/stops/targets ("ETH 4H TP?"), reasons ("why HYPE 1D BUY?"), track record ("win rate?"), paper bot ("paper profit?"), mistakes ("biggest mistakes?"), strengths, readiness ("ready to trade?"). Try one.';
    }
    if (has('READY', 'TRADE REAL', 'GO LIVE', 'NOV')) {
      return readinessLine();
    }
    if (has('PAPER', 'FAKE TRADE', 'BOT PROFIT', 'BOT P/L', 'BOT POSITION')) {
      return paperLine(sym);
    }
    if (has('MISTAKE', 'WRONG', 'STOPPED OUT', 'STOP LOSS HIT', 'AUTOPSY', 'FAIL')) {
      return mistakeLine(sym, tf);
    }
    if (has('STRENGTH', 'BEST COIN', 'BEST TIMEFRAME', 'WHAT WORKS', 'WINNING')) {
      return strengthLine();
    }
    if (has('WIN RATE', 'WINRATE', 'HIT RATE', 'TRACK RECORD', 'RECORD', 'PERFORMANCE', 'PROFIT', 'PNL', 'P/L')) {
      return recordLine(sym, tf);
    }
    if (has('WHY', 'REASON', 'BECAUSE', 'EXPLAIN')) {
      if (sym && tf) return whyLine(sym, tf);
      if (sym) return coinLine(sym) + ' Ask "why ' + sym + ' 1H?" for the reasons.';
      return 'Tell me which coin and timeframe — e.g. "why is BTC 4H BUY?".';
    }
    if (has('STOP LOSS', 'STOPLOSS', ' STOP ', ' RISK')) {
      if (sym && tf) return signalDetail(sym, tf);
      if (sym) return stopAllTfs(sym);
      return 'Which coin? E.g. "XRP stop loss?" or "SOL 1D stop?".';
    }
    if (has(' TP', 'TARGET', 'TAKE PROFIT', 'ENTRY', 'ENTER', 'BUY AT', 'SELL AT')) {
      if (sym && tf) return signalDetail(sym, tf);
      if (sym) return levelsAllTfs(sym);
      return 'Which coin and timeframe? E.g. "BNB 4H entry and targets?".';
    }
    if (has('SIGNAL', 'BIAS', 'BULLISH', 'BEARISH', 'LONG', 'SHORT', 'POSITION', 'PRICE', 'OUTLOOK')) {
      if (sym && tf) return signalDetail(sym, tf);
      if (sym) return coinLine(sym);
      return allBiasLine();
    }
    if (sym) return coinLine(sym);
    return 'I did not catch that. Try "BTC signal?", "ETH 1D stop?", "paper profit?", or "help".';
  }

  function levelsAllTfs(sym) {
    const s = DATA.setups.setups[sym];
    if (!s) return sym + ': no data.';
    return sym + ': ' + TFS.map((t) => {
      const x = s.timeframes[t];
      return x && x.entry !== null && x.entry !== undefined
        ? t + ' ' + x.type + ' in ' + fmtP(x.entry) + ' / out ' + fmtP(x.stopLoss) + ' / TP ' + fmtP(x.tp1)
        : t + ' ' + (x ? x.type : 'n/a') + ' (no levels)';
    }).join(' · ') + '.';
  }
  function stopAllTfs(sym) {
    const s = DATA.setups.setups[sym];
    if (!s) return sym + ': no data.';
    return sym + ': ' + TFS.map((tf) => {
      const t = s.timeframes[tf];
      return t && t.stopLoss ? tf + ' stop ' + fmtP(t.stopLoss) + ' (entry ' + fmtP(t.entry) + ')' : tf + ' no levels';
    }).join(' · ') + '.';
  }
  function allBiasLine() {
    return 'Biases — ' + Object.keys(DATA.setups.setups).map((k) => {
      const s = DATA.setups.setups[k];
      return k + ' ' + s.bias + ' @ ' + fmtP(s.price);
    }).join(' · ') + '. Ask any coin for 1H/4H/1D detail.';
  }
  function recordLine(sym, tf) {
    const t = DATA.track;
    if (!t) return 'Track record not loaded yet.';
    if (sym && tf && t.bands && t.bands[sym] && t.bands[sym][tf]) {
      const rows = Object.entries(t.bands[sym][tf]).map(([b, v]) => b + ': ' + v.winRate + '% of ' + v.n + (v.weak ? ' WEAK' : '')).join(' · ');
      return sym + ' ' + tf + ' by band — ' + rows + '.';
    }
    if (sym && t.perCoin[sym]) {
      const c = t.perCoin[sym];
      return sym + ': ' + c.total + ' signals, TP1 ×' + c.tp1 + ', full TP3 ×' + c.tp3 + ', stopped ×' + c.sl + ', realized ' + (c.sumRealized >= 0 ? '+' : '') + (c.sumRealized * 100).toFixed(1) + '%.';
    }
    const o = t.overall;
    return 'All coins: ' + o.total + ' signals, TP1 ×' + o.tp1 + ', full TP3 ×' + o.tp3 + ', stopped ×' + o.sl + ', realized ' + (o.sumRealized >= 0 ? '+' : '') + (o.sumRealized * 100).toFixed(1) + '%. Ask "BTC record?" for one coin.';
  }
  function paperLine(sym) {
    const p = DATA.paper;
    if (!p) return 'Paper bot data not loaded yet.';
    const s = p.stats;
    let out = 'Paper bot: ' + s.open + ' open, ' + s.closed + ' closed (' + s.wins + ' wins), total $' + s.totalUsd.toFixed(2) + ' on $' + p.notional + ' notionals.'
      + ' Skipped ' + ((s.skippedWeak || 0) + (s.skippedSize || 0)) + ' weak entries.';
    const list = (p.open || []).filter((o) => !sym || o.sym === sym).slice(0, 6);
    if (list.length) out += ' Open: ' + list.map((o) => o.sym + ' ' + o.tf + ' @ ' + fmtP(o.entry) + (o.tp1hit ? ' (TP1 banked, breakeven)' : '')).join(' · ') + '.';
    return out;
  }
  function mistakeLine(sym, tf) {
    const a = DATA.autopsy;
    if (!a) return 'Autopsy not loaded yet.';
    if (sym && a.perAsset[sym]) {
      const agg = {};
      let sl = 0;
      for (const t of TFS) {
        const r = a.perAsset[sym][t];
        if (!r) continue;
        if (tf && t !== tf) continue;
        sl += r.sl;
        for (const [m, n] of Object.entries(r.mistakes)) agg[m] = (agg[m] || 0) + n;
      }
      const ms = Object.entries(agg).sort((x, y) => y[1] - x[1]).slice(0, 3)
        .map(([m, n]) => m.replace(/_/g, ' ') + ' ×' + n).join(' · ');
      return sym + (tf ? ' ' + tf : '') + ': ' + sl + ' stop-outs' + (ms ? ' — ' + ms + '.' : ' — no pattern yet.');
    }
    const top = a.mistakes.slice(0, 3).map((m) => m.tf + ' ' + m.mistake.replace(/_/g, ' ') + ' ×' + m.count).join(' · ');
    return 'Biggest mistakes everywhere: ' + top + '. Ask "HYPE mistakes?" for one coin.';
  }
  function strengthLine() {
    const a = DATA.autopsy;
    if (!a || !a.strengths.length) return 'No profitable unit yet.';
    return 'Strengths: ' + a.strengths.slice(0, 4).map((s) => s.sym + ' ' + s.tf + ' (' + s.winRate + '%, +' + s.avgPct.toFixed(1) + '%)').join(' · ') + '.';
  }
  function readinessLine() {
    const bits = [];
    const p = DATA.paper && DATA.paper.stats;
    bits.push(p && p.closed >= 10 && p.totalUsd > 0 ? 'paper green ✓' : 'paper not green yet ✗');
    try {
      const b = DATA.autopsy.perAsset.BTC['1D'].winRate, e = DATA.autopsy.perAsset.ETH['1D'].winRate;
      bits.push(b >= 60 && e >= 60 ? '1D edge holding ✓' : '1D edge shaky ✗');
    } catch (err) { bits.push('1D edge unknown'); }
    return 'Nov 1 readiness: ' + bits.join(' · ') + ' (plus your manual rails check on the dashboard).';
  }

  function mount() {
    if (document.getElementById('chatFab')) return;
    const css = document.createElement('style');
    css.innerHTML = '#chatFab{position:fixed;right:18px;bottom:18px;width:52px;height:52px;border-radius:50%;background:#2563eb;color:#fff;font-size:24px;border:none;cursor:pointer;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,.4)}'
      + '#chatBox{display:none;position:fixed;right:18px;bottom:80px;width:min(360px,92vw);max-height:60vh;background:#1e293b;border:1px solid #334155;border-radius:12px;z-index:9999;flex-direction:column;overflow:hidden}'
      + '#chatBox.open{display:flex}#chatHead{padding:10px 14px;background:#0f172a;font-weight:700;color:#e2e8f0;font-size:.9rem}'
      + '#chatLog{padding:10px 12px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px;max-height:40vh}'
      + '.chat-u{align-self:flex-end;background:#2563eb;color:#fff;border-radius:10px 10px 2px 10px;padding:7px 10px;font-size:.82rem;max-width:85%}'
      + '.chat-b{align-self:flex-start;background:#0f172a;color:#cbd5e1;border-radius:10px 10px 10px 2px;padding:7px 10px;font-size:.82rem;max-width:90%}'
      + '#chatRow{display:flex;border-top:1px solid #334155}#chatIn{flex:1;background:#0f172a;border:none;color:#e2e8f0;padding:10px 12px;font-size:.85rem;outline:none}'
      + '#chatSend{background:#2563eb;color:#fff;border:none;padding:0 16px;cursor:pointer}';
    document.head.appendChild(css);
    const fab = document.createElement('button');
    fab.id = 'chatFab'; fab.textContent = '💬';
    fab.onclick = () => document.getElementById('chatBox').classList.toggle('open');
    const box = document.createElement('div');
    box.id = 'chatBox';
    box.innerHTML = '<div id="chatHead">Signal bot — ask about any trade</div><div id="chatLog"></div>'
      + '<div id="chatRow"><input id="chatIn" placeholder="e.g. why is BTC 1H SELL?"><button id="chatSend">➤</button></div>';
    document.body.appendChild(fab);
    document.body.appendChild(box);
    const say = (who, text) => {
      const d = document.createElement('div');
      d.className = who === 'u' ? 'chat-u' : 'chat-b';
      d.textContent = text;
      const logEl = document.getElementById('chatLog');
      logEl.appendChild(d);
      logEl.scrollTop = logEl.scrollHeight;
    };
    const ask = async () => {
      const inp = document.getElementById('chatIn');
      const q = inp.value.trim();
      if (!q) return;
      inp.value = '';
      say('u', q);
      say('b', '…');
      try {
        await ensure();
        const logEl = document.getElementById('chatLog');
        logEl.removeChild(logEl.lastChild);
        say('b', answer(q));
      } catch (e) {
        const logEl = document.getElementById('chatLog');
        logEl.removeChild(logEl.lastChild);
        say('b', 'Data still loading — try again in a few seconds.');
      }
    };
    document.getElementById('chatSend').onclick = ask;
    document.getElementById('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
    setTimeout(() => {
      document.getElementById('chatBox').classList.add('open');
      say('b', 'Ask me about any signal — e.g. "BTC signal?", "ETH 1D stop?", "paper profit?". I close myself when you start reading.');
      setTimeout(() => document.getElementById('chatBox').classList.remove('open'), 9000);
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.__chatAnswer = (q, data) => { DATA = data; return answer(q); };
})();
