// fixtures/board.mjs
// Demo-only: the sample dashboard tiles and chat answers the host renders.
// The widget augments these; it does not render the numbers. `llm` is the
// fixture-served narration text (the model call is stubbed for v1; the
// signals-in → narration-out CONTRACT is what is real). Note `cac_payback`
// carries NO metricId — an unmapped tile (honest partial state).

export const tiles = [
  { metricId: 'qualified_pipeline', label: 'Qualified Pipeline', value: '$4.2M', delta: '▲ 6.1% vs last week' },
  { metricId: 'nrr', label: 'Net Revenue Retention', value: '118%', delta: '▲ 3pts vs last quarter' },
  { metricId: 'new_logo_arr', label: 'New Logo ARR (beta)', value: '$980K', delta: 'analyst-built tile · added 4 days ago' },
  { metricId: 'mktg_pipeline', label: 'Marketing Sourced Pipeline', value: '$1.6M', delta: 'last synced 9 days ago' },
  { metricId: 'win_rate', label: 'Win Rate', value: '24.8%', delta: '▲ 1.2pts QoQ' },
  { metricId: null, label: 'CAC Payback (months)', value: '14.2', delta: 'imported chart · no metric id' },
];

export const chat = [
  {
    question: "What's our qualified pipeline heading into the forecast call?",
    lead: 'Qualified pipeline for Q3 currently stands at',
    value: '$4.2M',
    metricId: 'qualified_pipeline',
  },
  {
    question: "And what's our net revenue retention?",
    lead: 'Net revenue retention over the trailing 12 months is',
    value: '118%',
    metricId: 'nrr',
  },
];

// Fixture-served narration text, keyed by metric id. Restates deterministic
// signals only — never introduces a verdict of its own.
export const narration = {
  qualified_pipeline:
    'Reads as trustworthy: ~42k rows at 99.4% fill, refreshed well inside the 6-hour SLA, and all dbt tests pass. Distribution is stable week-over-week and the compiled SQL still matches the governed definition — the fingerprint check found no drift.',
  nrr:
    'The value is fresh and well-populated, but the deterministic fingerprint check shows the compiled SQL no longer matches the governed definition — the clause that counted downgrades as contraction was removed on the Aug-14 deploy. Because the fingerprint mismatches, treat 118% as unverified until the model is reconciled; this conclusion comes from the fingerprint check, not from any judgement here.',
  new_logo_arr:
    'This metric has no governed definition and no configured SLA, so most trust signals cannot be computed. The one measurable signal — fill rate — is only 88%. Nothing here establishes trust; an owner must define and approve it first.',
  mktg_pipeline:
    'Definition matches and distribution looks normal, but the freshness signal shows the data was last loaded 9 days ago against a 24-hour SLA — the upstream connector has been failing. The meaning is intact; the value is simply out of date.',
  win_rate:
    'Composite of two certified inputs (qualified pipeline and closed-won), both fresh and matching their definitions. The worst-of gate is green because neither input is flagged. Ratio is stable quarter-over-quarter.',
  closed_won:
    'Certified input: full fill, fresh load, tests pass, and the compiled SQL matches the governed definition.',
};
