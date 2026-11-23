// Freshness patch tests.
//
// These tests do not re-implement the logic: they extract the
// /* freshness-core:start */ ... /* freshness-core:end */ block from the
// shipped web/index.html and evaluate that exact code. If the page and the
// tests ever drift apart, the extraction fails or the assertions fail.
//
// Run: node test/freshness.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'web', 'index.html');
const html = readFileSync(htmlPath, 'utf8');

const start = html.indexOf('/* freshness-core:start */');
const end = html.indexOf('/* freshness-core:end */');
assert.ok(start !== -1 && end > start, 'freshness-core markers must exist in web/index.html');

const code = html.slice(start, end);
const core = new Function(
  code +
  '\nreturn { MS_1H, MS_4H, PUBLISH_GRACE_MS, floorTo, expectedCloseAt, candleFreshness, classify4h, feedStateAt, shouldStartRefresh, applyFetchResult, refreshStatusText, stampUTC, stampHM };'
)();

const {
  MS_1H, MS_4H, PUBLISH_GRACE_MS,
  expectedCloseAt, candleFreshness, classify4h, feedStateAt,
  shouldStartRefresh, applyFetchResult, refreshStatusText,
} = core;

const T = (iso) => Date.parse(iso);

// Minimal published-snapshot fixture. Only fields the shipped core reads are
// included, plus the fields the review reads to build a card.
function coin(sym, { asOf4h, asOf1h, lastBreakout = null, setup = {}, warning = {} } = {}) {
  return {
    sym,
    setup4h: {
      asOf: asOf4h,
      price: 100,
      longTrigger: 101,
      shortTrigger: 99,
      gateAllows: 'BOTH',
      longAllowed: true,
      shortAllowed: true,
      dailyLong: true,
      dailyShort: true,
      nativeLong: true,
      nativeShort: true,
      sma200_4h: 95,
      pctTo4hSma200: 5.26,
      lastBreakout,
      ...setup,
    },
    context1d: {
      asOf: '2026-11-21',
      price: 100,
      longTrigger: 110,
      shortTrigger: 90,
      aboveSma200: true,
      sma50Above200: true,
    },
    warning1h: {
      asOf: asOf1h,
      state: 'QUIET',
      detail: 'inside its 20-bar range',
      ...warning,
    },
  };
}
function sig(updatedAt, coins) {
  return { updatedAt, coins };
}

// ---------------------------------------------------------------------------
// 1. Current candle with no breakout
// ---------------------------------------------------------------------------
test('current candle with no breakout is CURRENT and labelled "Current — no breakout"', () => {
  const now = T('2026-11-22T13:07:00Z');
  const s = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z' }),
  ]);
  const f = feedStateAt(s, now);
  assert.equal(f.state, 'CURRENT');
  assert.equal(f.coins[0].state, 'CURRENT');

  // asOf is the candle OPEN; the processed close is open + interval.
  assert.equal(f.coins[0].fourH.publishedCloseMs, T('2026-11-22T12:00:00Z'));
  assert.equal(f.coins[0].oneH.publishedCloseMs, T('2026-11-22T13:00:00Z'));
  assert.equal(f.coins[0].fourH.expectedCloseMs, T('2026-11-22T12:00:00Z'));
  assert.equal(f.coins[0].fourH.nextCloseMs, T('2026-11-22T16:00:00Z'));

  const c = classify4h(f.coins[0].fourH, s.coins[0].setup4h);
  assert.equal(c.kind, 'none');
  assert.equal(c.current, true);
  assert.equal(c.chip, 'Current — no breakout');
});

