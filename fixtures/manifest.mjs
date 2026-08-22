// fixtures/manifest.mjs
// Stands in for a dbt manifest.json + catalog.json. Keyed by metric id.
// `compiledSql` on the gold node is what the drift check fingerprints NOW.
// For the drifted metric this intentionally differs from the nest's approved SQL.

export const MANIFEST_RUN_TIME = '2026-08-20T08:55:00Z'; // provenance-of-the-provenance

export const manifest = {
  qualified_pipeline: {
    metricId: 'qualified_pipeline',
    model: 'fct_qualified_pipeline',
    gitCommit: 'e21b90d',
    lastRun: '2026-08-20T08:12:00Z',
    // Cosmetically different from the approved SQL (case/whitespace/comment) but
    // semantically identical -> normalization collapses them -> NOT drifted.
    compiledSql: [
      'SELECT fiscal_period,',
      '       SUM(amount) AS qualified_pipeline   -- rolled up per fiscal period',
      'FROM int_opportunities__qualified',
      'WHERE NOT is_closed',
      'GROUP BY 1',
    ].join('\n'),
    columns: [
      { name: 'fiscal_period', type: 'text' },
      { name: 'qualified_pipeline', type: 'numeric' },
    ],
    lineage: [
      {
        layer: 'source',
        model: 'salesforce.opportunity',
        transform: 'Fivetran sync · 42,362 rows · no transform',
        sql: 'select * from salesforce.opportunity',
      },
      {
        layer: 'bronze',
        model: 'stg_salesforce__opportunity',
        transform: 'cast + rename raw columns',
        sql: [
          'select',
          '  id as opportunity_id,',
          '  amount::numeric,',
          '  stage_name as stage,',
          '  is_closed, is_won, close_date',
          "from {{ source('salesforce','opportunity') }}",
        ].join('\n'),
      },
      {
        layer: 'silver',
        model: 'int_opportunities__qualified',
        transform: 'apply SAL→SQL qualification gate',
        sql: [
          'select *',
          "from {{ ref('stg_salesforce__opportunity') }}",
          "where stage in ('SQL','Proposal','Negotiation')",
          '  and amount > 0',
          '  and meddicc_score >= 3',
        ].join('\n'),
      },
      {
        layer: 'gold',
        model: 'fct_qualified_pipeline',
        transform: 'sum by fiscal period · certified metric',
        sql: [
          'select fiscal_period,',
          '  sum(amount) as qualified_pipeline',
          "from {{ ref('int_opportunities__qualified') }}",
          'where not is_closed',
          'group by 1',
        ].join('\n'),
      },
    ],
    tests: [
      { name: 'not_null', column: 'opportunity_id', pass: true },
      { name: 'unique', column: 'opportunity_id', pass: true },
      { name: 'accepted_values', column: 'stage', pass: true },
      { name: 'relationships', column: 'account_id → accounts', pass: true },
    ],
  },

  nrr: {
    metricId: 'nrr',
    model: 'fct_net_revenue_retention',
    gitCommit: 'a7f3c9e',
    lastRun: '2026-08-20T05:40:00Z',
    changedBy: 'jordan.m@company',
    changedAt: '2026-08-14T09:42:00Z',
    pr: '#812 "refactor NRR — simplify contraction logic"',
    driftHint:
      'The contraction calculation was rewritten so downgrades (arr_change < 0) are no longer counted — only full churn. That silently overstates retention.',
    // DRIFTED: the contraction clause was rewritten to count churn only, dropping
    // downgrades. This no longer matches the approved SQL in the nest.
    compiledSql: [
      'select',
      '  sum(expansion_arr) as expansion,',
      '  -- contraction now only counts churn, not downgrades',
      '  sum(case when is_churn then arr_change else 0 end) as contraction',
      'from int_customer_arr__monthly',
    ].join('\n'),
    columns: [
      { name: 'account_id', type: 'text' },
      { name: 'nrr', type: 'numeric' },
    ],
    lineage: [
      {
        layer: 'source',
        model: 'stripe.subscriptions + salesforce.contracts',
        transform: '2 sources reconciled on account_id',
        sql: '-- two source systems reconciled on account_id',
      },
      {
        layer: 'bronze',
        model: 'stg_billing__arr_events',
        transform: 'normalize ARR change events',
        sql: [
          'select account_id, event_date,',
          '  arr_change, is_churn',
          "from {{ source('stripe','subscription_events') }}",
        ].join('\n'),
      },
      {
        layer: 'silver',
        model: 'int_customer_arr__monthly',
        transform: 'roll up to monthly cohort',
        sql: [
          'select account_id, month,',
          '  sum(arr_change) as net_arr_change,',
          '  bool_or(is_churn) as is_churn',
          "from {{ ref('stg_billing__arr_events') }}",
          'group by 1,2',
        ].join('\n'),
      },
      {
        layer: 'gold',
        model: 'fct_net_revenue_retention',
        transform: 'SQL changed 2026-08-14 — drifts from governed definition',
        drift: true,
        sql: [
          'select',
          '  sum(expansion_arr) as expansion,',
          '  -- contraction now only counts churn, not downgrades',
          '  sum(case when is_churn then arr_change else 0 end) as contraction',
          'from int_customer_arr__monthly',
        ].join('\n'),
      },
    ],
    tests: [
      { name: 'not_null', column: 'account_id', pass: true },
      { name: 'unique', column: 'account_id + month', pass: true },
      { name: 'accepted_range', column: 'nrr (0–3)', pass: true },
      { name: 'relationships', column: 'account_id → accounts', pass: true },
    ],
  },

  // Ad-hoc, NOT in the governed dbt project — no nest definition maps to it.
  new_logo_arr: {
    metricId: 'new_logo_arr',
    model: 'analyst_scratch.new_logo_v3',
    gitCommit: null,
    lastRun: null,
    compiledSql: [
      '-- built in the BI tool, not version-controlled',
      'select sum(amount)',
      'from opportunity',
      "where is_won and account_first_deal = 'true'",
    ].join('\n'),
    columns: [{ name: 'new_logo_arr', type: 'numeric' }],
    lineage: [
      {
        layer: 'source',
        model: 'salesforce.opportunity',
        transform: 'ingest',
        sql: '-- same source table',
      },
      {
        layer: 'gold',
        model: 'analyst_scratch.new_logo_v3',
        transform: 'ad-hoc — not in governed dbt project',
        drift: true,
        sql: [
          '-- built in the BI tool, not version-controlled',
          'select sum(amount)',
          'from opportunity',
          "where is_won and account_first_deal = 'true'",
        ].join('\n'),
      },
    ],
    tests: [
      { name: 'governance', column: 'approved definition exists', pass: false },
      { name: 'ownership', column: 'owner assigned', pass: false },
    ],
  },

  mktg_pipeline: {
    metricId: 'mktg_pipeline',
    model: 'fct_marketing_sourced_pipeline',
    gitCommit: 'c14aa02',
    lastRun: '2026-08-11T02:00:00Z',
    // Matches the approved SQL exactly (meaning intact) — the problem is freshness.
    compiledSql: [
      'select sum(amount)',
      'from int_attribution__first_touch',
      "where first_channel in ({{ var('marketing_channels') }})",
    ].join('\n'),
    columns: [{ name: 'mktg_pipeline', type: 'numeric' }],
    lineage: [
      {
        layer: 'source',
        model: 'salesforce.campaign_member',
        transform: 'connector last success 2026-08-11',
        sql: '-- Fivetran connector last success: 2026-08-11',
      },
      {
        layer: 'silver',
        model: 'int_attribution__first_touch',
        transform: 'assign first marketing touch',
        sql: [
          'select account_id,',
          '  first_value(channel) over (partition by account_id order by touch_date) as first_channel',
          "from {{ ref('stg_salesforce__campaign_member') }}",
        ].join('\n'),
      },
      {
        layer: 'gold',
        model: 'fct_marketing_sourced_pipeline',
        transform: 'sum by period',
        sql: [
          'select sum(amount)',
          "from {{ ref('int_attribution__first_touch') }}",
          "where first_channel in ({{ var('marketing_channels') }})",
        ].join('\n'),
      },
    ],
    tests: [
      { name: 'not_null', column: 'account_id', pass: true },
      { name: 'accepted_values', column: 'first_channel', pass: true },
      { name: 'relationships', column: 'account_id → accounts', pass: true },
    ],
  },

  // Certified input used by the win_rate composite (not on the board itself).
  closed_won: {
    metricId: 'closed_won',
    model: 'fct_closed_won',
    gitCommit: 'e21b90d',
    lastRun: '2026-08-20T08:12:00Z',
    // Compiled form: refs already resolved to relation names (matches approved).
    compiledSql: [
      'select fiscal_period, count(*) as closed_won',
      'from int_opportunities__qualified',
      'where is_won',
      'group by 1',
    ].join('\n'),
    columns: [{ name: 'closed_won', type: 'integer' }],
    lineage: [
      {
        layer: 'gold',
        model: 'fct_closed_won',
        transform: 'count won opps by period · certified',
        sql: [
          'select fiscal_period, count(*) as closed_won',
          "from {{ ref('int_opportunities__qualified') }}",
          'where is_won',
          'group by 1',
        ].join('\n'),
      },
    ],
    tests: [
      { name: 'not_null', column: 'fiscal_period', pass: true },
      { name: 'accepted_range', column: 'closed_won >= 0', pass: true },
    ],
  },

  win_rate: {
    metricId: 'win_rate',
    model: 'fct_win_rate',
    gitCommit: 'e21b90d',
    lastRun: '2026-08-20T08:12:00Z',
    composite: true,
    inputs: ['closed_won', 'qualified_pipeline'],
    // Compiled form: refs already resolved to relation names (matches approved).
    compiledSql: [
      'select period,',
      '  won_count::float / nullif(qualified_count, 0) as win_rate',
      'from fct_closed_won',
      'join fct_qualified_pipeline using (period)',
    ].join('\n'),
    columns: [{ name: 'win_rate', type: 'numeric' }],
    lineage: [
      {
        layer: 'gold',
        model: 'fct_qualified_pipeline',
        transform: 'certified input (denominator)',
        sql: '-- see Qualified Pipeline lineage',
      },
      {
        layer: 'gold',
        model: 'fct_closed_won',
        transform: 'certified input (numerator)',
        sql: [
          'select fiscal_period, count(*) as closed_won',
          "from {{ ref('int_opportunities__qualified') }}",
          'where is_won',
        ].join('\n'),
      },
      {
        layer: 'gold',
        model: 'fct_win_rate',
        transform: 'numerator ÷ denominator · composite (worst-of gate)',
        sql: [
          'select period,',
          '  won_count::float / nullif(qualified_count, 0) as win_rate',
          "from {{ ref('fct_closed_won') }}",
          "join {{ ref('fct_qualified_pipeline') }} using (period)",
        ].join('\n'),
      },
    ],
    tests: [
      { name: 'not_null', column: 'win_rate', pass: true },
      { name: 'accepted_range', column: 'win_rate (0–1)', pass: true },
    ],
  },
};
