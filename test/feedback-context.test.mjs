import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFeedbackContext, parseFeedbackContext, isBoundedJson, resolveRuntimeEnvironment, MAX_FEEDBACK_CONTEXT_BYTES,
} from '../contracts/index.mjs';

const target = (over = {}) => ({
  id: 'demo.bookings', label: 'Bookings', kind: 'metric', view: { period: 'mtd' }, capturedAt: '2026-09-24T15:00:00-04:00',
  runtime: { appVersion: 'a'.repeat(40), environment: 'production', viewport: { width: 1440, height: 900 } },
  observation: { text: 'Bookings $42', data: { value: 42, rows: [1, 2] } }, ...over,
});
const ctx = (targets = [target()]) => ({ version: 1, targets });

test('accepts a valid v1 snapshot, with or without runtime', () => {
  assert.equal(validateFeedbackContext(ctx()).ok, true);
  const { runtime, ...older } = target();
  assert.equal(validateFeedbackContext(ctx([older])).ok, true);
});

test('rejects unknown versions and unknown fields (strict contract)', () => {
  assert.match(validateFeedbackContext({ ...ctx(), version: 2 }).error, /version/);
  assert.equal(validateFeedbackContext({ ...ctx(), extra: 1 }).ok, false);
  assert.equal(validateFeedbackContext(ctx([{ ...target(), extra: 1 }])).ok, false);
});

test('rejects duplicates, empty and too many targets', () => {
  assert.equal(validateFeedbackContext(ctx([target(), target()])).error, 'Select each component once.');
  assert.equal(validateFeedbackContext(ctx([])).ok, false);
  assert.equal(validateFeedbackContext(ctx(Array.from({ length: 21 }, (_, i) => target({ id: `t${i}` })))).ok, false);
});

test('rejects invalid timestamps, kinds, runtime and view controls', () => {
  assert.equal(validateFeedbackContext(ctx([target({ capturedAt: '2026-09-24T15:00:00' })])).ok, false);
  assert.equal(validateFeedbackContext(ctx([target({ kind: 'widget' })])).ok, false);
  assert.equal(validateFeedbackContext(ctx([target({ runtime: { appVersion: 'ABC', environment: 'production', viewport: { width: 1, height: 1 } } })])).ok, false);
  assert.equal(validateFeedbackContext(ctx([target({ runtime: { appVersion: null, environment: 'moon', viewport: { width: 1, height: 1 } } })])).ok, false);
  assert.equal(validateFeedbackContext(ctx([target({ view: { a: 1 } })])).ok, false);
  const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 'v']));
  assert.equal(validateFeedbackContext(ctx([target({ view: many })])).ok, false);
});

test('bounds snapshot data: depth, non-finite numbers, class instances and total size', () => {
  let deep = {}; const root = deep;
  for (let i = 0; i < 40; i++) deep = deep.x = {};
  assert.equal(isBoundedJson(root), false);
  assert.equal(isBoundedJson({ n: Infinity }), false);
  assert.equal(isBoundedJson({ d: new Date() }), false);
  const big = target({ observation: { text: 'x'.repeat(MAX_FEEDBACK_CONTEXT_BYTES - 10) } });
  assert.match(validateFeedbackContext(ctx([big])).error, /256 KiB/);
});

test('parseFeedbackContext throws with a path', () => {
  assert.throws(() => parseFeedbackContext(ctx([target({ kind: 'nope' })])), (e) => e.path.join('.') === 'targets.0.kind');
});

test('resolveRuntimeEnvironment uses a host-supplied deploy map, then preview/local', () => {
  const deployEnvMap = { 'k8s-prod': 'production', 'k8s-stag': 'staging' };
  assert.equal(resolveRuntimeEnvironment({ deployEnv: 'k8s-prod', deployEnvMap }), 'production');
  assert.equal(resolveRuntimeEnvironment({ deployEnv: 'other', deployEnvMap, vercelEnv: 'preview' }), 'preview');
  assert.equal(resolveRuntimeEnvironment({ nodeEnv: 'development' }), 'local');
  assert.equal(resolveRuntimeEnvironment({ deployEnv: 'toString', deployEnvMap }), 'unknown');
});
