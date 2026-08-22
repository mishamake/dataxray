import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStatus, badFlavor, worstOf, rollupComposite } from '../core/verdict.mjs';

const OK_DRIFT = { drifted: false, hasApprovedFingerprint: true };
const PASS = [{ pass: true }];

test('certified: governed + approved + matching + fresh + tests pass => ok', () => {
  const s = deriveStatus({ mapped: true, governed: true, approved: true, driftResult: OK_DRIFT, tests: PASS, freshness: { breached: false } });
  assert.equal(s, 'ok');
});

test('drift => bad (drift flavor)', () => {
  const p = { mapped: true, governed: true, approved: true, driftResult: { drifted: true, hasApprovedFingerprint: true }, tests: PASS, freshness: { breached: false } };
  assert.equal(deriveStatus(p), 'bad');
  assert.equal(badFlavor(p), 'drift');
});

test('no governed definition => bad (unapproved flavor)', () => {
  const p = { mapped: true, governed: false, approved: false, driftResult: { drifted: false, hasApprovedFingerprint: false }, tests: [], freshness: {} };
  assert.equal(deriveStatus(p), 'bad');
  assert.equal(badFlavor(p), 'unapproved');
});

test('governed but not approved in config => bad (unapproved flavor)', () => {
  const p = { mapped: true, governed: true, approved: false, driftResult: OK_DRIFT, tests: PASS, freshness: {} };
  assert.equal(deriveStatus(p), 'bad');
  assert.equal(badFlavor(p), 'unapproved');
});

test('governed + approved but missing approved fingerprint => bad (unapproved)', () => {
  const p = { mapped: true, governed: true, approved: true, driftResult: { drifted: false, hasApprovedFingerprint: false }, tests: PASS, freshness: {} };
  assert.equal(deriveStatus(p), 'bad');
  assert.equal(badFlavor(p), 'unapproved');
});

test('stale-but-correct: matches + tests pass + freshness breached => warn', () => {
  const s = deriveStatus({ mapped: true, governed: true, approved: true, driftResult: OK_DRIFT, tests: PASS, freshness: { breached: true } });
  assert.equal(s, 'warn');
});

test('unmapped => unknown', () => {
  assert.equal(deriveStatus({ mapped: false }), 'unknown');
});

test('worst-of gate: a good fill can never dilute a drift flag', () => {
  // drift (bad) + everything else fine -> still bad, no averaging
  const s = deriveStatus({ mapped: true, governed: true, approved: true, driftResult: { drifted: true, hasApprovedFingerprint: true }, tests: PASS, freshness: { breached: false } });
  assert.equal(s, 'bad');
});

test('failing dbt test => bad', () => {
  const p = { mapped: true, governed: true, approved: true, driftResult: OK_DRIFT, tests: [{ pass: true }, { pass: false }], freshness: { breached: false } };
  assert.equal(deriveStatus(p), 'bad');
  assert.equal(badFlavor(p), 'test');
});

test('worstOf helper ranks bad > warn > ok', () => {
  assert.equal(worstOf(['ok', 'warn', 'ok']), 'warn');
  assert.equal(worstOf(['ok', 'warn', 'bad']), 'bad');
  assert.equal(worstOf(['ok', 'ok']), 'ok');
});

test('rollupComposite is worst-of over named inputs', () => {
  assert.equal(rollupComposite(['ok', 'ok']), 'ok');
  assert.equal(rollupComposite(['ok', 'bad']), 'bad');
  assert.equal(rollupComposite(['ok', 'warn']), 'warn');
  assert.equal(rollupComposite(['ok', 'unknown']), 'unknown');
});

test('composite where one input drifts => whole tile red', () => {
  const s = deriveStatus({ mapped: true, governed: true, approved: true, driftResult: OK_DRIFT, tests: PASS, freshness: { breached: false }, inputStatuses: ['ok', 'bad'] });
  assert.equal(s, 'bad');
});
