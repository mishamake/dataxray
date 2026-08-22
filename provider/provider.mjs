// provider/provider.mjs
// Resolves metric id -> data and exposes the endpoint contract (§6.3).
// This is the ONLY layer that does I/O (here: reads the fixture bundle). It
// calls the pure core for every verdict — never a second implementation.
// No warehouse credentials live here (none are needed for v1 fixtures).

import {
  computeHealth,
  compareFingerprint,
  fingerprintSql,
  deriveStatus,
  badFlavor,
  rollupComposite,
  assembleLlmNarrationInput,
  STATUS_LABEL,
} from '../core/index.mjs';
import { createFixtureManifestAdapter } from './adapter.mjs';
import { profiling } from '../fixtures/profiling.mjs';
import { nest, relatedForUngoverned } from '../fixtures/nest.mjs';
import { narration } from '../fixtures/board.mjs';
import { configForMetric } from '../config/health.config.mjs';

const MINUTE = 60 * 1000;

/**
 * Build a provider bound to a manifest adapter (the dbt seam). Swap the adapter
 * for a real one later without touching the endpoints or the core.
 */
export function createProvider({ adapter = createFixtureManifestAdapter() } = {}) {
  function statsFor(metricId, now) {
    const p = profiling[metricId];
    if (!p) return null;
    const lastLoadedAt = p.ageMinutes == null ? null : now - p.ageMinutes * MINUTE;
    return { ...p, lastLoadedAt };
  }

  // Full internal resolution — the single computation both endpoints read from.
  function resolve(metricId, now, _seen = new Set()) {
    const node = adapter.getNode(metricId);
    if (!metricId || !node) {
      return { metricId: metricId || null, mapped: false, status: 'unknown' };
    }

    const gov = Object.prototype.hasOwnProperty.call(nest, metricId) ? nest[metricId] : null;
    const governed = !!gov;
    const cfg = configForMetric(metricId);
    const stats = statsFor(metricId, now) || {};
    const health = computeHealth(stats, cfg, { now });

    const approvedRecord = governed
      ? { fingerprint: fingerprintSql(gov.approvedSql), sql: gov.approvedSql }
      : null;
    const driftResult = compareFingerprint(node.compiledSql, approvedRecord);

    const tests = node.tests || [];

    // Composite worst-of over named governed inputs (§5.6).
    let inputStatuses = [];
    let compositeInputs = null;
    if (cfg.compositeInputs && !_seen.has(metricId)) {
      _seen.add(metricId);
      compositeInputs = cfg.compositeInputs.map((inId) => {
        const r = resolve(inId, now, _seen);
        return { metricId: inId, status: r.status };
      });
      inputStatuses = compositeInputs.map((c) => c.status);
    }

    const derivation = {
      mapped: true,
      governed,
      approved: cfg.approved,
      driftResult,
      tests,
      freshness: health.freshness,
      inputStatuses,
    };
    const status = deriveStatus(derivation);
    const flavor = status === 'bad' ? badFlavor(derivation) : null;

    return {
      metricId,
      mapped: true,
      node,
      gov,
      governed,
      cfg,
      stats,
      health,
      driftResult,
      tests,
      compositeInputs,
      inputStatuses,
      status,
      flavor,
    };
  }

  /* ------------------------- GET /provenance/:id ------------------------- */
  async function getProvenance(metricId, { now = Date.now() } = {}) {
    const r = resolve(metricId, now);
    if (!r.mapped) {
      return { metricId: r.metricId, mapped: false, status: 'unknown' };
    }
    const { node, gov, governed, driftResult } = r;

    const related = governed
      ? gov.related || []
      : relatedForUngoverned[metricId] || [];

    let driftReceipt = null;
    if (driftResult.drifted) {
      const removed = driftResult.diff.filter((d) => d.t === 'del').length;
      const added = driftResult.diff.filter((d) => d.t === 'add').length;
      driftReceipt = {
        whatChanged:
          node.driftHint ||
          `The model's compiled SQL changed and no longer matches the approved definition (${removed} line(s) removed, ${added} added).`,
        changedBy: node.changedBy || 'unknown',
        when: node.changedAt || node.lastRun || null,
        commit: node.gitCommit || null,
        pr: node.pr || null,
        approvedFingerprint: driftResult.approvedFingerprint,
        currentFingerprint: driftResult.currentFingerprint,
        diff: driftResult.diff,
      };
    }

    return {
      metricId,
      mapped: true,
      governed,
      status: r.status,
      definition: {
        plain: governed ? gov.plain : deriveUngovernedPlain(node),
        governed: governed ? gov.governed : null,
        governedSource: `metric.${metricId}`,
        approvalStatus: governed ? (r.cfg.approved ? 'approved' : 'unapproved') : 'ungoverned',
        matchesLiveSql: governed && !driftResult.drifted && driftResult.hasApprovedFingerprint,
      },
      lineage: (node.lineage || []).map((h) => ({
        layer: h.layer,
        model: h.model,
        transform: h.transform,
        sql: h.sql,
        drift: !!h.drift,
      })),
      tests: node.tests || [],
      related,
      driftReceipt,
      owner: governed ? gov.owner : '— (unassigned)',
      steward: governed ? gov.steward : '—',
      certifiedOn: governed ? gov.certifiedOn : '—',
      supersededBy: r.cfg.supersededBy,
      provenanceAsOf: adapter.runTime(),
    };
  }

  /* --------------------------- GET /stats/:id --------------------------- */
  async function getStats(metricId, { now = Date.now() } = {}) {
    const r = resolve(metricId, now);
    if (!r.mapped) return { metricId: r.metricId, mapped: false };
    const s = r.stats;
    return {
      metricId,
      mapped: true,
      fillRate: { nonNullRows: s.nonNullRows ?? null, totalRows: s.totalRows ?? null },
      distribution: { mu: s.mu ?? null, sigma: s.sigma ?? null },
      rowCount: s.rowCount ?? null,
      baselineRowCount: s.baselineRowCount ?? null,
      lastLoadedAt: s.lastLoadedAt ?? null,
    };
  }

  /* --------------------------- GET /health/:id --------------------------- */
  async function getHealth(metricId, { now = Date.now() } = {}) {
    const r = resolve(metricId, now);
    if (!r.mapped) {
      return {
        metricId: r.metricId,
        mapped: false,
        status: 'unknown',
        label: STATUS_LABEL.unknown,
      };
    }
    const { health, driftResult, tests, compositeInputs } = r;
    const failing = tests.filter((t) => !t.pass).length;

    const narrationInput = assembleLlmNarrationInput({
      status: r.status,
      fill: health.fill,
      freshness: health.freshness,
      distribution: health.distribution,
      volumeDrift: health.volumeDrift,
      drift: driftResult,
      tests,
    });

    return {
      metricId,
      mapped: true,
      status: r.status,
      label: STATUS_LABEL[r.status],
      flavor: r.flavor,
      signals: {
        fill: health.fill,
        freshness: health.freshness,
        distribution: health.distribution,
        volumeDrift: health.volumeDrift,
      },
      tests: { total: tests.length, failing, results: tests },
      composite: compositeInputs
        ? { inputs: compositeInputs, worstOf: rollupComposite(r.inputStatuses) }
        : null,
      drift: {
        drifted: driftResult.drifted,
        hasApprovedFingerprint: driftResult.hasApprovedFingerprint,
        currentFingerprint: driftResult.currentFingerprint,
        approvedFingerprint: driftResult.approvedFingerprint,
      },
      // LLM narration: restates deterministic signals; carries no verdict authority.
      narration: {
        text: narration[metricId] || null,
        authority: 'none',
        input: narrationInput,
      },
      provenanceAsOf: adapter.runTime(),
    };
  }

  return { getProvenance, getStats, getHealth, resolve, adapter };
}

function deriveUngovernedPlain(node) {
  return (
    'This tile was built from an ad-hoc query (' +
    (node.model || 'unknown model') +
    '). There is no governed semantic definition, so its exact meaning is undefined.'
  );
}

// A default provider bound to the fixture adapter, for the demo + tests.
export const provider = createProvider();
