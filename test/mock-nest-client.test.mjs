// test/mock-nest-client.test.mjs
// MockNestClient mirrors the real Community Nest API shapes and governance
// rules: versions append on write, approvedVersion moves ONLY on approve,
// reviews notify, comments don't.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockNestClient } from '../provider/mock-nest-client.mjs';

const FM = {
  metricId: 'nrr',
  humanDefinition: 'NRR = (start + expansion − contraction − churn) / start',
  compiledSql: 'select 1',
  currentFingerprint: 'sha256:one',
  dbtModelRef: 'model.rev.fct_nrr',
  owner: 'Priya Raghavan',
  ownerHandle: '@priya',
  ingestedAt: '2026-08-20T06:00:00Z',
};

test('createNode lands as draft v1 with NO approved baseline (no self-approval)', async () => {
  const c = createMockNestClient();
  const { node } = await c.createNode({ type: 'definition', frontmatter: FM, author: 'ingester' });
  assert.equal(node.status, 'draft');
  assert.equal(node.currentVersion, 1);
  assert.equal(node.approvedVersion, null);
});

test('patchNode appends a current version and NEVER moves approvedVersion', async () => {
  const c = createMockNestClient();
  const { node } = await c.createNode({ type: 'definition', frontmatter: FM, author: 'ingester' });
  await c.approve(node.id, { actor: 'Priya Raghavan', actorHandle: '@priya' });
  const { node: patched } = await c.patchNode(node.id, {
    frontmatter: { currentFingerprint: 'sha256:two' },
    author: 'ingester',
  });
  assert.equal(patched.currentVersion, 2);
  assert.equal(patched.approvedVersion, 1); // baseline untouched by the write
  assert.equal(patched.status, 'approved'); // writes don't flip workflow status
});

test('approve moves approvedVersion to current; reject leaves it unchanged', async () => {
  const c = createMockNestClient();
  const { node } = await c.createNode({ type: 'definition', frontmatter: FM, author: 'ingester' });
  await c.patchNode(node.id, { frontmatter: { currentFingerprint: 'sha256:two' }, author: 'ingester' });
  await c.submitReview(node.id, { actor: 'Marcus Rivera', actorHandle: '@marcus' });
  const approved = await c.approve(node.id, { actor: 'Priya Raghavan', actorHandle: '@priya' });
  assert.equal(approved.approvedVersion, 2);
  assert.equal(approved.status, 'approved');

  // now drift + reject: baseline must NOT move
  await c.patchNode(node.id, { frontmatter: { currentFingerprint: 'sha256:three' }, author: 'ingester' });
  await c.submitReview(node.id, { actor: 'Marcus Rivera', actorHandle: '@marcus' });
  const rejected = await c.reject(node.id, { actor: 'Priya Raghavan', actorHandle: '@priya' });
  assert.equal(rejected.approvedVersion, 2); // unchanged
  assert.equal(rejected.status, 'approved'); // back to last blessed state
});

test('submit-review fires a watcher notification addressed to the owner; comments do NOT', async () => {
  const c = createMockNestClient();
  const { node } = await c.createNode({ type: 'definition', frontmatter: FM, author: 'ingester' });
  await c.postComment(node.id, { body: 'is this fixed?', author: 'Marcus Rivera', authorHandle: '@marcus' });
  assert.equal(c.notifications().length, 0, 'comment-create must not notify');

  await c.submitReview(node.id, { actor: 'Marcus Rivera', actorHandle: '@marcus' });
  assert.equal(c.notifications().length, 1);
  assert.equal(c.notifications()[0].kind, 'review_request');
  assert.deepEqual(c.notifications()[0].notified, ['@priya']);
});

test('versioned reads return each version’s own frontmatter (fingerprint extraction)', async () => {
  const c = createMockNestClient();
  const { node } = await c.createNode({ type: 'definition', frontmatter: FM, author: 'ingester' });
  await c.approve(node.id, { actor: 'Priya Raghavan', actorHandle: '@priya' });
  await c.patchNode(node.id, { frontmatter: { currentFingerprint: 'sha256:two' }, author: 'ingester' });

  const v1 = await c.getNode(node.id, { version: 1 });
  const v2 = await c.getNode(node.id, { version: 2 });
  assert.equal(v1.frontmatter.currentFingerprint, 'sha256:one');
  assert.equal(v2.frontmatter.currentFingerprint, 'sha256:two');

  const versions = await c.getVersions(node.id);
  assert.equal(versions.currentVersion, 2);
  assert.equal(versions.approvedVersion, 1);
  assert.equal(versions.resolvedBy, 'Priya Raghavan');
});

test('comments thread via parentId and resolve without touching governance', async () => {
  const c = createMockNestClient();
  const { node } = await c.createNode({ type: 'definition', frontmatter: FM, author: 'ingester' });
  const { comment: parent } = await c.postComment(node.id, { body: 'q', author: 'Marcus Rivera' });
  const { comment: reply } = await c.postComment(node.id, { body: 'a', parentId: parent.id, author: 'Priya Raghavan' });
  assert.equal(reply.parentId, parent.id);

  const before = await c.getVersions(node.id);
  await c.resolveComment(node.id, parent.id);
  const after = await c.getVersions(node.id);
  assert.deepEqual(after, before, 'resolving a comment must not move governance');

  const open = await c.listComments(node.id, { status: 'open' });
  assert.equal(open.comments.length, 1);
  assert.equal(open.comments[0].id, reply.id);
});

test('listNodes filters by type and approved_only', async () => {
  const c = createMockNestClient();
  const a = (await c.createNode({ type: 'definition', frontmatter: { ...FM, metricId: 'a' }, author: 'i' })).node;
  await c.createNode({ type: 'definition', frontmatter: { ...FM, metricId: 'b' }, author: 'i' });
  await c.createNode({ type: 'document', frontmatter: { title: 'x' }, author: 'i' });
  await c.approve(a.id, { actor: 'Priya Raghavan' });

  const defs = await c.listNodes({ type: 'definition' });
  assert.equal(defs.nodes.length, 2);
  const approvedOnly = await c.listNodes({ type: 'definition', approved_only: true });
  assert.equal(approvedOnly.nodes.length, 1);
  assert.equal(approvedOnly.nodes[0].frontmatter.metricId, 'a');
});

test('missing node/comment/parent throw 404-shaped errors like the real API', async () => {
  const c = createMockNestClient();
  await assert.rejects(() => c.getNode('nope'), (e) => e.status === 404);
  const { node } = await c.createNode({ type: 'definition', frontmatter: FM, author: 'i' });
  await assert.rejects(() => c.postComment(node.id, { body: 'x', parentId: 'cmt-999' }), (e) => e.status === 404);
  await assert.rejects(() => c.postComment(node.id, { body: '  ' }), (e) => e.status === 400);
});
