// provider/ingester.mjs
// The provider-owned dbt→nest ingestion (PRD §5.2, US-7). The server has NO
// dbt ingest, so our side parses manifest.json, computes the deterministic
// fingerprint with the SAME v1 core routine, and upserts `definition` nodes.
//
// THE RULE THAT MAKES DRIFT POSSIBLE: the ingester writes `currentFingerprint`
// + `ingestedAt` into the CURRENT/draft version ONLY. It never authors an
// approved fingerprint, never sets status: approved, never moves
// approvedVersion. The blessed baseline is whatever a human last approved.

import { fingerprintSql } from '../core/index.mjs';

/**
 * Parse a real dbt manifest.json into the load-bearing fields only (PRD §3:
 * no lineage/ref parsing). A model becomes a governed metric when its `meta`
 * carries a metricId.
 * @param {object} manifestJson  parsed manifest.json
 * @returns {Array<{metricId:string, compiledSql:string, owner:string|null,
 *   ownerHandle:string|null, humanDefinition:string|null, dbtModelRef:string}>}
 */
export function parseManifest(manifestJson) {
  const nodes = (manifestJson && manifestJson.nodes) || {};
  const out = [];
  for (const [uniqueId, node] of Object.entries(nodes)) {
    if (!node || node.resource_type !== 'model') continue;
    const meta = node.meta || {};
    const metricId = meta.metricId || meta.metric_id || null;
    if (!metricId) continue;
    const compiledSql = node.compiled_sql != null ? node.compiled_sql : node.compiledSql;
    if (compiledSql == null) continue; // uncompiled node — nothing to fingerprint
    out.push({
      metricId: String(metricId),
      compiledSql: String(compiledSql),
      owner: meta.owner || null,
      ownerHandle: meta.ownerHandle || meta.owner_handle || null,
      humanDefinition: meta.humanDefinition || meta.human_definition || node.description || null,
      dbtModelRef: uniqueId.replace(/^model\./, 'model.').split('.').slice(-2).join('/'),
    });
  }
  return out;
}

/**
 * Idempotently upsert definition nodes for every mapped metric in a manifest.
 * POST if absent, PATCH if present — the current/draft version only.
 * @param {object} client  NestClient | MockNestClient (same interface)
 * @param {object} manifestJson
 * @param {object} [opts]
 * @param {Date|number|string} [opts.now]  ingest timestamp (default: real now)
 * @param {Set<string>} [opts.include]  restrict to these metricIds (demo seeding)
 * @param {string} [opts.author]  recorded as the version author (service account)
 * @returns {Promise<{created:string[], updated:string[], fingerprints:Object}>}
 */
export async function ingestManifest(client, manifestJson, opts = {}) {
  const now = opts.now != null ? new Date(opts.now) : new Date();
  const ingestedAt = now.toISOString();
  const author = opts.author || 'dbt-ingest (service)';
  const metrics = parseManifest(manifestJson).filter(
    (m) => !opts.include || opts.include.has(m.metricId)
  );

  const existing = await client.listNodes({ type: 'definition' });
  const byMetricId = new Map(
    (existing.nodes || [])
      .map((n) => [n.frontmatter && n.frontmatter.metricId, n])
      .filter(([id]) => id != null)
  );

  const created = [];
  const updated = [];
  const fingerprints = {};

  for (const m of metrics) {
    const currentFingerprint = fingerprintSql(m.compiledSql);
    fingerprints[m.metricId] = currentFingerprint;
    const frontmatter = {
      metricId: m.metricId,
      humanDefinition: m.humanDefinition,
      compiledSql: m.compiledSql,
      currentFingerprint,
      dbtModelRef: m.dbtModelRef,
      owner: m.owner,
      ownerHandle: m.ownerHandle,
      ingestedAt,
    };
    const found = byMetricId.get(m.metricId);
    if (!found) {
      await client.createNode({
        type: 'definition',
        frontmatter,
        body: m.humanDefinition || '',
        author,
      });
      created.push(m.metricId);
    } else {
      await client.patchNode(found.id, { frontmatter, body: m.humanDefinition || found.body, author });
      updated.push(m.metricId);
    }
  }

  return { created, updated, fingerprints, ingestedAt };
}
