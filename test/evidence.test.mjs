// Metric evidence rules (0.3.0): canonical definition fingerprints, freshness,
// governance application and the single presentation status.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  stableJson, definitionFingerprint, fingerprintSql, isEvidenceFresh, isEvidenceAvailable,
  isVerifiableEvidence, governedEvidence, evidenceStatus, EMPTY_GOVERNANCE, DEFAULT_EVIDENCE_MAX_AGE_MS,
} from '../core/index.mjs';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const base = (over = {}) => ({
  id: 'demo.bookings', title: 'Bookings', definition: 'Closed won amount', status: 'live', value: 42,
  format: 'currency', fingerprint: 'sha256:aa', approvedFingerprint: null, retrievedAt: new Date(NOW - 1000).toISOString(),
  period: 'MTD', sources: [], checks: [], caveats: [], ...over,
});
const approved = (fingerprint = 'sha256:aa') => ({ revision: 1, approval: { by: 'A. Steward', at: '2026-09-01T00:00:00Z', fingerprint }, review: null });

test('stableJson sorts keys, drops undefined, preserves array order and case', () => {
  assert.equal(stableJson({ b: 1, a: [3, 1, 2], c: undefined, D: 'X' }), '{"a":[3,1,2],"b":1,"D":"X"}');
  assert.equal(stableJson(null), 'null');
  assert.equal(stableJson(undefined), 'null');
});

test('definitionFingerprint matches the reference node:crypto implementation byte for byte', () => {
  // Upgrade safety: hosts that fingerprinted report JSON with node:crypto must get
  // identical hashes, or every existing approval would read as drifted.
  const report = { query: { filters: [{ field: 'Stage', value: 'Won' }], measures: ['sum:amount'], Name: 'Café ✓' }, _x: 1, a_b: 2, aB: 3 };
  const reference = 'sha256:' + createHash('sha256').update(stableJson(report)).digest('hex');
  assert.equal(definitionFingerprint(report), reference);
});

test('definitionFingerprint(sql) uses the ingest SQL path', () => {
  assert.equal(definitionFingerprint('select 1', 'sql'), fingerprintSql('select 1'));
});

test('freshness: zero value is available; missing, invalid, future and old timestamps are not fresh', () => {
  assert.equal(isEvidenceAvailable({ status: 'live', value: 0 }), true);
  assert.equal(isEvidenceAvailable({ status: 'live', value: null }), false);
  assert.equal(isEvidenceAvailable({ status: 'live', value: NaN }), false);
  assert.equal(isEvidenceFresh({ retrievedAt: null }, NOW), false);
  assert.equal(isEvidenceFresh({ retrievedAt: 'nope' }, NOW), false);
  assert.equal(isEvidenceFresh({ retrievedAt: new Date(NOW + 1000).toISOString() }, NOW), false);
  assert.equal(isEvidenceFresh({ retrievedAt: new Date(NOW - DEFAULT_EVIDENCE_MAX_AGE_MS - 1).toISOString() }, NOW), false);
  assert.equal(isEvidenceFresh({ retrievedAt: new Date(NOW - 60_000).toISOString() }, NOW, 120_000), true);
});

test('isVerifiableEvidence requires a fingerprint, a live value and fresh evidence', () => {
  assert.equal(isVerifiableEvidence(base(), NOW), true);
  assert.equal(isVerifiableEvidence(base({ fingerprint: null }), NOW), false);
  assert.equal(isVerifiableEvidence(null, NOW), false);
});

test('governedEvidence applies approval without changing the value', () => {
  const g = governedEvidence(base(), approved(), { now: NOW });
  assert.equal(g.verdict, 'certified');
  assert.equal(g.value, 42);
  assert.equal(g.approvedFingerprint, 'sha256:aa');
  assert.equal(governedEvidence(base(), approved('sha256:bb'), { now: NOW }).verdict, 'drifted');
  assert.equal(governedEvidence(base(), EMPTY_GOVERNANCE, { now: NOW }).verdict, 'uncertified');
  assert.equal(governedEvidence(base(), { ...approved(), review: { by: 'a', at: 'x', reviewer: 'b', fingerprint: 'sha256:aa' } }, { now: NOW }).verdict, 'pending');
});

test('governedEvidence fails loud when the governance store is unavailable', () => {
  const g = governedEvidence(base(), approved(), { now: NOW, available: false });
  assert.equal(g.verdict, 'stale');
  assert.equal(g.approvedFingerprint, null);
});

test('evidenceStatus: failed checks outrank an approved definition', () => {
  const e = { ...governedEvidence(base(), approved(), { now: NOW }), checks: [{ label: 'Sum', status: 'fail', detail: '' }] };
  assert.deepEqual(evidenceStatus(e), { label: 'Failed data checks', tone: 'red' });
});

test('evidenceStatus covers every presentation state', () => {
  const s = (over) => evidenceStatus({ ...base({ verdict: 'certified' }), ...over });
  assert.equal(s({ status: 'unavailable', unavailableReason: 'definition', value: null }).label, 'Definition needed');
  assert.equal(s({ status: 'unavailable', unavailableReason: 'source', value: null }).tone, 'neutral');
  assert.equal(s({ status: 'unavailable', value: null }).label, 'Data unavailable');
  assert.equal(s({ governanceStatus: 'loading' }).tone, 'yellow');
  assert.equal(s({ governanceStatus: 'unavailable' }).tone, 'red');
  assert.equal(s({ verdict: 'stale' }).tone, 'red');
  assert.equal(s({ verdict: 'drifted' }).label, 'Definition changed—needs approval');
  assert.equal(s({ verdict: 'uncertified' }).label, 'Awaiting approval');
  assert.equal(s({ verdict: 'pending' }).label, 'In review');
  assert.equal(s({ checks: [{ label: 'x', status: 'warn', detail: '' }] }).label, 'Checks need review');
  assert.deepEqual(s({}), { label: 'Certified and current', tone: 'green' });
});
