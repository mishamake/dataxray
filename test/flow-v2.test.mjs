// test/flow-v2.test.mjs
// The end-to-end v2 loops against MockNestClient (US-3, US-4, US-5):
// Marcus asks, Priya answers in-thread and resolves; flag-to-owner routes
// through a review (the only notifying path); the drifted NRR goes
// propose -> review -> approve and the drift CLEARS to Certified & current.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockNestClient } from '../provider/mock-nest-client.mjs';
import { createGovernance } from '../provider/governance.mjs';
import { seedNest, DEMO_PERSONAS } from '../fixtures/seed-nest.mjs';
import { VERDICT } from '../core/index.mjs';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const { marcus, priya } = DEMO_PERSONAS;

async function seeded() {
  const client = createMockNestClient();
  await seedNest(client, { now: NOW });
  const governance = createGovernance({ client });
  return { client, governance };
}

test('US-5: drifted NRR, propose, approve, baseline re-pins, drift clears to Certified', async () => {
  const { client, governance } = await seeded();

  const before = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(before.verdict, VERDICT.DRIFTED);
  assert.equal(before.nodeStatus, 'approved'); // approved at v1, drifted since

  // Marcus requests re-approval from the widget.
  const proposed = await governance.propose('nrr', { author: marcus.name, authorHandle: marcus.handle });
  assert.equal(proposed.notified, true);
  const note = client.notifications().at(-1);
  assert.equal(note.kind, 'review_request');
  assert.deepEqual(note.notified, [priya.handle], 'the owner is pinged via the watcher path');

  const inReview = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(inReview.nodeStatus, 'pending_review');
  assert.equal(inReview.verdict, VERDICT.DRIFTED, 'stays drifted while re-approval is pending');
  assert.equal(inReview.verdictLabel, 'Drifted · re-approval in review');
  assert.equal(inReview.receipt.approvedVersion, 1, 'proposing must not move the baseline');
  assert.equal(inReview.review.submittedBy, marcus.name);

  // Priya (the owner) approves — THE human-only baseline move.
  await governance.approve('nrr', { author: priya.name, authorHandle: priya.handle });

  const after = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(after.nodeStatus, 'approved');
  assert.equal(after.receipt.approvedVersion, 2, 'approvedVersion moved to the reviewed version');
  assert.equal(after.receipt.fpApproved, after.receipt.fpCurrent, 'fpApproved re-read from the new baseline');
  assert.equal(after.verdict, VERDICT.CERTIFIED, 'the drift CLEARS');
  assert.equal(after.verdictLabel, 'Certified & current');
  assert.equal(after.receipt.blessedBy, priya.name);
});

test('US-5: reject blesses nothing — baseline unchanged, drift persists', async () => {
  const { governance } = await seeded();
  await governance.propose('nrr', { author: marcus.name, authorHandle: marcus.handle });
  await governance.reject('nrr', { author: priya.name, authorHandle: priya.handle });

  const g = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g.nodeStatus, 'approved', 'status returns to the last blessed state');
  assert.equal(g.receipt.approvedVersion, 1, 'approvedVersion unchanged by rejection');
  assert.equal(g.verdict, VERDICT.DRIFTED, 'rejection does not clear drift');
  assert.equal(g.review, null);
});

test('US-3: a bare comment does NOT notify anyone', async () => {
  const { client, governance } = await seeded();
  const before = client.notifications().length;
  const res = await governance.postComment('nrr', {
    body: 'is this fixed yet?',
    author: marcus.name,
    authorHandle: marcus.handle,
  });
  assert.equal(res.notified, false);
  assert.equal(res.reviewOpened, false);
  assert.equal(client.notifications().length, before, 'comment-create fires no notification');
});

test('US-3: flag-to-owner opens a review — the only path that pings', async () => {
  const { client, governance } = await seeded();
  const res = await governance.postComment('nrr', {
    body: 'this needs a decision before the board deck ships',
    flagToOwner: true,
    author: marcus.name,
    authorHandle: marcus.handle,
  });
  assert.equal(res.notified, true);
  assert.equal(res.reviewOpened, true);
  const note = client.notifications().at(-1);
  assert.equal(note.kind, 'review_request');
  assert.deepEqual(note.notified, [priya.handle]);

  const g = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g.nodeStatus, 'pending_review', 'the flag attached a review to the node');
});

test('US-3: flag-to-owner while already in review attaches, no duplicate review', async () => {
  const { client, governance } = await seeded();
  await governance.propose('nrr', { author: marcus.name, authorHandle: marcus.handle });
  const count = client.notifications().length;
  const res = await governance.postComment('nrr', {
    body: 'adding context to the open review',
    flagToOwner: true,
    author: marcus.name,
    authorHandle: marcus.handle,
  });
  assert.equal(res.notified, true);
  assert.equal(res.reviewOpened, false, 'review already open — attach, do not duplicate');
  assert.equal(client.notifications().length, count);
});

test('US-4: Priya replies nested under Marcus and resolves the thread', async () => {
  const { governance } = await seeded();
  const g0 = await governance.getGovernance('nrr', { now: NOW });
  const question = g0.comments[0];

  const { comment: reply } = await governance.postComment('nrr', {
    body: 'confirmed — reconciling the model today',
    parentId: question.id,
    author: priya.name,
    authorHandle: priya.handle,
  });
  assert.equal(reply.parentId, question.id);

  await governance.resolveComment('nrr', question.id);
  const g1 = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g1.comments[0].resolved, true);
  assert.equal(g1.openCommentCount, 0);
  assert.equal(g1.comments[0].replies.length, 2, 'the new reply threaded under the parent');
  // resolving a comment never moves governance
  assert.equal(g1.receipt.approvedVersion, g0.receipt.approvedVersion);
  assert.equal(g1.nodeStatus, g0.nodeStatus);
});

test('intents on an unmapped metric fail loudly, never fabricate a node', async () => {
  const { governance } = await seeded();
  await assert.rejects(
    () => governance.postComment('cac_payback', { body: 'x', author: marcus.name }),
    (e) => e.status === 404
  );
  await assert.rejects(() => governance.propose('cac_payback', { author: marcus.name }), (e) => e.status === 404);
});
