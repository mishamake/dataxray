import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleLlmNarrationInput } from '../core/llm.mjs';

test('narration input carries only deterministic signals, no verdict authority', () => {
  const payload = assembleLlmNarrationInput({
    status: 'bad',
    fill: { value: '99.1%', note: 'healthy', state: 'good' },
    freshness: { value: '3h ago', note: 'on time', state: 'good' },
    distribution: { value: 'μ 118', note: 'shifted', state: 'bad' },
    volumeDrift: { value: '+0.5%', note: 'ok', state: 'good' },
    drift: { drifted: true, currentFingerprint: 'sha256:abcd' },
    tests: [{ pass: true }, { pass: false }],
  });

  assert.equal(payload.authority, 'none');
  assert.equal(payload.signals.fill.value, '99.1%');
  assert.equal(payload.signals.drift.drifted, true);
  assert.equal(payload.signals.tests.total, 2);
  assert.equal(payload.signals.tests.failing, 1);
  // The instruction forbids introducing an unsupported conclusion.
  assert.match(payload.instruction, /do not decide trust/i);
});

test('the assembled payload has no field that could set a status', () => {
  const payload = assembleLlmNarrationInput({ status: 'ok', fill: { value: '100%', state: 'good' } });
  // It reflects the ALREADY-derived status as context, but exposes no verdict knob.
  assert.equal(payload.signals.status, 'ok');
  assert.equal(payload.authority, 'none');
  assert.ok(!('setStatus' in payload));
  assert.ok(!('verdict' in payload));
});

test('handles missing signals gracefully (null, never fabricated)', () => {
  const payload = assembleLlmNarrationInput({});
  assert.equal(payload.signals.fill, null);
  assert.equal(payload.signals.drift, null);
  assert.equal(payload.signals.tests, null);
});
