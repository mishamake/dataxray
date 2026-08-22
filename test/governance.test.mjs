// test/governance.test.mjs
// The governance mapper against MockNestClient (PRD §5.3–§5.7, §5.10; US-1, US-2, US-6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockNestClient } from '../provider/mock-nest-client.mjs';
import { createGovernance, DEFAULT_STALENESS_THRESHOLD_MS } from '../provider/governance.mjs';
import { seedNest, DEMO_PERSONAS } from '../fixtures/seed-nest.mjs';
import { VERDICT } from '../core/index.mjs';

const NOW = Date.parse('2026-08-20T12:00:00Z');

async function seeded() {
  const client = createMockNestClient();
  await seedNest(client, { now: NOW });
  const governance = createGovernance({ client });
  return { client, governance };
}

test('US-1: the five badge states, read from real nest governance', async () => {
  const { governance } = await seeded();
  assert.equal((await governance.getGovernance('qualified_pipeline', { now: NOW })).verdict, VERDICT.CERTIFIED);
  assert.equal((await governance.getGovernance('nrr', { now: NOW })).verdict, VERDICT.DRIFTED);
  assert.equal((await governance.getGovernance('new_logo_arr', { now: NOW })).verdict, VERDICT.UNCERTIFIED);
  assert.equal((await governance.getGovernance('mktg_pipeline', { now: NOW })).verdict, VERDICT.STALE);
  assert.equal((await governance.getGovernance('win_rate', { now: NOW })).verdict, VERDICT.CERTIFIED);
  assert.equal((await governance.getGovernance('cac_payback', { now: NOW })).mapped, false);
});

test('drift verdict compares fingerprint@currentVersion vs fingerprint@approvedVersion', async () => {
  const { governance } = await seeded();
  const g = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g.receipt.approvedVersion, 1);
  assert.equal(g.receipt.currentVersion, 2);
  assert.ok(g.receipt.fpApproved.startsWith('sha256:'));
  assert.ok(g.receipt.fpCurrent.startsWith('sha256:'));
  assert.notEqual(g.receipt.fpCurrent, g.receipt.fpApproved);
});

test('US-2: the receipt names who blessed the baseline and when', async () => {
  const { governance } = await seeded();
  const g = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g.receipt.blessedBy, 'Priya Raghavan');
  assert.ok(g.receipt.blessedAt, 'expected a blessed-at timestamp');
});

test('US-6: stale ingest — last ingest older than the threshold degrades loudly', async () => {
  const { governance } = await seeded();
  const g = await governance.getGovernance('mktg_pipeline', { now: NOW });
  assert.equal(g.receipt.ingestFresh, false);
  assert.equal(g.verdict, VERDICT.STALE);
  assert.equal(g.verdictLabel, "Stale · can't confirm current");
  // and with a clock inside the window it would be certified — freshness is the deciding input
  const freshNow = Date.parse(g.receipt.ingestedAt) + 60 * 1000;
  const g2 = await governance.getGovernance('mktg_pipeline', { now: freshNow });
  assert.equal(g2.verdict, VERDICT.CERTIFIED);
});

test('§5.4: the staleness threshold is configurable', async () => {
  const { client } = await seeded();
  const strict = createGovernance({ client, stalenessThresholdMs: 60 * 1000 });
  const g = await strict.getGovernance('qualified_pipeline', { now: NOW });
  assert.equal(g.verdict, VERDICT.STALE, 'a 1-minute threshold makes a 2-hour-old ingest stale');
  assert.equal(DEFAULT_STALENESS_THRESHOLD_MS, 24 * 60 * 60 * 1000);
});

test('§5.7: a failing nest degrades to the loud unavailable state, never silent-green', async () => {
  const broken = {
    async listNodes() { throw new Error('ECONNREFUSED'); },
  };
  const governance = createGovernance({ client: broken });
  const g = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g.unavailable, true);
  assert.equal(g.verdict, VERDICT.STALE);
  assert.match(g.error, /ECONNREFUSED/);
});

test('owner/steward gating follows the node ownerHandle, not a hardcoded name', async () => {
  const { governance } = await seeded();
  const asPriya = await governance.getGovernance('nrr', { now: NOW, personaHandle: DEMO_PERSONAS.priya.handle });
  assert.equal(asPriya.canGovern, true);
  const asMarcus = await governance.getGovernance('nrr', { now: NOW, personaHandle: DEMO_PERSONAS.marcus.handle });
  assert.equal(asMarcus.canGovern, false);
  const anonymous = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(anonymous.canGovern, false);
});

test('comments come threaded (one level) with open count', async () => {
  const { governance } = await seeded();
  const g = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g.comments.length, 1);
  assert.equal(g.comments[0].replies.length, 1);
  assert.equal(g.comments[0].replies[0].author, 'Priya Raghavan');
  assert.equal(g.openCommentCount, 1);
});

test('view model carries the human definition + owner from node frontmatter', async () => {
  const { governance } = await seeded();
  const g = await governance.getGovernance('nrr', { now: NOW });
  assert.equal(g.owner, 'Priya Raghavan');
  assert.equal(g.ownerHandle, '@priya');
  assert.match(g.humanDefinition, /Trailing-12-month/);
  assert.match(g.dbtModelRef, /fct_net_revenue_retention$/);
});