// ---------------------------------------------------------------------------
// 2. Delayed candle — including the required regression case
// ---------------------------------------------------------------------------
test('regression: 4H bar 04:00→08:00 is DELAYED at 13:07 if the 12:00 close is unpublished', () => {
  const now = T('2026-11-22T13:07:00Z');
  const s = sig('2026-11-22T08:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T04:00:00Z', asOf1h: '2026-11-22T12:00:00Z' }),
  ]);
  const f = feedStateAt(s, now);
  assert.equal(f.state, 'DELAYED');
  assert.equal(f.coins[0].fourH.status, 'DELAYED');
  assert.equal(f.coins[0].fourH.publishedCloseMs, T('2026-11-22T08:00:00Z'));
  assert.equal(f.coins[0].fourH.expectedCloseMs, T('2026-11-22T12:00:00Z'));
  assert.equal(f.coins[0].fourH.overdueMs, 67 * 60e3);
  assert.equal(f.coins[0].fourH.missingBars, 1);

  const c = classify4h(f.coins[0].fourH, s.coins[0].setup4h);
  assert.equal(c.kind, 'delayed');
  assert.equal(c.current, false);
  assert.match(c.chip, /historical/i);
});

test('a close is AWAITING inside the 15-minute grace and DELAYED at the boundary', () => {
  const asOf = T('2026-11-22T04:00:00Z'); // closed 08:00
  assert.equal(PUBLISH_GRACE_MS, 15 * 60e3);

  const inside = candleFreshness(asOf, MS_4H, T('2026-11-22T12:14:59Z'));
  assert.equal(inside.status, 'AWAITING');
  assert.equal(inside.expectedCloseMs, T('2026-11-22T12:00:00Z'));

  const boundary = candleFreshness(asOf, MS_4H, T('2026-11-22T12:15:00Z'));
  assert.equal(boundary.status, 'DELAYED');

  const justDue = candleFreshness(asOf, MS_4H, T('2026-11-22T12:05:00Z'));
  assert.equal(justDue.status, 'AWAITING');
});

// ---------------------------------------------------------------------------
// 3. Fresh blocked 4H breakout
// ---------------------------------------------------------------------------
test('fresh blocked 4H breakout is CURRENT and labelled blocked, not a signal', () => {
  const now = T('2026-11-22T13:07:00Z');
  const lb = {
    at: '2026-11-22T08:00:00Z',
    dir: 'LONG',
    allowed: false,
    blockedBy: 'daily gate',
    close: 102,
    level: 101,
  };
  const s = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z', lastBreakout: lb }),
  ]);
  const f = feedStateAt(s, now);
  assert.equal(f.state, 'CURRENT');

  const c = classify4h(f.coins[0].fourH, s.coins[0].setup4h);
  assert.equal(c.kind, 'blocked');
  assert.equal(c.current, true);
  assert.equal(c.chip, 'Blocked setup — current');
});

test('fresh allowed 4H breakout is a CURRENT confirmed signal', () => {
  const now = T('2026-11-22T13:07:00Z');
  const lb = {
    at: '2026-11-22T08:00:00Z',
    dir: 'SHORT',
    allowed: true,
    close: 98,
    level: 99,
  };
  const s = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z', lastBreakout: lb }),
  ]);
  const c = classify4h(feedStateAt(s, now).coins[0].fourH, s.coins[0].setup4h);
  assert.equal(c.kind, 'confirmed');
  assert.equal(c.chip, 'Confirmed signal — current');
});

// ---------------------------------------------------------------------------
// 4. Older lastBreakout
// ---------------------------------------------------------------------------
test('older lastBreakout is not the current signal', () => {
  const now = T('2026-11-22T13:07:00Z');
  const lb = {
    at: '2026-11-22T04:00:00Z', // older bar open
    dir: 'LONG',
    allowed: true,
    close: 102,
    level: 101,
  };
  const s = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z', lastBreakout: lb }),
  ]);
  const c = classify4h(feedStateAt(s, now).coins[0].fourH, s.coins[0].setup4h);
  assert.equal(c.kind, 'none');
  assert.equal(c.current, true);
  assert.notEqual(c.kind, 'confirmed');
  assert.notEqual(c.kind, 'blocked');
});

