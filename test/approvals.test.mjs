// Optional approvals: definitions and feedback review, per dashboard and per metric.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApprovals, definitionApprovalRequired, defineDashboard, planStatusChange } from '../contracts/index.mjs';
import { governedEvidence, evidenceStatus, verdictLabel, VERDICT, computeVerdict } from '../core/index.mjs';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ev = (over = {}) => ({
  id: 'demo.visits', title: 'Visits', definition: 'Sessions', status: 'live', value: 10, format: 'number',
  fingerprint: 'sha256:aa', approvedFingerprint: null, retrievedAt: new Date(NOW - 1000).toISOString(),
  period: 'MTD', sources: [], checks: [], caveats: [], ...over,
});

test('defaults keep both approvals on (omitting config never weakens a host)', () => {
  assert.deepEqual({ ...resolveApprovals(undefined) }, { definitions: true, feedback: true, metrics: {}, source: 'host' });
  assert.equal(resolveApprovals(true).definitions, true);
  const off = resolveApprovals(false);
  assert.equal(off.definitions, false);
  assert.equal(off.feedback, false);
});

test('typos and wrong types throw instead of silently disabling approvals', () => {
  assert.throws(() => resolveApprovals({ definition: false }), /Unknown approvals option "definition"/);
  assert.throws(() => resolveApprovals({ definitions: 'no' }));
  assert.throws(() => resolveApprovals({ source: 'db' }));
  assert.throws(() => resolveApprovals({ metrics: { x: 'off' } }));
  assert.throws(() => resolveApprovals('off'));
});

test('per-metric override wins over the dashboard default, both ways', () => {
  const cfg = { definitions: false, metrics: { 'demo.revenue': true } };
  assert.equal(definitionApprovalRequired(cfg, 'demo.revenue'), true);
  assert.equal(definitionApprovalRequired(cfg, 'demo.visits'), false);
  assert.equal(definitionApprovalRequired({ metrics: { 'demo.visits': false } }, 'demo.visits'), false);
  assert.equal(definitionApprovalRequired(resolveApprovals(cfg), 'demo.revenue'), true, 'accepts resolved config');
});

test('approvals off: current data is ungoverned (neutral), never certified', () => {
  const g = governedEvidence(ev(), undefined, { approvals: false, now: NOW });
  assert.equal(g.verdict, VERDICT.UNGOVERNED);
  assert.deepEqual(evidenceStatus(g), { label: 'Current · approval not required', tone: 'neutral' });
  assert.equal(verdictLabel(g.verdict), 'Approval not required');
});

test('approvals off: health rules still apply', () => {
  assert.equal(governedEvidence(ev({ retrievedAt: null }), undefined, { approvals: false, now: NOW }).verdict, 'stale');
  assert.equal(governedEvidence(ev({ status: 'unavailable', value: null }), undefined, { approvals: false, now: NOW }).verdict, 'stale');
  const failed = governedEvidence(ev({ checks: [{ label: 'x', status: 'fail', detail: '' }] }), undefined, { approvals: false, now: NOW });
  assert.equal(evidenceStatus(failed).tone, 'red');
  const warned = governedEvidence(ev({ checks: [{ label: 'x', status: 'warn', detail: '' }] }), undefined, { approvals: false, now: NOW });
  assert.equal(evidenceStatus(warned).tone, 'yellow');
});

test('approvals off ignores a stale stored approval rather than showing it', () => {
  const state = { revision: 1, approval: { by: 'a', at: 'x', fingerprint: 'sha256:aa' }, review: null };
  const g = governedEvidence(ev(), state, { approvals: false, now: NOW });
  assert.equal(g.approvedFingerprint, null);
  assert.equal(g.verdict, 'ungoverned');
});

test('computeVerdict is unchanged and never emits ungoverned', () => {
  assert.equal(computeVerdict({}), 'stale');
});

test('defineDashboard exposes resolved approvals and validates metric overrides', () => {
  const d = defineDashboard({ id: 'demo', title: 'Demo', metrics: ['demo.visits', 'demo.revenue'],
    approvals: { definitions: false, feedback: false, metrics: { 'demo.revenue': true } } });
  assert.equal(d.definitionApprovals('demo.visits'), false);
  assert.equal(d.definitionApprovals('demo.revenue'), true);
  assert.equal(d.feedbackReview, false);
  assert.equal(defineDashboard({ id: 'demo', title: 'Demo', metrics: [] }).feedbackReview, true);
  assert.throws(() => defineDashboard({ id: 'demo', title: 'Demo', metrics: [], approvals: { metrics: { ghost: true } } }), /unregistered metric "ghost"/);
});

const builder = { tenant: 't', oid: 'builder', name: 'B' };
const author = { tenant: 't', oid: 'author', name: 'A' };
const base = { authorId: 'author', isBuilder: (a) => a.oid === 'builder' };

test('feedback review off: builder closes work directly, with an optional note', () => {
  const r = planStatusChange({ ...base, actor: builder, current: 'Open', next: 'Completed', requireReview: false, feedback: 'Fixed in v2' });
  assert.equal(r.ok, true);
  assert.equal(r.event.reviewed, false);
  assert.equal(r.event.feedback, 'Fixed in v2');
  assert.equal(planStatusChange({ ...base, actor: builder, current: 'In Progress', next: 'Completed', requireReview: false }).ok, true);
});

test('feedback review off: non-builders still cannot close, and the review path still works', () => {
  assert.equal(planStatusChange({ ...base, actor: author, current: 'Open', next: 'Completed', requireReview: false }).code, 403);
  assert.equal(planStatusChange({ ...base, actor: builder, current: 'Open', next: 'Needs Review', requireReview: false }).ok, true);
  const approved = planStatusChange({ ...base, actor: author, current: 'Needs Review', next: 'Completed', requireReview: false });
  assert.equal(approved.ok, true);
  assert.equal(approved.event.reviewed, true);
});

test('feedback review on (default): builder cannot skip review', () => {
  assert.equal(planStatusChange({ ...base, actor: builder, current: 'Open', next: 'Completed' }).code, 403);
});
