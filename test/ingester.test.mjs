// test/ingester.test.mjs
// US-7: Dana points the ingester at manifest.json and gets idempotent
// definition nodes — currentFingerprint + ingestedAt in the CURRENT version
// only; never an approved fingerprint, never an approved status, never a
// moved baseline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockNestClient } from '../provider/mock-nest-client.mjs';
import { parseManifest, ingestManifest } from '../provider/ingester.mjs';
import { fingerprintSql } from '../core/index.mjs';
import { dbtManifestBaseline, dbtManifestCurrent } from '../fixtures/dbt-manifest.mjs';

const T0 = '2026-08-11T06:00:00Z';
const T1 = '2026-08-20T06:00:00Z';
const T0_ISO = new Date(T0).toISOString();
const T1_ISO = new Date(T1).toISOString();

test('parseManifest extracts only models carrying meta.metricId, with load-bearing fields', () => {
  const metrics = parseManifest(dbtManifestCurrent);
  const ids = metrics.map((m) => m.metricId).sort();
  assert.deepEqual(ids, ['closed_won', 'mktg_pipeline', 'new_logo_arr', 'nrr', 'qualified_pipeline', 'win_rate']);
  const nrr = metrics.find((m) => m.metricId === 'nrr');
  assert.equal(nrr.owner, 'Priya Raghavan');
  assert.equal(nrr.ownerHandle, '@priya');
  assert.ok(nrr.compiledSql.includes('is_churn'));
  assert.ok(nrr.humanDefinition.length > 0);
  assert.match(nrr.dbtModelRef, /fct_net_revenue_retention$/);
});

test('parseManifest ignores non-model nodes and models without meta.metricId', () => {
  const m = parseManifest({
    nodes: {
      'model.proj.plain': { resource_type: 'model', name: 'plain', compiled_sql: 'select 1', meta: {} },
      'test.proj.t': { resource_type: 'test', name: 't', meta: { metricId: 'x' } },
      'model.proj.nosql': { resource_type: 'model', name: 'nosql', meta: { metricId: 'y' } },
    },
  });
  assert.equal(m.length, 0);
});

test('ingest creates definition nodes with currentFingerprint + ingestedAt, all draft, none approved', async () => {
  const c = createMockNestClient();
  const res = await ingestManifest(c, dbtManifestBaseline, { now: T0 });
  assert.equal(res.created.length, 6);
  assert.equal(res.updated.length, 0);

  const defs = await c.listNodes({ type: 'definition' });
  assert.equal(defs.nodes.length, 6);
  for (const n of defs.nodes) {
    assert.equal(n.status, 'draft', 'ingester must never create approved nodes');
    assert.equal(n.approvedVersion, null, 'ingester must never author a baseline');
    assert.equal(n.frontmatter.ingestedAt, T0_ISO);
    assert.match(n.frontmatter.currentFingerprint, /^sha256:/);
    assert.equal(n.frontmatter.approvedFingerprint, undefined, 'no approved fingerprint field may exist');
  }
  // fingerprint equals the core fingerprint of the compiled SQL — same routine end-to-end
  const nrr = defs.nodes.find((n) => n.frontmatter.metricId === 'nrr');
  assert.equal(nrr.frontmatter.currentFingerprint, res.fingerprints.nrr);
});

test('re-ingest of unchanged SQL: no duplicate node, fingerprint unchanged, ingestedAt refreshed', async () => {
  const c = createMockNestClient();
  await ingestManifest(c, dbtManifestBaseline, { now: T0 });
  const second = await ingestManifest(c, dbtManifestBaseline, { now: T1 });

  assert.equal(second.created.length, 0);
  assert.equal(second.updated.length, 6);
  const defs = await c.listNodes({ type: 'definition' });
  assert.equal(defs.nodes.length, 6, 'no duplicate nodes');
  const nrr = defs.nodes.find((n) => n.frontmatter.metricId === 'nrr');
  assert.equal(nrr.frontmatter.currentFingerprint, fingerprintSql(nrr.frontmatter.compiledSql));
  assert.equal(nrr.frontmatter.ingestedAt, T1_ISO, 'heartbeat refreshed');
});

test('the ingester NEVER moves the approved baseline when SQL changes under it', async () => {
  const c = createMockNestClient();
  await ingestManifest(c, dbtManifestBaseline, { now: T0 });
  const defs0 = await c.listNodes({ type: 'definition' });
  const nrr0 = defs0.nodes.find((n) => n.frontmatter.metricId === 'nrr');

  // a HUMAN approves v1 — the only legitimate way a baseline appears
  await c.approve(nrr0.id, { actor: 'Priya Raghavan', actorHandle: '@priya' });
  const fpBlessed = (await c.getNode(nrr0.id, { version: 1 })).frontmatter.currentFingerprint;

  // the drifted deploy lands; the ingester runs again
  await ingestManifest(c, dbtManifestCurrent, { now: T1 });
  const v = await c.getVersions(nrr0.id);
  assert.equal(v.currentVersion, 2);
  assert.equal(v.approvedVersion, 1, 'baseline must not move on ingest');

  const fpCurrent = (await c.getNode(nrr0.id, { version: 2 })).frontmatter.currentFingerprint;
  assert.notEqual(fpCurrent, fpBlessed, 'drift is now visible as two different fingerprints');
});

test('fingerprints are deterministic across runs (same SQL => same sha256)', async () => {
  const a = createMockNestClient();
  const b = createMockNestClient();
  const ra = await ingestManifest(a, dbtManifestCurrent, { now: T0 });
  const rb = await ingestManifest(b, dbtManifestCurrent, { now: T0 });
  assert.deepEqual(ra.fingerprints, rb.fingerprints);
});
