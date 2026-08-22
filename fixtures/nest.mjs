// fixtures/nest.mjs
// Stands in for Context Nest governed semantic definitions — the source of
// truth for what a metric MEANS and the SQL it was approved against.
// `approvedSql` is the SQL as approved; the provider fingerprints it with the
// SAME core function used to check the current manifest SQL. A metric with NO
// entry here is ungoverned (bad / unapproved). Note `new_logo_arr` is absent.

export const nest = {
  qualified_pipeline: {
    plain:
      'Total open opportunity value that has passed the SAL→SQL qualification gate and is expected to close within the fiscal period.',
    governed:
      'An opportunity is <b>qualified</b> when <code>stage &gt;= "SQL"</code>, <code>amount &gt; 0</code>, and it carries a MEDDICC score ≥ 3. Excludes renewals and closed-lost.',
    owner: 'Priya Raghavan · Analytics Eng',
    steward: 'Finance (Dana K.)',
    certifiedOn: '2026-06-02',
    // Approved SQL — semantically identical to the manifest compiled SQL.
    approvedSql: [
      'select',
      '  fiscal_period,',
      '  sum(amount) as qualified_pipeline',
      'from int_opportunities__qualified',
      'where not is_closed',
      'group by 1',
    ].join('\n'),
    related: [
      { name: 'metric.total_pipeline', match: 'sibling — no qualification gate', governed: true },
      { name: 'metric.weighted_pipeline', match: '× win-probability', governed: true },
    ],
  },

  nrr: {
    plain:
      'Trailing-12-month revenue from existing customers (expansion + contraction + churn), expressed as a percentage of where they started.',
    governed:
      'NRR = <code>(starting_ARR + expansion − contraction − churn) / starting_ARR</code> on the cohort active 12 months ago. <b>Downgrades must be included as contraction.</b>',
    owner: 'Priya Raghavan · Analytics Eng',
    steward: 'Finance (Dana K.)',
    certifiedOn: '2026-04-18',
    // Approved SQL INCLUDES downgrades (arr_change < 0) as contraction. The
    // current manifest SQL dropped this — that mismatch is the drift.
    approvedSql: [
      'select',
      '  sum(expansion_arr) as expansion,',
      '  sum(case when arr_change < 0 then arr_change else 0 end) as contraction',
      'from int_customer_arr__monthly',
    ].join('\n'),
    related: [
      { name: 'metric.gross_revenue_retention', match: 'excludes expansion', governed: true },
      { name: 'metric.logo_retention', match: 'count-based, not $', governed: true },
    ],
  },

  mktg_pipeline: {
    plain:
      'Open pipeline where the originating campaign is attributed to a marketing touch (first-touch attribution model).',
    governed:
      'Pipeline is <b>marketing-sourced</b> when the first recorded touch on the account is a marketing campaign (channel ∈ governed list). First-touch model.',
    owner: 'Priya Raghavan · Analytics Eng',
    steward: 'Marketing (Sam R.)',
    certifiedOn: '2026-05-11',
    approvedSql: [
      'select sum(amount)',
      'from int_attribution__first_touch',
      "where first_channel in ({{ var('marketing_channels') }})",
    ].join('\n'),
    related: [
      { name: 'metric.sales_sourced_pipeline', match: 'complementary source', governed: true },
    ],
  },

  closed_won: {
    plain: 'Count of opportunities that reached Closed-Won in the period.',
    governed:
      'Closed-Won = opportunities where <code>is_won = true</code> among those that entered the qualified stage in-period.',
    owner: 'Priya Raghavan · Analytics Eng',
    steward: 'Sales Ops',
    certifiedOn: '2026-06-02',
    approvedSql: [
      'select fiscal_period, count(*) as closed_won',
      'from int_opportunities__qualified',
      'where is_won',
      'group by 1',
    ].join('\n'),
    related: [],
  },

  win_rate: {
    plain: 'Share of qualified opportunities that reached Closed-Won in the period.',
    governed:
      'Win Rate = <code>closed_won_count / qualified_count</code> over opportunities that entered the qualified stage in-period.',
    owner: 'Priya Raghavan · Analytics Eng',
    steward: 'Sales Ops',
    certifiedOn: '2026-06-02',
    approvedSql: [
      'select',
      '  period,',
      '  won_count::float / nullif(qualified_count, 0) as win_rate',
      'from fct_closed_won',
      'join fct_qualified_pipeline using (period)',
    ].join('\n'),
    related: [
      { name: 'metric.qualified_pipeline', match: 'denominator input', governed: true },
      { name: 'metric.closed_won', match: 'numerator input', governed: true },
    ],
  },
};

// Governed alternatives to point ungoverned metrics toward (US-8).
export const relatedForUngoverned = {
  new_logo_arr: [
    { name: 'metric.new_business_arr', match: 'governed alternative — use this', governed: true },
  ],
};
