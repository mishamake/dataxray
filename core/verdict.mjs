// core/verdict.mjs
// Deterministic verdict derivation + the worst-of composite gate (PRD §5.1,5.4,5.6).
// The LLM is NEVER an input here. Status comes only from deterministic signals.

export const STATUSES = ['unknown', 'ok', 'warn', 'bad'];
const RANK = { unknown: 0, ok: 1, warn: 2, bad: 3 };

export const STATUS_LABEL = { ok: 'Certified', warn: 'Stale', bad: 'Flagged', unknown: 'Unmapped' };

/**
 * Worst-of over a list of statuses. Seeds at 'ok' so an all-ok input stays ok;
 * any red wins. A good signal can NEVER dilute a bad one (no averaging).
 * @param {string[]} statuses
 * @returns {string}
 */
export function worstOf(statuses) {
  let worst = 'ok';
  for (const s of statuses) {
    if (RANK[s] != null && RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * Composite rollup over named input metric statuses (PRD §5.6).
 * @param {string[]} inputStatuses
 * @returns {string}
 */
export function rollupComposite(inputStatuses) {
  if (!inputStatuses || inputStatuses.length === 0) return 'ok';
  // An unmapped/missing input makes the composite honest-partial, not falsely ok.
  if (inputStatuses.some((s) => s === 'unknown')) return 'unknown';
  return worstOf(inputStatuses);
}

/**
 * Derive the canonical deterministic status.
 * @param {object} p
 * @param {boolean} p.mapped        resolved to a metric id at all
 * @param {boolean} p.governed      a governed definition exists in the nest
 * @param {boolean} p.approved      the definition is approved in the health config
 * @param {object}  p.driftResult   { drifted, hasApprovedFingerprint }
 * @param {{pass:boolean}[]} p.tests  hard dbt tests (not_null/unique/accepted_values/relationships)
 * @param {object}  p.freshness     { breached }
 * @param {string[]} [p.inputStatuses] composite input statuses
 * @returns {string} 'ok' | 'warn' | 'bad' | 'unknown'
 */
export function deriveStatus(p) {
  const {
    mapped,
    governed,
    approved,
    driftResult,
    tests = [],
    freshness = {},
    inputStatuses = [],
  } = p || {};

  // Unmapped: no metric id — honest unknown, never a fabricated verdict.
  if (!mapped) return 'unknown';

  const signals = [];

  // Governance / approval / drift — the trust core.
  if (!governed) {
    signals.push('bad'); // no governed definition => unapproved flavor
  } else if (!approved) {
    signals.push('bad'); // definition exists but not approved in config
  } else if (!driftResult || !driftResult.hasApprovedFingerprint) {
    signals.push('bad'); // governed but no approved fingerprint => unapproved (§5.3 edge)
  } else if (driftResult.drifted) {
    signals.push('bad'); // fingerprint mismatch => drift
  }

  // Hard dbt test failures are data-quality reds.
  if (tests.some((t) => !t.pass)) signals.push('bad');

  // Freshness breach: meaning intact, value stale => amber.
  if (freshness && freshness.breached) signals.push('warn');

  // Composite inputs (worst-of).
  for (const s of inputStatuses) signals.push(s);

  if (signals.length === 0) return 'ok';
  return worstOf(signals);
}

/**
 * The flavor of a 'bad' verdict, for plain-language wording. Deterministic.
 * @returns {'drift'|'unapproved'|'test'|null}
 */
export function badFlavor(p) {
  if (!p) return null;
  if (!p.governed) return 'unapproved';
  if (!p.approved) return 'unapproved';
  if (p.driftResult && !p.driftResult.hasApprovedFingerprint) return 'unapproved';
  if (p.driftResult && p.driftResult.drifted) return 'drift';
  if ((p.tests || []).some((t) => !t.pass)) return 'test';
  return null;
}
