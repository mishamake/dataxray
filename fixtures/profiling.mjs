// fixtures/profiling.mjs
// Stands in for warehouse profiling stats. `ageMinutes` is how long ago the
// table was last loaded; the provider turns it into an absolute lastLoadedAt
// (now - ageMinutes) so the demo behaves the same on any run date while the
// core still computes freshness = now - lastLoadedAt vs SLA.

export const profiling = {
  qualified_pipeline: {
    totalRows: 42362, nonNullRows: 42110,
    mu: 184000, sigma: 61000, baselineMu: 180000, baselineSigma: 61000,
    rowCount: 42362, baselineRowCount: 42235,
    ageMinutes: 42,
  },
  nrr: {
    totalRows: 8140, nonNullRows: 8069,
    mu: 118, sigma: 3, baselineMu: 109, baselineSigma: 3,
    rowCount: 8140, baselineRowCount: 8102,
    ageMinutes: 180,
  },
  new_logo_arr: {
    totalRows: 1250, nonNullRows: 1100,
    mu: null, sigma: null, baselineMu: null, baselineSigma: null,
    rowCount: 1250, baselineRowCount: null,
    ageMinutes: null,
  },
  mktg_pipeline: {
    totalRows: 6300, nonNullRows: 6111,
    mu: 1600000, sigma: 240000, baselineMu: 1590000, baselineSigma: 240000,
    rowCount: 6300, baselineRowCount: 6300,
    ageMinutes: 9 * 24 * 60, // 9 days -> breaches 24h SLA
  },
  closed_won: {
    totalRows: 10500, nonNullRows: 10500,
    mu: 24.1, sigma: 2.1, baselineMu: 24.0, baselineSigma: 2.1,
    rowCount: 10500, baselineRowCount: 10470,
    ageMinutes: 42,
  },
  win_rate: {
    totalRows: 512, nonNullRows: 512,
    mu: 24.8, sigma: 1.5, baselineMu: 24.1, baselineSigma: 1.5,
    rowCount: 512, baselineRowCount: 508,
    ageMinutes: 42,
  },
};
