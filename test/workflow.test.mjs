import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStatusChange, validateReviewerIds, isThreadCompleted } from '../contracts/index.mjs';

const builder = { tenant: 't', oid: 'builder', name: 'B. Builder' };
const author = { tenant: 't', oid: 'author', name: 'A. Author' };
const reviewer = { tenant: 't', oid: 'rev', name: 'R. Reviewer' };
const other = { tenant: 't', oid: 'other', name: 'O. Other' };
const isBuilder = (a) => a.oid === 'builder';
const plan = (over) => planStatusChange({ authorId: 'author', reviewerIds: ['rev'], isBuilder, ...over });

test('builder submits Open or In Progress work for review; others cannot', () => {
  assert.equal(plan({ actor: builder, current: 'Open', next: 'Needs Review' }).ok, true);
  assert.equal(plan({ actor: builder, current: 'In Progress', next: 'Needs Review', feedback: 'Fixed' }).event.feedback, 'Fixed');
  assert.equal(plan({ actor: author, current: 'Open', next: 'Needs Review' }).code, 403);
  assert.equal(plan({ actor: builder, current: 'Completed', next: 'Needs Review' }).code, 409);
  assert.equal(planStatusChange({ actor: builder, current: 'Open', next: 'Needs Review', authorId: 'author' }).code, 403, 'no policy → deny');
});

test('author or assigned reviewer approves or requests changes', () => {
  assert.equal(plan({ actor: author, current: 'Needs Review', next: 'Completed' }).ok, true);
  assert.equal(plan({ actor: reviewer, current: 'Needs Review', next: 'In Progress', feedback: 'Wrong filter' }).ok, true);
  assert.equal(plan({ actor: other, current: 'Needs Review', next: 'Completed' }).code, 403);
  assert.equal(plan({ actor: author, current: 'Open', next: 'Completed' }).code, 409);
});

test('feedback rules: required for changes, forbidden on approval', () => {
  assert.equal(plan({ actor: author, current: 'Needs Review', next: 'In Progress' }).code, 400);
  assert.equal(plan({ actor: author, current: 'Needs Review', next: 'In Progress', feedback: '   ' }).code, 400);
  assert.equal(plan({ actor: author, current: 'Needs Review', next: 'Completed', feedback: 'ok' }).code, 400);
  assert.equal(plan({ actor: author, current: 'Needs Review', next: 'Open' }).code, 400);
});

test('originals with tasks are reviewed per task; agent actions are labelled', () => {
  assert.equal(plan({ actor: author, current: 'Needs Review', next: 'Completed', hasTasks: true }).code, 409);
  assert.equal(plan({ actor: { ...builder, viaAgent: true }, current: 'Open', next: 'Needs Review' }).event.viaAgent, true);
});

test('reviewer lists and thread completion', () => {
  assert.deepEqual(validateReviewerIds([' a ', 'b']), { ok: true, value: ['a', 'b'] });
  assert.equal(validateReviewerIds(['a', 'a']).ok, false);
  assert.equal(validateReviewerIds(Array.from({ length: 21 }, (_, i) => `r${i}`)).ok, false);
  assert.equal(isThreadCompleted({ status: 'Open', tasks: [{ status: 'Completed' }] }), true);
  assert.equal(isThreadCompleted({ status: 'Completed', tasks: [{ status: 'Open' }] }), false);
  assert.equal(isThreadCompleted({ status: 'Completed' }), true);
});
