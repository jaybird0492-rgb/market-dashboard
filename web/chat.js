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
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      let cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function clean(q) {
    let s = ' ' + q.toUpperCase().replace(/[^A-Z0-9+]/g, ' ').replace(/\s+/g, ' ') + ' ';
    // Normalize superlatives so paraphrases hit the same intents.
    s = s.replace(/ STRONGEST /g, ' STRONG ').replace(/ WEAKEST /g, ' WEAK ')
      .replace(/ HIGHEST /g, ' HIGH ').replace(/ LOWEST /g, ' LOW ')
      .replace(/ SAFEST /g, ' SAFE ').replace(/ MOST PROFITABLE /g, ' BEST ');
    return s;
  }
  function findCoins(q) {
    const found = [];
    for (const s of Object.keys(COINS)) {
      const re = new RegExp('(^| )' + s + '( |$)');
      if (re.test(q)) { found.push(s); continue; }
    }
    for (const [name, s] of Object.entries(ALIAS)) {
      if (q.includes(' ' + name + ' ') && !found.includes(s)) found.push(s);
    }
    if (!found.length) {
      const words = q.trim().split(' ');
      const vocab = [...Object.keys(COINS), ...Object.keys(ALIAS)];
      for (const w of words) {
        if (w.length < 4) continue;
        const lim = w.length <= 4 ? 2 : 3;
        let best = null, bd = lim;
        for (const v of vocab) {
          const d = lev(w, v);
          if (d < bd) { bd = d; best = v; }
        }
        if (best) {
          const s = COINS[best] ? best : ALIAS[best];
          if (s && !found.includes(s)) found.push(s);
        }
      }
    }
    return found;
  }
  function findTf(q) {
    for (const t of TFS) if (q.includes(t)) return t;
    if (q.includes(' HOURLY ') || q.includes(' HOUR ')) return '1H';
    if (q.includes(' DAILY ')) return '1D';
    if (q.includes(' 4HOUR ') || q.includes(' FOUR HOUR ')) return '4H';
    return null;
  }
  // Conversation memory: follow-ups like "what about ETH?" or "and the stop?"
  // reuse the previous turn's coin/timeframe.
  const CTX = { syms: [], tf: null };
  function isFollowup(q) {
    return q.includes('WHAT ABOUT') || q.includes('HOW ABOUT') || q.includes(' AND ') ||
      q.includes(' ALSO ') || q.includes(' ITS ') || q.includes(' THEIR ') || q.includes(' THAT ONE ');
  }
  function bandOf(score) {
    const sc = Math.abs(score || 0);
    return sc >= 50 ? '50+' : sc >= 35 ? '35-50' : sc >= 20 ? '20-35' : '0-20';
  }

  // What the website is and how it works — the bot's understanding of itself.
  const KNOW = [
    { k: ['WHAT IS THIS', 'ABOUT THIS', 'WHAT DOES THIS', 'THIS WEBSITE', 'THIS SITE', 'WHAT IS MARKET'],
      a: 'This dashboard trades 6 coins (BTC, ETH, SOL, XRP, BNB, HYPE) on 1H/4H/1D with one trend-following engine. Every hour it prints BUY, SELL or WAIT with entry, stop and 3 targets — then grades every past signal, paper-trades them, and autopsies the failures. Paper only: nothing here places real orders.' },
    { k: ['HOW ARE SIGNALS', 'HOW IS SIGNAL', 'HOW GENERATED', 'HOW DOES IT WORK', 'STRATEGY', 'ENGINE', 'METHOD'],
      a: 'Each signal scores 4 factors: trend vs moving averages (40%), RSI momentum (25%), ADX trend quality (25%), range position (10%). Score +5 or more is BUY, -5 or less is SELL, between is WAIT. Entry is the closed-bar close, stop is 1.2-1.8x ATR away, targets at 1x/2x/3x the stop distance exited 40/40/20. Only closed candles count — a forming candle can never fire.' },
    { k: ['WEAK BAND'],
      a: 'A weak band means: past signals in this exact score range won under 40% (min 5 precedents) on this coin and timeframe. The flag on a card says history disapproves of this trade — half size or skip. Bands rebuild hourly from the full log.' },
    { k: ['CONVICTION'],
      a: 'Conviction is the +5..+100/-5..-100 score. Further from zero = stronger blend of trend, RSI, ADX and breakout. But high conviction is not a promise: ETH 4H 50+ wins only 24% historically — always read it together with the band flag.' },
    { k: ['BREAKEVEN', 'MOVE STOP', 'STOP TO ENTRY'],
      a: 'After TP1 prints (first 40% banked), the stop moves to entry. The rest of the trade then cannot lose. This one rule converts most "stopped after partial profit" outcomes from losses into scratches — it is why the 1H leg survives at all.' },
    { k: ['AUTOPSY'],
      a: 'Every pure stop-out gets one diagnosed cause from its own entry factors: fought the daily bias, chased overbought/oversold, chop with no trend, broken structure, wicked out after reaching target zone, stop inside normal wiggle, or plain wrong direction. Counts rank on the mistakes board.' },
    { k: ['PAPER BOT', 'FAKE BOT', 'SIMULAT'],
      a: 'The paper bot takes live signals with $1,000 fake per trade: longs only, SELL flattens to cash, 40/40/20 partials, breakeven at TP1. It now skips weak bands and trades reduced coins on 1D only — the same discipline on the cards. Runs hourly on the server, so its page section stays fresh by itself.' },
    { k: ['READINESS', 'NOV 1', 'NOVEMBER', 'REAL MONEY', 'GO LIVE', 'SHOULD I TRADE'],
      a: 'Three gates: sized-bot paper profitable over 10+ closed trades, BTC+ETH daily win rate at least 60%, and live rails (testnet fills, minimum size, kill switch, losable stake). The dashboard traffic-lights them. Anything but 3 greens = wait.' },
    { k: ['RISK ', 'POSITION SIZE', 'HOW MUCH TO BUY', 'HOW MUCH BUY', 'QUANTITY', 'LOT SIZE', 'LEVERAGE'],
      a: 'Risk rule: never lose more than 1% of account on one stop. Quantity = (account x risk%) / |entry - stop|. Each asset page has both calculators: spot size and futures P&L with margin x leverage, fees and a liquidation warning. Click any past signal to run its numbers.' },
    { k: ['FEE', 'FEES', 'COST', 'FUNDING', 'SLIPPAGE'],
      a: 'Every number on the site already includes 0.1% round-trip costs. Not included: perp funding (matters on leverage held days) and fast-market slippage. Treat published profits as slightly optimistic.' },
    { k: ['KRAKEN', 'DATA SOURCE', 'DATA FROM', 'DATA COME', 'SOURCE', 'EXCHANGE', 'BINANCE', 'COINBASE'],
      a: 'Candles come from Kraken spot, hourly, 6 coins x 3 timeframes. Binance is geo-blocked on the servers, so there is no Binance feed. Futures prices track spot closely but are not identical — expect small basis differences on real fills.' },
    { k: ['FULL SIZE', 'REDUCED', 'SIZING', 'HALF SIZE'],
      a: 'Each coin is sized by its daily leg: FULL when its 1D signals average positive net of fees (currently BTC, ETH, SOL), else REDUCED-1D-ONLY — daily signals only, intraday skipped. Weak intraday bands are skipped on every coin. The paper bot trades exactly these rules.' },
    { k: ['CLOSED BAR', 'FORMING', 'REPAINT'],
      a: 'Signals use only finished candles — nothing ever repaints. The setup box always equals a stamped log row, one signal per closed bar. If a box ever shows otherwise, that is a bug: report the coin, timeframe and time.' },
    { k: ['SUPPORT', 'RESISTANCE', 'MA20', 'MA50', 'MA200', 'MOVING AVERAGE'],
      a: 'Trend context comes from MA20/50/200: price above the MA200 with MA50 above it is the backbone of every uptrend score. Nearest swing high/low within 60 bars set the chart support/resistance lines. The tradable stop is ATR-based; the paragraph stop is structure-based — trade the box, not the paragraph.' },
  ];
  function knowLine(q) {
    let best = null, bestHit = 0;
    for (const item of KNOW) {
      let hit = 0;
      for (const k of item.k) if (q.includes(k)) hit += k.length;
      if (hit > bestHit) { bestHit = hit; best = item; }
    }
    return bestHit >= 4 ? best.a : null;
  }
  function topMistake(sym, tf) {
    try {
      const r = DATA.autopsy.perAsset[sym][tf];
      const top = Object.entries(r.mistakes).sort((a, b) => b[1] - a[1])[0];
      return top ? top[0].replace(/_/g, ' ') + ' (×' + top[1] + ' of ' + r.sl + ' stops)' : null;
    } catch (e) { return null; }
  }

  function coinLine(sym) {
    const s = DATA.setups.setups[sym];
    if (!s) return sym + ': no data.';
    const parts = TFS.map((tf) => {
      const t = s.timeframes[tf];
      return t ? tf + ' ' + t.type + ' (' + (t.score >= 0 ? '+' : '') + t.score + ')' : tf + ' n/a';
    });
    let out = s.name + ' (' + sym + '): ' + fmtP(s.price) + ', bias ' + s.bias + ' — ' + parts.join(' · ') + '.';
    const size = DATA.track && DATA.track.perCoin && DATA.track.perCoin[sym] ? DATA.track.perCoin[sym].size : null;
    if (size === 'REDUCED-1D-ONLY') out += ' Sized REDUCED — this coin has only earned 1D trades; intraday is half size or skip.';
    return out;
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
    const tm = topMistake(sym, tf);
    const riskLine = tm ? ' Here it most often dies by ' + tm + '.' : '';
    return sym + ' ' + tf + ' ' + t.type + ' because: ' + bits.join(' · ') + '.' + hist + riskLine;
  }

  function answer(raw) {
    const Q = clean(raw);
    let syms = findCoins(Q);
    let tf = findTf(Q);
    const follow = isFollowup(Q);
    if (!syms.length && follow && CTX.syms.length) syms = CTX.syms.slice();
    if (!tf && follow && CTX.tf) tf = CTX.tf;
    const sym = syms[0] || null;
    const has = (...ws) => ws.some((w) => Q.includes(w));
    const remember = () => { if (syms.length) CTX.syms = syms.slice(); if (tf) CTX.tf = tf; };

    if (has('HELLO', 'HI ', 'HEY', 'THANKS', 'THANK YOU')) {
      return has('THANK') ? 'Anytime. Ask me about any coin, signal, or the paper profit.'
        : 'Hi. Ask me things like "BTC signal?", "compare BTC vs ETH", "what changed today?", "what should I avoid?".';
    }
    if (has('HELP', 'WHAT CAN YOU', 'COMMANDS', 'HOW DO I')) {
      return 'I understand: coin signals ("BTC?", "BTC and ETH?"), entries/stops/targets ("ETH 4H TP?"), reasons ("why HYPE 1D BUY?"), comparisons ("BTC vs ETH"), market overview ("how is the market?"), fresh signals ("what changed today?"), top conviction, things to avoid, track record, paper bot, mistakes, strengths, readiness. I also explain the machine — "how are signals generated?", "what is a weak band?". Follow-ups work: ask "what about ETH?" next.';
    }
    // (knowledge answers run after the computed intents below)
    if (has(' VS ', ' VERSUS ', 'COMPARE', 'COMPARISON', 'BETTER', 'DIFFERENCE BETWEEN') && syms.length >= 2) {
      remember();
      return syms.slice(0, 3).map((s) => coinLine(s)).join('\n');
    }
    if (has('AVOID', 'STAY AWAY', 'SHOULD I SKIP', 'WHAT TO SKIP', 'SKIP THIS', 'SKIP IT', "DON'T TAKE", 'WEAK NOW', 'RED FLAG', 'DANGER')) {
      return avoidLine();
    }
    if (has('HIGHEST', 'HIGH CONVICTION', 'TOP SIGNAL', 'MOST CONFIDENT', 'STRONGEST SIGNAL', 'STRONG SIGNAL', 'STRONG CONVICTION', 'BEST SIGNAL', 'TOP 3')) {
      return convictionLine();
    }
    if (has('STRONG COIN', 'STRONG MARKET', 'BEST COIN', ' SAFEST ', ' SAFE ') || (has(' STRONG ') && has('COIN', 'MARKET', 'CURRENCY', 'ASSET', 'NOW', 'CURRENT'))) {
      return strongestCoinLine();
    }
    if ((has(' WEAK ') && !has('BAND') && has('COIN', 'MARKET', 'SIGNAL', 'WHICH', 'NOW', 'CURRENT')) || has(' WORST ')) {
      return weakestCoinLine();
    }
    if (has('CHANGED', 'NEW SIGNAL', 'JUST IN', 'FRESH', 'LATELY', 'UPDATE', ' TODAY ')) {
      return changesLine();
    }
    if (has('HOW IS THE MARKET', 'MARKET OVERVIEW', 'MARKET SUMMARY', 'MARKET ROUNDUP', 'OVERVIEW', 'SUMMARY', 'ROUNDUP', 'HOW IS EVERYTHING', 'WHOLE MARKET', 'ALL COINS', 'EVERY COIN')) {
      return overviewLine();
    }
    const know = knowLine(Q);
    if (know) return know;
    if (has('READY', 'TRADE REAL', 'GO LIVE', 'NOV')) {
      return readinessLine();
    }
    if (has('PAPER', 'FAKE TRADE', 'BOT PROFIT', 'BOT P/L', 'BOT POSITION', 'SKIPPED', 'BOT SKIP')) {
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
      if (syms.length > 1 && tf) { remember(); return syms.slice(0, 3).map((s) => whyLine(s, tf)).join('\n'); }
      if (sym && tf) { remember(); return whyLine(sym, tf); }
      if (sym) { remember(); return coinLine(sym) + ' Ask "why ' + sym + ' 1H?" for the reasons.'; }
      return 'Tell me which coin and timeframe — e.g. "why is BTC 4H BUY?".';
    }
    if (has('STOP LOSS', 'STOPLOSS', ' STOP ', ' RISK')) {
      if (sym && tf) { remember(); return signalDetail(sym, tf); }
      if (syms.length) { remember(); return syms.slice(0, 3).map((s) => stopAllTfs(s)).join('\n'); }
      return 'Which coin? E.g. "XRP stop loss?" or "SOL 1D stop?".';
    }
    if (has(' TP', 'TARGET', 'TAKE PROFIT', 'ENTRY', 'ENTER', 'BUY AT', 'SELL AT')) {
      if (sym && tf) { remember(); return signalDetail(sym, tf); }
      if (syms.length) { remember(); return syms.slice(0, 3).map((s) => levelsAllTfs(s)).join('\n'); }
      return 'Which coin and timeframe? E.g. "BNB 4H entry and targets?".';
    }
    if (has('SIGNAL', 'BIAS', 'BULLISH', 'BEARISH', 'LONG', 'SHORT', 'POSITION', 'PRICE', 'OUTLOOK')) {
      if (sym && tf) { remember(); return signalDetail(sym, tf); }
      if (syms.length) { remember(); return syms.slice(0, 3).map((s) => coinLine(s)).join('\n'); }
      return allBiasLine();
    }
    if (sym) { remember(); return coinLine(sym); }
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
  function liveWeakList() {
    const out = [];
    if (!DATA.track || !DATA.track.bands) return out;
    for (const sym of Object.keys(DATA.setups.setups)) {
      for (const tf of TFS) {
        const st = DATA.setups.setups[sym].timeframes[tf];
        if (!st || st.entry === null || st.entry === undefined) continue;
        const b = DATA.track.bands[sym] && DATA.track.bands[sym][tf] ? DATA.track.bands[sym][tf][bandOf(st.score)] : null;
        if (b && b.weak) out.push(sym + ' ' + tf + ' ' + st.type + ' (' + (st.score >= 0 ? '+' : '') + st.score + ', band ' + b.winRate + '%/' + b.n + ')');
      }
    }
    return out;
  }
  function overviewLine() {
    const rows = Object.keys(DATA.setups.setups).map((k) => coinLine(k));
    const weak = liveWeakList();
    return rows.join('\n') + (weak.length ? '\nFlagged weak right now: ' + weak.join(' · ') + '.' : '\nNo weak flags on live signals right now.');
  }
  function changesLine() {
    const logs = DATA.setups.logs || {};
    const since = Date.now() - 24 * 3600 * 1000;
    const fresh = [];
    for (const sym of Object.keys(logs)) {
      for (const tf of TFS) {
        const arr = (logs[sym][tf] || []).filter((e) => e.time >= since && e.entry !== null && e.entry !== undefined);
        if (arr.length) {
          const e = arr[arr.length - 1];
          fresh.push(sym + ' ' + tf + ' ' + e.type + ' @ ' + fmtP(e.entry) + ' (' + ageStr(e.time) + ')');
        }
      }
    }
    if (!fresh.length) return 'No fresh stamped signals in the last 24h — everything live is a holdover. Ask "BTC signal?" for the standing picture.';
    return 'Fresh in the last 24h: ' + fresh.join(' · ') + '.';
  }
  function ageStr(t) {
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return mins + 'm ago';
    const h = Math.round(mins / 60);
    return h < 48 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
  }
  function strongestCoinLine() {
    const rows = Object.keys(DATA.setups.setups).map((k) => {
      const t = DATA.setups.setups[k].timeframes['1D'];
      return { sym: k, type: t ? t.type : 'n/a', score: t ? t.score : 0 };
    }).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const top = rows[0];
    let hist = '';
    try {
      const s = DATA.autopsy.strengths[0];
      if (s) hist = ' Best proven record: ' + s.sym + ' ' + s.tf + ' (' + s.winRate + '%, +' + s.avgPct.toFixed(1) + '%).';
    } catch (e) { /* no autopsy */ }
    return 'Strongest right now: ' + top.sym + ' 1D ' + top.type + ' (' + (top.score >= 0 ? '+' : '') + top.score + ').'
      + hist + ' Full ranking: ' + rows.map((r) => r.sym + ' ' + (r.score >= 0 ? '+' : '') + r.score).join(' · ') + '.';
  }
  function weakestCoinLine() {
    const rows = Object.keys(DATA.setups.setups).map((k) => {
      const t = DATA.setups.setups[k].timeframes['1D'];
      return { sym: k, type: t ? t.type : 'n/a', score: t ? t.score : 0 };
    }).sort((a, b) => Math.abs(a.score) - Math.abs(b.score));
    const low = rows[0];
    let hist = '';
    try {
      let worst = null;
      for (const [k, v] of Object.entries(DATA.track.perCoin)) {
        if (!worst || v.sumRealized < worst[1].sumRealized) worst = [k, v];
      }
      if (worst) hist = ' Worst record: ' + worst[0] + ' (' + (worst[1].sumRealized * 100).toFixed(1) + '% all-time).';
    } catch (e) { /* no track */ }
    return 'Weakest conviction: ' + low.sym + ' 1D ' + low.type + ' (' + (low.score >= 0 ? '+' : '') + low.score + ').'
      + hist + ' Ranking: ' + rows.map((r) => r.sym + ' ' + (r.score >= 0 ? '+' : '') + r.score).join(' · ') + '.';
  }
  function convictionLine() {    const rows = [];
    for (const sym of Object.keys(DATA.setups.setups)) {
      for (const tf of TFS) {
        const st = DATA.setups.setups[sym].timeframes[tf];
        if (st && (st.type === 'BUY' || st.type === 'SELL')) rows.push({ sym, tf, type: st.type, score: st.score });
      }
    }
    rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    return 'Top conviction live: ' + rows.slice(0, 3).map((r) => r.sym + ' ' + r.tf + ' ' + r.type + ' (' + (r.score >= 0 ? '+' : '') + r.score + ')').join(' · ') + '. High score is not a promise — check the band flag.';
  }
  function avoidLine() {
    const weak = liveWeakList();
    if (!weak.length) return 'Nothing flagged weak on live signals right now — but check each card: history disapproves quietly.';
    return 'Steer clear or half-size: ' + weak.join(' · ') + '. These bands won under 40% historically.';
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
      + '#chatSend{background:#2563eb;color:#fff;border:none;padding:0 16px;cursor:pointer}'
      + '#chatChips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-top:1px solid #334155}'
      + '#chatChips button{background:#0f172a;color:#93c5fd;border:1px solid #334155;border-radius:14px;padding:4px 10px;font-size:.72rem;cursor:pointer}';
    document.head.appendChild(css);
    const fab = document.createElement('button');
    fab.id = 'chatFab'; fab.textContent = '💬';
    fab.onclick = () => document.getElementById('chatBox').classList.toggle('open');
    const box = document.createElement('div');
    box.id = 'chatBox';
    box.innerHTML = '<div id="chatHead">Signal bot — ask about any trade</div><div id="chatLog"></div>'
      + '<div id="chatChips"><button>BTC signal?</button><button>What changed today?</button><button>What to avoid?</button><button>Paper profit?</button></div>'
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
    if (box.querySelectorAll) box.querySelectorAll('#chatChips button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('chatIn').value = b.textContent;
      ask();
    }));
    setTimeout(() => {
      document.getElementById('chatBox').classList.add('open');
      say('b', 'Ask me about any signal — e.g. "BTC signal?", "ETH 1D stop?", "paper profit?". I close myself when you start reading.');
      setTimeout(() => document.getElementById('chatBox').classList.remove('open'), 9000);
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.__chatAnswer = (q, data) => { DATA = data; return answer(q); };
  window.__chatReset = () => { CTX.syms = []; CTX.tf = null; };
})();
