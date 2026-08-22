import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealth } from '../core/health.mjs';

const CFG = {
  fillThresholds: { good: 0.95, warn: 0.9 },
  volumeDriftBand: { good: 0.05, warn: 0.15 },
  distributionZ: { warn: 2, bad: 3 },
  slaHours: 24,
};
const NOW = 1_700_000_000_000;
const HOUR = 3600_000;

test('fill rate = nonNull / total, good above threshold', () => {
  const h = computeHealth({ totalRows: 42362, nonNullRows: 42110 }, CFG, { now: NOW });
  assert.equal(h.fill.value, '99.4%');
  assert.equal(h.fill.state, 'good');
});

test('fill rate below warn threshold is bad', () => {
  const h = computeHealth({ totalRows: 1250, nonNullRows: 1100 }, CFG, { now: NOW });
  assert.equal(h.fill.state, 'bad'); // 0.88 < 0.90
});

test('freshness within SLA is good', () => {
  const h = computeHealth({ lastLoadedAt: NOW - 2 * HOUR }, CFG, { now: NOW });
  assert.equal(h.freshness.state, 'good');
  assert.equal(h.freshness.breached, false);
});

test('freshness beyond SLA is breached (bad)', () => {
  const h = computeHealth({ lastLoadedAt: NOW - 9 * 24 * HOUR }, CFG, { now: NOW });
  assert.equal(h.freshness.state, 'bad');
  assert.equal(h.freshness.breached, true);
  assert.match(h.freshness.note, /BREACHED/);
});

test('no SLA configured => freshness unavailable, never green', () => {
  const h = computeHealth({ lastLoadedAt: NOW }, { ...CFG, slaHours: undefined }, { now: NOW });
  assert.equal(h.freshness.state, 'unavailable');
  assert.notEqual(h.freshness.state, 'good');
});

test('distribution z >= bad band => bad', () => {
  const h = computeHealth({ mu: 118, sigma: 3, baselineMu: 109, baselineSigma: 3 }, CFG, { now: NOW });
  assert.equal(h.distribution.state, 'bad'); // z = 3
});

test('distribution within band => good', () => {
  const h = computeHealth({ mu: 184000, sigma: 61000, baselineMu: 180000, baselineSigma: 61000 }, CFG, { now: NOW });
  assert.equal(h.distribution.state, 'good');
});

test('not profiled (mu null) => distribution unavailable', () => {
  const h = computeHealth({ mu: null }, CFG, { now: NOW });
  assert.equal(h.distribution.state, 'unavailable');
});

test('volume drift within band good, outside bad', () => {
  const good = computeHealth({ rowCount: 42362, baselineRowCount: 42235 }, CFG, { now: NOW });
  assert.equal(good.volumeDrift.state, 'good');
  const bad = computeHealth({ rowCount: 60000, baselineRowCount: 42235 }, CFG, { now: NOW });
  assert.equal(bad.volumeDrift.state, 'bad');
});

test('no baseline => volume drift unavailable (not green)', () => {
  const h = computeHealth({ rowCount: 1250, baselineRowCount: null }, CFG, { now: NOW });
  assert.equal(h.volumeDrift.state, 'unavailable');
});
