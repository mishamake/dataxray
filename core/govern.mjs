// core/govern.mjs
// v2 governance core — pure, DOM-free, I/O-free (PRD §5.2, §5.3, §5.5).
// TWO fingerprints, never conflated:
//   fpCurrent  — fingerprint recorded in the node's CURRENT version (by the ingester)
//   fpApproved — fingerprint recorded in the node's APPROVED version (frozen at the
//                last human `approve`; the ingester NEVER writes it here)
// The core is FED both already-computed fingerprints. It never fetches, never
// re-hashes across the network, never moves a baseline. Same input -> same output.

export const VERDICT = Object.freeze({
  STALE: 'stale',
  PENDING: 'pending',
  CERTIFIED: 'certified',
  DRIFTED: 'drifted',
  UNCERTIFIED: 'uncertified',
});

/**
 * Pure drift compare of two ALREADY-computed fingerprints (§5.3).
 * @param {string|null} fpCurrent  fingerprint@currentVersion
 * @param {string|null} fpApproved fingerprint@approvedVersion (the human-blessed baseline)
 * @returns {'MATCH'|'DRIFT'|'UNKNOWN'}  UNKNOWN when either side is absent —
 *          you cannot claim drift without a baseline AND a current fingerprint.
 */
export function driftVerdict(fpCurrent, fpApproved) {
  if (fpCurrent == null || fpCurrent === '' || fpApproved == null || fpApproved === '') {
    return 'UNKNOWN';
  }
  return fpCurrent === fpApproved ? 'MATCH' : 'DRIFT';
}

/**
 * Verdict precedence rollup — the single source of truth for the badge (§5.5).
 * Computed in this order; first match wins:
 *   1. STALE      — provider unreachable OR ingest stale OR current fingerprint missing
 *   2. UNCERTIFIED— no human-approved baseline yet (never green; awaits first approval, §5.10)
 *   3. PENDING    — fingerprints MATCH and an open review exists
 *   4. CERTIFIED  — fingerprints MATCH, fresh, no open review
 *   5. DRIFTED    — fingerprints MISMATCH, fresh
 *
 * Everything I/O-shaped (reachability, freshness, review-open) is resolved by the
 * provider and passed in as plain booleans. No I/O here.
 *
 * FAIL-LOUD DEFAULTS (never silent-green): the two safety-critical inputs default
 * to the DEGRADED state — reachability and freshness must be affirmatively proven
 * by the provider, never assumed. A caller that passes nothing gets STALE.
 *
 * @param {object} p
 * @param {string|null} p.fpCurrent
 * @param {string|null} p.fpApproved
 * @param {boolean} p.hasApprovedBaseline  is there an approvedVersion at all
 * @param {boolean} p.ingestFresh          heartbeat within the staleness threshold
 * @param {boolean} p.providerReachable    the nest/API responded
 * @param {boolean} p.reviewOpen           a review is pending on the node
 * @returns {'stale'|'uncertified'|'pending'|'certified'|'drifted'}
 */
export function computeVerdict(p = {}) {
  const {
    fpCurrent = null,
    fpApproved = null,
    hasApprovedBaseline = false,
    ingestFresh = false,
    providerReachable = false,
    reviewOpen = false,
  } = p;

  // 1. STALE — loud, never silent-green (§5.4, §5.7). Outranks everything.
  if (providerReachable === false) return VERDICT.STALE;
  if (ingestFresh === false) return VERDICT.STALE;
  if (fpCurrent == null || fpCurrent === '') return VERDICT.STALE;

  // 2. No human-approved baseline yet — not certified, never green (§5.10).
  if (!hasApprovedBaseline || fpApproved == null || fpApproved === '') return VERDICT.UNCERTIFIED;

  const match = driftVerdict(fpCurrent, fpApproved) === 'MATCH';

  // 3. PENDING — a change is in review but the number still matches the baseline.
  if (match && reviewOpen) return VERDICT.PENDING;
  // 4. CERTIFIED — match, fresh, nothing in review.
  if (match) return VERDICT.CERTIFIED;
  // 5. DRIFTED — mismatch. Stays DRIFTED even while a re-approval is in review
  //    (the label, not the verdict, notes the pending review).
  return VERDICT.DRIFTED;
}

/**
 * Canonical, deterministic badge/banner copy for a verdict (presentation-neutral).
 * @param {string} verdict
 * @param {{reviewOpen?:boolean}} [opts]
 * @returns {string}
 */
export function verdictLabel(verdict, opts = {}) {
  const reviewOpen = !!opts.reviewOpen;
  switch (verdict) {
    case VERDICT.CERTIFIED:
      return 'Certified & current';
    case VERDICT.DRIFTED:
      return reviewOpen ? 'Drifted · re-approval in review' : 'Drifted';
    case VERDICT.PENDING:
      return 'Change pending review';
    case VERDICT.STALE:
      return "Stale · can't confirm current";
    case VERDICT.UNCERTIFIED:
      return 'Awaiting first approval';
    default:
      return 'Unknown';
  }
}
