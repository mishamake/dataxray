import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provider } from '../provider/provider.mjs';
import { createClient } from '../widget/client.mjs';

const NOW = 1_700_000_000_000;
const opts = { now: NOW };

test('scenario statuses match the six required demo cases', async () => {
  assert.equal((await provider.getHealth('qualified_pipeline', opts)).status, 'ok');
  assert.equal((await provider.getHealth('nrr', opts)).status, 'bad');
  assert.equal((await provider.getHealth('new_logo_arr', opts)).status, 'bad');
  assert.equal((await provider.getHealth('mktg_pipeline', opts)).status, 'warn');
  assert.equal((await provider.getHealth('win_rate', opts)).status, 'ok');
  assert.equal((await provider.getHealth('not_a_metric', opts)).status, 'unknown');
});

test('nrr is drifted with a receipt and mismatched fingerprints', async () => {
  const h = await provider.getHealth('nrr', opts);
  assert.equal(h.flavor, 'drift');
  assert.equal(h.drift.drifted, true);
  assert.notEqual(h.drift.currentFingerprint, h.drift.approvedFingerprint);

  const p = await provider.getProvenance('nrr', opts);
  assert.ok(p.driftReceipt, 'expected a drift receipt');
  assert.ok(p.driftReceipt.diff.length > 0);
  assert.match(p.driftReceipt.approvedFingerprint, /^sha256:/);
  assert.equal(p.driftReceipt.commit, 'a7f3c9e');
  assert.match(p.driftReceipt.pr, /#812/);
});

test('certified metric has no receipt and reports matches-live-sql', async () => {
  const p = await provider.getProvenance('qualified_pipeline', opts);
  assert.equal(p.driftReceipt, null);
  assert.equal(p.definition.matchesLiveSql, true);
  assert.equal(p.definition.governedSource, 'metric.qualified_pipeline');
  assert.equal(p.definition.approvalStatus, 'approved');
});

test('unapproved metric renders real metric.<id>, no governed def, points to alternative', async () => {
  const p = await provider.getProvenance('new_logo_arr', opts);
  assert.equal(p.governed, false);
  assert.equal(p.definition.governed, null);
  assert.equal(p.definition.governedSource, 'metric.new_logo_arr'); // never blank metric.
  assert.equal(p.definition.approvalStatus, 'ungoverned');
  assert.ok(p.related.some((r) => /new_business_arr/.test(r.name)));
});

test('composite win_rate is worst-of over two named certified inputs', async () => {
  const h = await provider.getHealth('win_rate', opts);
  assert.ok(h.composite, 'expected composite block');
  assert.equal(h.composite.inputs.length, 2);
  assert.equal(h.composite.worstOf, 'ok');
});

test('stats endpoint returns profiling with derived lastLoadedAt (no creds, id-only)', async () => {
  const s = await provider.getStats('qualified_pipeline', opts);
  assert.equal(s.fillRate.totalRows, 42362);
  assert.equal(s.lastLoadedAt, NOW - 42 * 60 * 1000);
});

test('LLM narration is present but carries no verdict authority', async () => {
  const h = await provider.getHealth('nrr', opts);
  assert.ok(h.narration.text && h.narration.text.length > 0);
  assert.equal(h.narration.authority, 'none');
  assert.equal(h.narration.input.authority, 'none');
  // status was 'bad' from the fingerprint, independent of any narration text
  assert.equal(h.status, 'bad');
});

test('provenance-of-the-provenance is exposed', async () => {
  const p = await provider.getProvenance('qualified_pipeline', opts);
  assert.ok(p.provenanceAsOf, 'expected a manifest run time');
});

test('DETERMINISM: repeated health calls yield identical fingerprints/status', async () => {
  const a = await provider.getHealth('nrr', opts);
  const b = await provider.getHealth('nrr', opts);
  assert.equal(a.status, b.status);
  assert.equal(a.drift.currentFingerprint, b.drift.currentFingerprint);
  assert.equal(a.drift.approvedFingerprint, b.drift.approvedFingerprint);
});

test('client models a loud provider-unavailable state, distinct from unmapped', async () => {
  const client = createClient(provider);
  assert.equal(client.isOutage(), false);
  const ok = await client.health('qualified_pipeline', opts);
  assert.equal(ok.status, 'ok');

  client.setOutage(true);
  const down = await client.health('qualified_pipeline', opts);
  assert.equal(down.unavailable, true);
  assert.equal(down.status, 'unavailable');
  assert.notEqual(down.status, 'unknown'); // never silently unmapped
});

test('unmapped id (no metric) is unknown, not fabricated', async () => {
  const client = createClient(provider);
  const h = await client.health(null, opts);
  assert.equal(h.status, 'unknown');
});