// ---------------------------------------------------------------------------
// 5. Failed fetch keeps the last good data
// ---------------------------------------------------------------------------
test('failed fetch keeps last good data and reports the failure', () => {
  const good = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z' }),
  ]);
  const prev = { sig: good, lastGoodAt: T('2026-11-22T12:06:00Z') };
  const out = applyFetchResult(prev, { ok: false, error: 'network down' }, T('2026-11-22T13:07:00Z'));

  assert.equal(out.sig, good);
  assert.equal(out.failed, true);
  assert.equal(out.error, 'network down');
  assert.equal(out.lastGoodAt, prev.lastGoodAt);
  assert.equal(out.attemptedAt, T('2026-11-22T13:07:00Z'));

  const txt = refreshStatusText(out);
  assert.match(txt, /Refresh failed/i);
  assert.match(txt, /last good published data/i);
});

test('successful fetch replaces data and clears the failure', () => {
  const oldSig = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z' }),
  ]);
  const newSig = sig('2026-11-22T13:06:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T13:00:00Z' }),
  ]);
  const out = applyFetchResult(
    { sig: oldSig, lastGoodAt: T('2026-11-22T12:06:00Z') },
    { ok: true, data: newSig },
    T('2026-11-22T13:07:00Z'),
  );
  assert.equal(out.sig, newSig);
  assert.equal(out.failed, false);
  assert.equal(out.lastGoodAt, T('2026-11-22T13:07:00Z'));
  assert.match(refreshStatusText(out), /Refreshed/i);
});

test('a malformed successful response is treated as a failure, not as empty data', () => {
  const good = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z' }),
  ]);
  const out = applyFetchResult(
    { sig: good, lastGoodAt: T('2026-11-22T12:06:00Z') },
    { ok: true, data: { updatedAt: '2026-11-22T13:06:00Z', coins: [] } },
    T('2026-11-22T13:07:00Z'),
  );
  assert.equal(out.sig, good);
  assert.equal(out.failed, true);
});

// ---------------------------------------------------------------------------
// 6. Awaiting publication is distinct from delayed
// ---------------------------------------------------------------------------
test('awaiting publication is its own state and never called current', () => {
  const now = T('2026-11-22T12:05:00Z');
  const s = sig('2026-11-22T08:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T04:00:00Z', asOf1h: '2026-11-22T11:00:00Z' }),
  ]);
  const f = feedStateAt(s, now);
  assert.equal(f.state, 'AWAITING');
  const c = classify4h(f.coins[0].fourH, s.coins[0].setup4h);
  assert.equal(c.kind, 'awaiting');
  assert.equal(c.current, false);
  assert.equal(c.chip, 'Awaiting publication');
});

// ---------------------------------------------------------------------------
// 7. Data unavailable is distinct from "no breakout"
// ---------------------------------------------------------------------------
test('missing, future and malformed timestamps are UNAVAILABLE', () => {
  assert.equal(candleFreshness(NaN, MS_4H, T('2026-11-22T13:07:00Z')).status, 'UNAVAILABLE');

  // A published bar that has not closed yet is invalid, not current.
  const future = candleFreshness(T('2026-11-22T12:00:00Z'), MS_4H, T('2026-11-22T13:07:00Z'));
  assert.equal(future.status, 'UNAVAILABLE');
  assert.match(future.reason, /future/i);

  // Misaligned open is rejected.
  const misaligned = candleFreshness(T('2026-11-22T07:30:00Z'), MS_4H, T('2026-11-22T13:07:00Z'));
  assert.equal(misaligned.status, 'UNAVAILABLE');

  const empty = feedStateAt({ updatedAt: '2026-11-22T13:00:00Z', coins: [] }, T('2026-11-22T13:07:00Z'));
  assert.equal(empty.state, 'UNAVAILABLE');

  const noTs = feedStateAt(
    sig('2026-11-22T13:00:00Z', [coin('BTC', { asOf4h: undefined, asOf1h: '2026-11-22T12:00:00Z' })]),
    T('2026-11-22T13:07:00Z'),
  );
  assert.equal(noTs.state, 'UNAVAILABLE');
});

