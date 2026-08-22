// test/governance-render.test.mjs
// The v2 drawer renderer is DOM-free (view-model in -> HTML out), so the
// gating and honesty requirements are asserted directly (US-2..US-6,
// design-review fixes #1/#2/#5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockNestClient } from '../provider/mock-nest-client.mjs';
import { createGovernance } from '../provider/governance.mjs';
import { seedNest, DEMO_PERSONAS } from '../fixtures/seed-nest.mjs';
import { renderGovernanceBody, govBadgeMeta } from '../widget/governance-render.mjs';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const { marcus, priya } = DEMO_PERSONAS;

async function view(metricId, personaHandle, mutate) {
  const client = createMockNestClient();
  await seedNest(client, { now: NOW });
  const governance = createGovernance({ client });
  if (mutate) await mutate(governance);
  return governance.getGovernance(metricId, { now: NOW, personaHandle });
}

test('badge meta maps all five verdicts + drifted-in-review label', async () => {
  assert.equal(govBadgeMeta(await view('qualified_pipeline')).cls, 'ok');
  assert.equal(govBadgeMeta(await view('nrr')).cls, 'bad');
  assert.equal(govBadgeMeta(await view('new_logo_arr')).cls, 'uncert');
  assert.equal(govBadgeMeta(await view('mktg_pipeline')).cls, 'stale');
  const inReview = await view('nrr', null, (g) => g.propose('nrr', { author: marcus.name }));
  assert.deepEqual(govBadgeMeta(inReview), { cls: 'bad', label: 'Drifted · re-approval in review' });
  assert.equal(govBadgeMeta({ mapped: false }).cls, 'unknown');
  assert.equal(govBadgeMeta({ mapped: true, unavailable: true }).cls, 'unavailable');
});

test('drifted banner is loud; receipt shows both fingerprints + blessed-by line (US-2)', async () => {
  const html = renderGovernanceBody(await view('nrr'), marcus);
  assert.match(html, /do NOT quote/);
  assert.match(html, /Approved fingerprint/);
  assert.match(html, /Current fingerprint/);
  assert.match(html, /MISMATCH · drift/);
  assert.match(html, /Baseline blessed by <b>Priya Raghavan<\/b> at <b>version 1<\/b>/);
  assert.match(html, /Only a human <code>approve<\/code> moves this line/);
});

test('pending review: the OWNER sees approve/reject; the consumer sees Waiting-on (US-5, fix #1)', async () => {
  const propose = (g) => g.propose('nrr', { author: marcus.name, authorHandle: marcus.handle });
  const asOwner = renderGovernanceBody(await view('nrr', priya.handle, propose), priya);
  assert.match(asOwner, /data-pw-approve/);
  assert.match(asOwner, /data-pw-reject/);
  assert.match(asOwner, /Your decision, Priya/); // addressed to the ACTING user, not m.owner

  const asConsumer = renderGovernanceBody(await view('nrr', marcus.handle, propose), marcus);
  assert.doesNotMatch(asConsumer, /data-pw-approve/);
  assert.match(asConsumer, /Waiting on Priya Raghavan/);
});

test('stale: approval is BLOCKED with the loud reason (US-6)', async () => {
  const html = renderGovernanceBody(await view('mktg_pipeline', priya.handle), priya);
  assert.match(html, /approval is blocked/);
  assert.match(html, /bless a number we can.t verify/);
  assert.doesNotMatch(html, /data-pw-approve/);
  assert.match(html, /STALE/);
});

test('uncertified: awaits-human state, never a green word', async () => {
  const html = renderGovernanceBody(await view('new_logo_arr'), marcus);
  assert.match(html, /Awaiting first approval/);
  assert.match(html, /No baseline yet/);
  assert.doesNotMatch(html, /Certified & current/);
});

test('comments carry the service-token attribution label and owner-gated resolve (§7, fix #1)', async () => {
  const asOwner = renderGovernanceBody(await view('nrr', priya.handle), priya);
  assert.match(asOwner, /posted via service token · author self-asserted/);
  assert.match(asOwner, /data-pw-resolve/); // owner may resolve

  const asConsumer = renderGovernanceBody(await view('nrr', marcus.handle), marcus);
  assert.doesNotMatch(asConsumer, /data-pw-resolve/); // consumer may not
  assert.match(asConsumer, /data-pw-reply=/); // but may reply
});

test('comment identity is consistent: avatar initials derive from the asserted author (fix #2)', async () => {
  const html = renderGovernanceBody(await view('nrr'), marcus);
  assert.match(html, />MR</); // Marcus Rivera
  assert.match(html, />PR</); // Priya Raghavan's reply
});

test('flag-to-owner copy states plainly that a bare comment does not notify (US-3)', async () => {
  const html = renderGovernanceBody(await view('nrr'), marcus);
  assert.match(html, /A bare comment does not notify anyone/);
  assert.match(html, /data-pw-flag-owner/);
});

test('certified: propose action offered; drifted: request re-approval framing', async () => {
  const certified = renderGovernanceBody(await view('qualified_pipeline'), marcus);
  assert.match(certified, /data-pw-propose/);
  assert.match(certified, /approved &amp; current/);
  const drifted = renderGovernanceBody(await view('nrr'), marcus);
  assert.match(drifted, /request re-approval/);
});
