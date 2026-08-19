function renderCandles(canvas, data) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const bars = data.bars;
  const n = bars.length;
  const volH = Math.floor(h * 0.18);

  let min = Infinity;
  let max = -Infinity;
  let maxVol = 0;
  for (const b of bars) {
    min = Math.min(min, b.l);
    max = Math.max(max, b.h);
    maxVol = Math.max(maxVol, b.v || 0);
  }
  const pad = (max - min) * 0.06 || max * 0.01;
  min -= pad;
  max += pad;
  const levels = [data.support, data.resistance].filter((v) => v !== null && v !== undefined);
  for (const lv of levels) {
    if (lv < min) min = lv;
    if (lv > max) max = lv;
  }
  const maVals = [data.ma20, data.ma50].filter((v) => v !== null && v !== undefined);
  for (const lv of maVals) {
    if (lv < min) min = lv;
    if (lv > max) max = lv;
  }
  const span = max - min || 1;
  const y = (p) => 8 + (1 - (p - min) / span) * (h - volH - 16);
  const x = (i) => (i + 0.5) * (w / n);

  // background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 5; g++) {
    const gy = 8 + (g / 5) * (h - volH - 16);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  const bw = Math.max(1, (w / n) * 0.6);

  // volume
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!b.v) continue;
    const vh = (b.v / maxVol) * (volH - 10);
    ctx.fillStyle = b.c >= b.o ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
    ctx.fillRect(x(i) - bw / 2, h - volH + (volH - vh), bw, vh);
  }

  // candles
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const up = b.c >= b.o;
    ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
    ctx.fillStyle = up ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 1;
    // wick
    ctx.beginPath();
    ctx.moveTo(x(i), y(b.h));
    ctx.lineTo(x(i), y(b.l));
    ctx.stroke();
    // body
    const top = y(Math.max(b.o, b.c));
    const bot = y(Math.min(b.o, b.c));
    ctx.fillRect(x(i) - bw / 2, top, bw, Math.max(bot - top, 1));
  }

  // MA lines
  if (data.maSeries20 && data.maSeries50) {
    drawLine(ctx, data.maSeries20, x, y, '#60a5fa', w, n);
    drawLine(ctx, data.maSeries50, x, y, '#fb923c', w, n);
  }

  // support/resistance
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  if (data.support !== null && data.support !== undefined) {
    ctx.strokeStyle = '#38bdf8';
    const sy = y(data.support);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.fillText('S ' + fmtShort(data.support), 6, sy - 4);
  }
  if (data.resistance !== null && data.resistance !== undefined) {
    ctx.strokeStyle = '#f472b6';
    const ry = y(data.resistance);
    ctx.beginPath();
    ctx.moveTo(0, ry);
    ctx.lineTo(w, ry);
    ctx.stroke();
    ctx.fillStyle = '#f472b6';
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.fillText('R ' + fmtShort(data.resistance), 6, ry - 4);
  }
  ctx.setLineDash([]);

  // last price
  const last = bars[n - 1].c;
  const ly = y(last);
  ctx.strokeStyle = '#e2e8f0';
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(0, ly);
  ctx.lineTo(w, ly);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 11px Segoe UI, sans-serif';
  ctx.fillText(fmtShort(last), w - 70, ly - 4);

  function fmtShort(v) {
    const d = v >= 10000 ? 0 : v >= 100 ? 2 : 4;
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: d });
  }
}

function drawLine(ctx, arr, x, y, color, w, n) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (arr[i] === null || arr[i] === undefined) continue;
    if (i === 0 || arr[i - 1] === null || arr[i - 1] === undefined) ctx.moveTo(x(i), y(arr[i]));
    else ctx.lineTo(x(i), y(arr[i]));
  }
  ctx.stroke();
}
