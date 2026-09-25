import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineDashboard, createTargetRegistry, assertPort } from '../contracts/index.mjs';

const src = (component) => ({ file: 'src/dash.tsx', component });
const def = () => ({
  id: 'demo-marketing', title: 'Demo', metrics: ['demo.bookings'],
  targets: {
    'demo.bookings': { label: 'Bookings', kind: 'metric', source: src('Card'), metricId: 'demo.bookings' },
    'demo.funnel': { label: 'Funnel', kind: 'section', source: src('Funnel') },
  },
  aliases: { 'old.bookings': 'demo.bookings' },
  resolveTarget: (_d, id) => (id.endsWith('.domain-total') ? { label: id, kind: 'metric', source: src('Domain') } : null),
});

test('defineDashboard registers targets, aliases and dynamic targets', () => {
  const d = defineDashboard(def());
  assert.equal(d.resolveTarget('demo.bookings').metricId, 'demo.bookings');
  assert.equal(d.resolveTarget('old.bookings').label, 'Bookings');
  assert.equal(d.resolveTarget('example-com.domain-total').source.component, 'Domain');
  assert.equal(d.resolveTarget('missing'), null);
});

test('scopes: unknown dashboards and metrics are rejected', () => {
  const d = defineDashboard(def());
  assert.equal(d.hasScope({ dashboardId: 'demo-marketing' }), true);
  assert.equal(d.hasScope({ dashboardId: 'demo-marketing', metricId: '' }), true);
  assert.equal(d.hasScope({ dashboardId: 'demo-marketing', metricId: 'demo.bookings' }), true);
  assert.equal(d.hasScope({ dashboardId: 'demo-marketing', metricId: 'nope' }), false);
  assert.equal(d.hasScope({ dashboardId: 'other' }), false);
});

test('configuration mistakes fail at definition time', () => {
  assert.throws(() => defineDashboard({ ...def(), id: 'Has Spaces' }));
  assert.throws(() => defineDashboard({ ...def(), metrics: ['a', 'a'] }));
  assert.throws(() => defineDashboard({ ...def(), targets: { t: { label: 'x', kind: 'metric', source: src('C'), metricId: 'unknown' } } }));
  assert.throws(() => defineDashboard({ ...def(), targets: { t: { label: 'x', kind: 'widget', source: src('C') } } }));
});

test('target IDs are permanent: re-registering with a different meaning throws', () => {
  const registry = createTargetRegistry();
  registry.add('d', 'x', { label: 'X', kind: 'metric', source: src('C'), metricId: 'm1' });
  registry.add('d', 'x', { label: 'X renamed', kind: 'metric', source: src('C'), metricId: 'm1' });
  assert.throws(() => registry.add('d', 'x', { label: 'X', kind: 'chart', source: src('C') }));
});

test('resolveContext gives agents current source or explicit unresolved', () => {
  const d = defineDashboard(def());
  assert.deepEqual(d.registry.resolveContext('demo-marketing', { version: 1, targets: [{ id: 'demo.funnel' }, { id: 'gone' }] }), [
    { id: 'demo.funnel', status: 'current', label: 'Funnel', kind: 'section', source: src('Funnel') },
    { id: 'gone', status: 'unresolved' },
  ]);
});

test('assertPort names missing methods', () => {
  assert.throws(() => assertPort('governance', { read() {} }), /missing: approve, revoke/);
  assert.throws(() => assertPort('nope', {}), /Unknown port/);
  const impl = { current: async () => ({}) };
  assert.equal(assertPort('actors', impl), impl);
});
