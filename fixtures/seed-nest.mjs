// fixtures/seed-nest.mjs
// Seeds a MockNestClient into the demo state using ONLY the real paths — the
// actual ingester and the client's own governance methods. No back-door state
// edits: this is exactly what Dana's ingest + Priya's approvals would produce.
//
// The story it tells (one metric per verdict state, US-1):
//   qualified_pipeline  CERTIFIED    fresh ingest, fingerprints match
//   nrr                 DRIFTED      SQL changed after the human blessed v1
//   new_logo_arr        UNCERTIFIED  ingested, never human-approved
//   mktg_pipeline       STALE        its ingest pipeline fell behind (9d > 24h)
//   win_rate            CERTIFIED    (composite detail stays in the v1 drawer)
//   cac_payback         UNMAPPED     no definition node at all

import { ingestManifest } from '../provider/ingester.mjs';
import { dbtManifestBaseline, dbtManifestCurrent } from './dbt-manifest.mjs';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export const DEMO_PERSONAS = {
  marcus: { name: 'Marcus Rivera', handle: '@marcus', role: 'RevOps' },
  priya: { name: 'Priya Raghavan', handle: '@priya', role: 'Steward' },
};

/**
 * @param {object} client  a MockNestClient (or any client with the same interface)
 * @param {object} [opts]
 * @param {number} [opts.now]  reference "now" (ms) — fixed in tests, real in demo
 * @returns {Promise<{nodeIds: Object<string,string>}>}
 */
export async function seedNest(client, { now = Date.now() } = {}) {
  const tBaseline = now - 9 * DAY; // the last full ingest + approval round
  const tCurrent = now - 2 * HOUR; // today's ingest (mktg's pipeline missed it)

  // 1. BASELINE ingest, 9 days ago — every mapped model, pre-drift SQL.
  await ingestManifest(client, dbtManifestBaseline, { now: tBaseline });

  const defs = await client.listNodes({ type: 'definition' });
  const nodeIds = Object.fromEntries(
    defs.nodes.map((n) => [n.frontmatter.metricId, n.id])
  );

  // 2. HUMAN approvals — the only legitimate way a baseline appears. Priya
  //    blesses the metrics she owns; new_logo_arr is never blessed.
  for (const metricId of ['qualified_pipeline', 'nrr', 'mktg_pipeline', 'closed_won', 'win_rate']) {
    await client.approve(nodeIds[metricId], {
      actor: DEMO_PERSONAS.priya.name,
      actorHandle: DEMO_PERSONAS.priya.handle,
    });
  }

  // 3. TODAY's ingest — the drifted NRR deploy lands. mktg_pipeline is NOT in
  //    this run: its ingest pipeline fell behind, so its ingestedAt stays 9d
  //    old -> the freshness heartbeat degrades it to STALE (never false green).
  const todaysRun = new Set(Object.keys(nodeIds).filter((id) => id !== 'mktg_pipeline'));
  await ingestManifest(client, dbtManifestCurrent, { now: tCurrent, include: todaysRun });

  // 4. The conversation already on the NRR definition — Marcus asked, Priya
  //    answered in-thread. Posted via the real comments API (no notification).
  const { comment: q } = await client.postComment(nodeIds.nrr, {
    body: "NRR on the board draft reads 118% but the contraction logic changed last sprint. Is the definition being re-approved, or is my pull wrong?",
    author: DEMO_PERSONAS.marcus.name,
    authorHandle: DEMO_PERSONAS.marcus.handle,
  });
  await client.postComment(nodeIds.nrr, {
    parentId: q.id,
    body: "Good catch — the compiled SQL drifted on the Aug-14 deploy (PR #812): downgrades were dropped from contraction. Until a steward re-approves or reverts it, treat 118% as unverified. The decision is in the governor panel below.",
    author: DEMO_PERSONAS.priya.name,
    authorHandle: DEMO_PERSONAS.priya.handle,
  });

  return { nodeIds };
}