// ---------------------------------------------------------------------------
// 8. Per-coin 1H and 4H are independent; a 1H warning never drives the decision
// ---------------------------------------------------------------------------
test('per-coin 1H and 4H closes are reported separately', () => {
  const now = T('2026-11-22T13:07:00Z');
  const s = sig('2026-11-22T12:05:00Z', [
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T12:00:00Z' }),
    coin('ETH', { asOf4h: '2026-11-22T04:00:00Z', asOf1h: '2026-11-22T12:00:00Z' }),
  ]);
  const f = feedStateAt(s, now);
  const btc = f.coins.find((c) => c.sym === 'BTC');
  const eth = f.coins.find((c) => c.sym === 'ETH');

  assert.equal(btc.fourH.publishedCloseMs, T('2026-11-22T12:00:00Z'));
  assert.equal(eth.fourH.publishedCloseMs, T('2026-11-22T08:00:00Z'));
  assert.equal(btc.oneH.publishedCloseMs, T('2026-11-22T13:00:00Z'));
  assert.equal(eth.oneH.publishedCloseMs, T('2026-11-22T13:00:00Z'));

  assert.equal(btc.state, 'CURRENT');
  assert.equal(eth.state, 'DELAYED');
  assert.equal(f.state, 'DELAYED');
});

test('a delayed 1H warning does not make a current 4H decision stale', () => {
  const now = T('2026-11-22T13:07:00Z');
  const s = sig('2026-11-22T12:05:00Z', [
    // 4H current (closed 12:00); 1H published only through 11:00 (closed 11:00),
    // so the 1H warning is delayed while the 4H decision is current.
    coin('BTC', { asOf4h: '2026-11-22T08:00:00Z', asOf1h: '2026-11-22T10:00:00Z' }),
  ]);
  const f = feedStateAt(s, now);
  assert.equal(f.coins[0].state, 'CURRENT');
  assert.equal(f.coins[0].fourH.status, 'CURRENT');
  assert.equal(f.coins[0].oneH.status, 'DELAYED');
  assert.equal(f.coins[0].oneH.missingBars, 2);
});

// ---------------------------------------------------------------------------
// 9. Refresh scheduling guard
// ---------------------------------------------------------------------------
test('refresh only starts when the tab is visible and no request is in flight', () => {
  assert.equal(shouldStartRefresh({ visible: true, refreshing: false }), true);
  assert.equal(shouldStartRefresh({ visible: false, refreshing: false }), false);
  assert.equal(shouldStartRefresh({ visible: true, refreshing: true }), false);
  assert.equal(shouldStartRefresh(null), false);
});

// ---------------------------------------------------------------------------
// 10. Expected close comes from the UTC clock, not the snapshot
// ---------------------------------------------------------------------------
test('expected close is floored from the current UTC clock', () => {
  assert.equal(expectedCloseAt(T('2026-11-22T13:07:00Z'), MS_4H), T('2026-11-22T12:00:00Z'));
  assert.equal(expectedCloseAt(T('2026-11-22T13:07:00Z'), MS_1H), T('2026-11-22T13:00:00Z'));
  assert.equal(expectedCloseAt(T('2026-11-22T16:00:00Z'), MS_4H), T('2026-11-22T16:00:00Z'));
});

// ---------------------------------------------------------------------------
// 11. The page actually wires the refresh loop and the review element
// ---------------------------------------------------------------------------
test('page wires the review refresh element and 60 s loop', () => {
  assert.match(html, /id="reviewRefresh"/);
  assert.match(html, /setInterval\(refreshPublished, 60000\)/);
  assert.match(html, /addEventListener\('visibilitychange'/);
  assert.match(html, /cache: 'no-store'/);
  assert.ok(!/state === 'STALE'/.test(html), 'old STALE decision state must be gone');
});
