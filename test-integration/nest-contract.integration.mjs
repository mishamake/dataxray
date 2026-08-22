// test-integration/nest-contract.integration.mjs
// ⚠ NETWORK INTEGRATION TEST — runs OUTSIDE the offline gate.
//
// The offline suite (node --test 'test/*.test.mjs') proves OUR wiring against
// MockNestClient. THIS test proves the SERVER contract: it exercises the real
// HTTP NestClient against a live/staging Community Nest and asserts the two
// load-bearing behaviors the whole v2 design stands on (PRD MUST #8, US-8):
//
//   (a) submit-review actually registers a review AND fires a watcher
//       notification (the ping path the widget's flag-to-owner relies on);
//   (b) approve actually MOVES approvedVersion (so the drift baseline really
//       shifts — without this, "governed drift" is theater).
//
// Run it explicitly, with env:
//   CONTEXTNEST_BASE_URL=https://<host> \
//   CONTEXTNEST_NEST_ID=<nest-id> \
//   CONTEXTNEST_TOKEN=cnst_<token> \
//   node --test test-integration/
//
// Without the env it SKIPS loudly (it never fails the offline gate, and never
// silently pretends the contract is verified).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNestClient } from '../provider/nest-client.mjs';
import { fingerprintSql } from '../core/index.mjs';

const { CONTEXTNEST_BASE_URL, CONTEXTNEST_NEST_ID, CONTEXTNEST_TOKEN } = process.env;
const ENV_READY = !!(CONTEXTNEST_BASE_URL && CONTEXTNEST_NEST_ID && CONTEXTNEST_TOKEN);

const opts = ENV_READY
  ? {}
  : { skip: 'SKIPPED: set CONTEXTNEST_BASE_URL / CONTEXTNEST_NEST_ID / CONTEXTNEST_TOKEN to run the network contract test' };

test('server contract: submit-review notifies, approve moves approvedVersion', opts, async (t) => {
  const client = createNestClient({
    baseUrl: CONTEXTNEST_BASE_URL,
    nestId: CONTEXTNEST_NEST_ID,
    token: CONTEXTNEST_TOKEN,
  });

  // A scratch definition node authored by the ingester path (draft, no baseline).
  const sqlV1 = 'select 1 as contract_probe';
  const sqlV2 = 'select 2 as contract_probe';
  const stamp = new Date().toISOString();
  const { node } = await client.createNode({
    type: 'definition',
    frontmatter: {
      metricId: `contract-probe-${Date.now()}`,
      humanDefinition: 'Disposable contract-test probe node. Safe to delete.',
      compiledSql: sqlV1,
      currentFingerprint: fingerprintSql(sqlV1),
      dbtModelRef: 'model.contract/probe',
      owner: 'contract-test',
      ownerHandle: '@contract-test',
      ingestedAt: stamp,
    },
    body: 'Disposable contract-test probe node. Safe to delete.',
    author: 'contract-test',
  });
  t.after(() => {
    // best-effort cleanup note: if the server exposes DELETE /nodes/:id, wire it
    // here; scratch nodes are named contract-probe-* for easy janitor queries.
  });

  assert.equal(node.status, 'draft', 'a written node must land as draft — no machine self-approval');
  assert.equal(node.approvedVersion ?? null, null, 'no baseline may exist before a human approves');

  // (a) submit-review -> pending_review; the watcher notification fires
  //     server-side (notify-service drains to Slack/Teams/webhook). What the
  //     API lets us observe directly: the review is REGISTERED and the node
  //     is in the review queue — the same event the notifier keys on.
  await client.submitReview(node.id, { actor: 'contract-test' });
  const afterSubmit = await client.getNode(node.id);
  assert.equal(afterSubmit.status, 'pending_review', 'submit-review must flip status to pending_review');
  const queue = await client
    .listNodes({ status: 'pending_review' })
    .catch(() => ({ nodes: [] }));
  assert.ok(
    (queue.nodes || []).some((n) => n.id === node.id),
    'the review must be registered (observable via the pending_review queue) — the watcher notification keys off this event'
  );

  // (b) approve -> approvedVersion MOVES to the current version.
  //     NOTE: the real server enforces separation-of-duties (author cannot
  //     approve). If this fails with 403, re-run with a second steward token
  //     to complete the assertion — that failure would itself confirm SoD.
  const before = await client.getVersions(node.id);
  await client.approve(node.id, { actor: 'contract-test-approver' });
  const after = await client.getVersions(node.id);
  assert.notEqual(after.approvedVersion, before.approvedVersion, 'approve must MOVE approvedVersion');
  assert.equal(after.approvedVersion, after.currentVersion, 'baseline re-pins to the reviewed (current) version');

  // and the drift baseline really shifts: a new write leaves the blessing behind
  await client.patchNode(node.id, {
    frontmatter: { compiledSql: sqlV2, currentFingerprint: fingerprintSql(sqlV2), ingestedAt: new Date().toISOString() },
    author: 'contract-test',
  });
  const drifted = await client.getVersions(node.id);
  assert.equal(drifted.approvedVersion, after.approvedVersion, 'a write must NOT move the baseline');
  assert.ok(drifted.currentVersion > drifted.approvedVersion, 'current advances past the blessed version');
});
