// config/health.config.mjs
// THE health config file (PRD §7). One file, sensible defaults, no admin console.
// Defines which definitions are approved, per-metric SLA cadence, fill-rate
// thresholds, the volume-drift band, distribution sensitivity, and which tiles
// are composites over which named input metrics.

export const healthConfig = {
  // Which governed definitions are approved. A governed metric NOT listed here
  // is treated as unapproved (bad) even if a definition exists.
  approved: ['qualified_pipeline', 'nrr', 'mktg_pipeline', 'closed_won', 'win_rate'],

  // Per-metric freshness SLA (hours). Missing => freshness "n/a", never green.
  slaHours: {
    qualified_pipeline: 6,
    nrr: 24,
    mktg_pipeline: 24,
    closed_won: 6,
    win_rate: 6,
  },

  // Global thresholds (defaults applied to every metric).
  defaults: {
    fillThresholds: { good: 0.95, warn: 0.9 },
    volumeDriftBand: { good: 0.05, warn: 0.15 },
    distributionZ: { warn: 2, bad: 3 },
  },

  // Composite tiles: metric id -> named governed input metric ids (§5.7).
  composites: {
    win_rate: ['closed_won', 'qualified_pipeline'],
  },

  // Optional supersession notices (US-8).
  superseded: {
    // new_logo_arr: 'new_business_arr',
  },
};

/**
 * Resolve the effective config for a single metric (defaults + per-metric).
 * @param {string} metricId
 * @returns {{approved:boolean, slaHours:(number|null), fillThresholds, volumeDriftBand, distributionZ, compositeInputs:(string[]|null), supersededBy:(string|null)}}
 */
export function configForMetric(metricId) {
  const d = healthConfig.defaults;
  return {
    approved: healthConfig.approved.includes(metricId),
    slaHours: healthConfig.slaHours[metricId] ?? null,
    fillThresholds: d.fillThresholds,
    volumeDriftBand: d.volumeDriftBand,
    distributionZ: d.distributionZ,
    compositeInputs: healthConfig.composites[metricId] || null,
    supersededBy: healthConfig.superseded[metricId] || null,
  };
}
