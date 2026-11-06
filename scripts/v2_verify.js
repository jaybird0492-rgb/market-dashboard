// Dashboard data verifier — fails loudly if the exported paper JSON drifts
// from the accounting identities the UI relies on. Run after the paper bots:
//   node scripts/v2_verify.js
// Exit code 1 on any failure, so the GitHub workflow stops before committing
// or deploying bad numbers.
const fs = require('fs');
const path = require('path');

const FILES = [
  ['daily', 'web/data/v2.json'],
  ['4h', 'web/data/v2_4h.json'],
  ['preview', 'web/data/preview_4h.json'],
];

let failures = 0;
const fail = (file, msg) => { failures++; console.error(`FAIL ${file}: ${msg}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function walkNumbers(obj, file, p = '') {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'number' && !Number.isFinite(obj)) fail(file, `non-finite number at ${p}`);
    return;
  }
  for (const [k, v] of Object.entries(obj)) walkNumbers(v, file, `${p}.${k}`);
}

function verify(name, file) {
  if (!fs.existsSync(file)) {
    if (name === 'preview') return; // optional fixture
    fail(file, 'missing');
    return;
  }
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(file, 'invalid JSON: ' + e.message); return; }
  walkNumbers(d, file);

  if (d.schema !== 3) fail(file, `schema ${d.schema} (expected 3)`);
  for (const k of ['equity', 'realizedEquity', 'startEquity', 'openRiskUsd', 'drawdownFromPeak', 'open', 'closed', 'stats', 'equityCurve']) {
    if (d[k] === undefined || d[k] === null) fail(file, `missing ${k}`);
  }
  if (failures) return;

  const n = d.closed.length;
  const sumPnl = sum(d.closed.map((t) => t.pnlUsd));
  const sumUnreal = sum(d.open.map((p) => p.unrealUsd));
  const tol = 0.02 + 0.01 * n;

  if (!near(d.realizedEquity, d.startEquity + sumPnl, tol)) {
    fail(file, `realizedEquity ${d.realizedEquity} != start ${d.startEquity} + closed P&L ${sumPnl.toFixed(2)}`);
  }
  if (!near(d.equity, d.realizedEquity + sumUnreal, tol)) {
    fail(file, `equity ${d.equity} != realized ${d.realizedEquity} + unrealized ${sumUnreal.toFixed(2)}`);
  }
  if (!near(d.openRiskUsd, sum(d.open.map((p) => p.riskUsd)), 0.05)) {
    fail(file, 'openRiskUsd does not match open positions');
  }
  if (!near(d.stats.netPnlUsd, d.equity - d.startEquity, 0.02)) {
    fail(file, `stats.netPnlUsd ${d.stats.netPnlUsd} != equity - start`);
  }
  if (d.stats.closed !== n) fail(file, `stats.closed ${d.stats.closed} != closed.length ${n}`);
  if (d.stats.open !== d.open.length) fail(file, `stats.open ${d.stats.open} != open.length ${d.open.length}`);
  if (d.stats.wins + d.stats.losses !== n) fail(file, 'wins + losses != closed');
  if (d.drawdownFromPeak > 0) fail(file, `drawdownFromPeak ${d.drawdownFromPeak} > 0`);

  if (n && d.stats.winRatePct !== null) {
    const expect = (d.stats.wins / n) * 100;
    if (!near(d.stats.winRatePct, expect, 0.05)) fail(file, `winRatePct ${d.stats.winRatePct} != ${expect.toFixed(2)}`);
  }
  const status = n < 10 ? 'insufficient' : n < 30 ? 'building' : 'usable';
  if (d.stats.sampleStatus !== status) fail(file, `sampleStatus ${d.stats.sampleStatus} (expected ${status})`);

  for (const t of d.closed) {
    if (!(t.riskUsd > 0)) fail(file, `closed ${t.id}: riskUsd ${t.riskUsd}`);
    if (!near(t.r, t.pnlUsd / t.riskUsd, 0.02)) fail(file, `closed ${t.id}: r ${t.r} vs pnl/risk ${(t.pnlUsd / t.riskUsd).toFixed(3)}`);
    if (!['LONG', 'SHORT'].includes(t.side)) fail(file, `closed ${t.id}: side ${t.side}`);
    if (t.side === 'LONG' && !(t.exit >= 0)) fail(file, `closed ${t.id}: exit`);
  }
  for (const p of d.open) {
    if (!(p.qty > 0)) fail(file, `open ${p.sym}: qty ${p.qty}`);
    if (!(p.riskUsd > 0)) fail(file, `open ${p.sym}: riskUsd ${p.riskUsd}`);
    if (p.side === 'LONG' && !(p.stop < p.entry)) fail(file, `open ${p.sym} LONG: stop ${p.stop} >= entry ${p.entry}`);
    if (p.side === 'SHORT' && !(p.stop > p.entry)) fail(file, `open ${p.sym} SHORT: stop ${p.stop} <= entry ${p.entry}`);
    if (!near(p.unrealR, p.unrealUsd / p.riskUsd, 0.02)) fail(file, `open ${p.sym}: unrealR ${p.unrealR}`);
    if (!(p.notionalUsd > 0) || !(p.riskPct > 0)) fail(file, `open ${p.sym}: notional/riskPct`);
  }

  const curve = d.equityCurve;
  if (!curve.length) fail(file, 'empty equityCurve');
  for (let i = 1; i < curve.length; i++) {
    if (Date.parse(curve[i].t) < Date.parse(curve[i - 1].t)) fail(file, `equityCurve not monotonic at ${i}`);
  }
  if (!near(curve[0].equity, d.startEquity, 0.02)) fail(file, `curve start ${curve[0].equity} != startEquity`);
  if (!near(curve[curve.length - 1].equity, d.equity, 0.05)) fail(file, `curve end ${curve[curve.length - 1].equity} != equity`);

  console.log(`ok ${name}: equity $${d.equity}, ${d.open.length} open, ${n} closed, ${curve.length} curve pts, sample=${d.stats.sampleStatus}`);
}

for (const [name, file] of FILES) verify(name, path.join(__dirname, '..', file));
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall dashboard data checks passed');
