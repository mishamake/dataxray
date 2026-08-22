// fixtures/dbt-manifest.mjs
// A REAL dbt manifest.json-shaped fixture (what `dbt compile` emits), so the
// ingester exercises the same parse path it will use in production. Two
// snapshots tell the demo story:
//   BASELINE — the project as last human-approved (NRR includes downgrades)
//   CURRENT  — today: NRR's contraction clause was rewritten (the drift)
// SQL strings are shared with fixtures/manifest.mjs + fixtures/nest.mjs so the
// v1 drawer diagnostics and the v2 governance verdict describe the same world.

import { nest } from './nest.mjs';
import { manifest as v1Manifest } from './manifest.mjs';

const PRIYA = { owner: 'Priya Raghavan', ownerHandle: '@priya' };

function model(name, metricId, compiledSql, meta = {}) {
  return [
    `model.rev_analytics.${name}`,
    {
      resource_type: 'model',
      name,
      package_name: 'rev_analytics',
      compiled_sql: compiledSql,
      description: meta.humanDefinition || '',
      meta: { metricId, ...meta },
    },
  ];
}

function buildManifest(nrrSql) {
  return {
    metadata: {
      dbt_schema_version: 'https://schemas.getdbt.com/dbt/manifest/v12.json',
      generated_at: '2026-08-20T08:55:00Z',
      project_name: 'rev_analytics',
    },
    nodes: Object.fromEntries([
      model('fct_qualified_pipeline', 'qualified_pipeline', v1Manifest.qualified_pipeline.compiledSql, {
        ...PRIYA,
        humanDefinition: nest.qualified_pipeline.plain,
      }),
      model('fct_net_revenue_retention', 'nrr', nrrSql, {
        ...PRIYA,
        humanDefinition: nest.nrr.plain,
      }),
      model('fct_marketing_sourced_pipeline', 'mktg_pipeline', v1Manifest.mktg_pipeline.compiledSql, {
        ...PRIYA,
        humanDefinition: nest.mktg_pipeline.plain,
      }),
      model('fct_closed_won', 'closed_won', v1Manifest.closed_won.compiledSql, {
        ...PRIYA,
        humanDefinition: nest.closed_won.plain,
      }),
      model('fct_win_rate', 'win_rate', v1Manifest.win_rate.compiledSql, {
        ...PRIYA,
        humanDefinition: nest.win_rate.plain,
      }),
      // Ingested but never human-approved -> "Awaiting first approval".
      model('new_logo_v3', 'new_logo_arr', v1Manifest.new_logo_arr.compiledSql, {
        owner: null,
        ownerHandle: null,
        humanDefinition:
          'ARR from first-deal accounts, analyst-defined. A draft definition exists but no steward has blessed it yet.',
      }),
    ]),
  };
}

// Pre-drift: NRR compiled SQL is the SQL that was later human-approved.
export const dbtManifestBaseline = buildManifest(nest.nrr.approvedSql);

// Today: NRR carries the drifted compiled SQL from the Aug-14 deploy.
export const dbtManifestCurrent = buildManifest(v1Manifest.nrr.compiledSql);
