// core/health.mjs
// Config-driven health diagnostics (PRD §5.5). Pure: numbers in, states out.
// Missing signal => state 'unavailable', NEVER a fabricated value or green default.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * @param {object} stats     profiling for the metric (rows, mu, sigma, lastLoadedAt, rowCount, baselines)
 * @param {object} config    resolved health config for the metric (thresholds, slaHours, band)
 * @param {object} meta      { now?:number } — 'now' is injected for determinism in tests
 * @returns {{fill,freshness,distribution,volumeDrift}} each {value,note,state,level}
 */
export function computeHealth(stats = {}, config = {}, meta = {}) {
  return {
    fill: computeFill(stats, config),
    freshness: computeFreshness(stats, config, meta),
    distribution: computeDistribution(stats, config),
    volumeDrift: computeVolumeDrift(stats, config),
  };
}

function na(note) {
  return { value: 'n/a', note: note || 'not available', state: 'unavailable', level: 0 };
}

function computeFill(stats, config) {
  const { totalRows, nonNullRows } = stats;
  if (totalRows == null || nonNullRows == null || totalRows === 0) return na('not profiled');
  const ratio = nonNullRows / totalRows;
  const t = config.fillThresholds || { good: 0.95, warn: 0.9 };
  const state = ratio >= t.good ? 'good' : ratio >= t.warn ? 'warn' : 'bad';
  return {
    value: (ratio * 100).toFixed(1) + '%',
    note: `${fmtInt(nonNullRows)} / ${fmtInt(totalRows)} rows`,
    state,
    level: clamp01(ratio),
  };
}

function computeFreshness(stats, config, meta) {
  const slaHours = config.slaHours;
  if (slaHours == null) return na('no SLA configured');
  if (stats.lastLoadedAt == null) return na('never loaded');
  const now = meta.now == null ? Date.now() : meta.now;
  const ageMs = now - toMs(stats.lastLoadedAt);
  const slaMs = slaHours * HOUR;
  const breached = ageMs > slaMs;
  return {
    value: humanizeAge(ageMs),
    note: breached
      ? `SLA: ${slaHours}h · BREACHED`
      : `SLA: ${slaHours}h · on time`,
    state: breached ? 'bad' : 'good',
    // level = how much of the SLA budget is spent (capped)
    level: clamp01(1 - Math.min(ageMs, slaMs * 2) / (slaMs * 2)),
    breached,
  };
}

function computeDistribution(stats, config) {
  const { mu, sigma, baselineMu, baselineSigma } = stats;
  if (mu == null) return na('not profiled');
  const muStr = fmtStat(mu);
  const sigStr = sigma == null ? '' : ` · σ ${fmtStat(sigma)}`;
  if (baselineMu == null) {
    return { value: `μ ${muStr}${sigStr}`, note: 'no baseline to compare', state: 'good', level: 0.8 };
  }
  const denom = baselineSigma || sigma || Math.abs(baselineMu) || 1;
  const z = Math.abs(mu - baselineMu) / denom;
  const bands = config.distributionZ || { warn: 2, bad: 3 };
  const state = z >= bands.bad ? 'bad' : z >= bands.warn ? 'warn' : 'good';
  const note =
    state === 'good'
      ? 'no distribution drift'
      : `shifted ${((mu - baselineMu) >= 0 ? '+' : '')}${fmtStat(mu - baselineMu)} vs baseline`;
  return { value: `μ ${muStr}${sigStr}`, note, state, level: clamp01(1 - z / (bands.bad * 1.5)) };
}

function computeVolumeDrift(stats, config) {
  const { rowCount, baselineRowCount } = stats;
  if (rowCount == null || baselineRowCount == null || baselineRowCount === 0) return na('no baseline');
  const pct = (rowCount - baselineRowCount) / baselineRowCount;
  const band = config.volumeDriftBand || { good: 0.05, warn: 0.15 };
  const abs = Math.abs(pct);
  const state = abs <= band.good ? 'good' : abs <= band.warn ? 'warn' : 'bad';
  return {
    value: `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`,
    note: state === 'good' ? `within ±${(band.good * 100).toFixed(0)}% band` : 'outside expected band',
    state,
    level: clamp01(1 - abs / (band.warn * 2)),
  };
}

/* ---------- formatting helpers (presentation-neutral, no DOM) ---------- */

function toMs(t) {
  if (typeof t === 'number') return t;
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function humanizeAge(ms) {
  if (ms < 0) ms = 0;
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min ago`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h ago`;
  return `${Math.round(ms / DAY)} days ago`;
}

function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

function fmtStat(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
  return String(Math.round(n * 10) / 10);
}

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
