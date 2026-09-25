// core/evidence.mjs
// The metric-evidence contract a host dashboard produces for each displayed number,
// plus the pure rules that turn evidence into a verdict and a presentation status.
// Pure, DOM-free, I/O-free. Identical in Node and the browser.
//
// Evidence is produced by the host's own data provider (a CRM report, a warehouse,
// dbt, ...). DataXray never fetches it. Approval state is supplied separately so a
// cached number can never cache an old approval.

import { sha256Hex } from './sha256.mjs';
import { fingerprintSql } from './fingerprint.mjs';
import { computeVerdict, VERDICT } from './govern.mjs';

/** Default max age for live evidence before it is treated as stale (5 minutes). */
export const DEFAULT_EVIDENCE_MAX_AGE_MS = 5 * 60_000;

/**
 * @typedef {'certified'|'uncertified'|'pending'|'drifted'|'stale'|'ungoverned'} TrustVerdict
 * @typedef {{label:string, status:'pass'|'warn'|'fail', detail:string}} EvidenceCheck
 * @typedef {object} MetricEvidence
 * @property {string} id                 permanent metric ID (never derived from a title)
 * @property {string} title
 * @property {string} definition         human-readable definition
 * @property {'live'|'unavailable'} status
 * @property {'definition'|'source'} [unavailableReason] why a value is intentionally unavailable
 * @property {TrustVerdict} verdict
 * @property {'loading'|'ready'|'unavailable'} [governanceStatus]
 * @property {number|null} value
 * @property {'number'|'currency'|'percent'} format
 * @property {string|null} fingerprint           fingerprint of the current definition
 * @property {string|null} approvedFingerprint   fingerprint a human last approved
 * @property {string|null} retrievedAt           ISO timestamp the value was read
 * @property {string} [periodId]
 * @property {{start:string, end:string}} [dateWindow]
 * @property {string} period
 * @property {Array<{label:string, href?:string, definition:string}>} sources
 * @property {EvidenceCheck[]} checks
 * @property {string[]} caveats
 * @property {string} [message]
 */

/**
 * Canonical JSON: object keys sorted, undefined members dropped, case, values and
 * array order preserved. Use it to fingerprint non-SQL definitions (saved report
 * JSON, API query bodies) so the same definition always hashes the same way.
 * @param {unknown} value
 * @returns {string}
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      // localeCompare matches existing approved fingerprints; changing the key order
      // would mark every approved definition as drifted. Change only with a new
      // fingerprint version.
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Fingerprint any definition. SQL goes through the same normalize path as dbt
 * ingest; everything else is canonical JSON. Both return "sha256:<hex>".
 * @param {unknown} value
 * @param {'report'|'sql'} [kind]
 * @returns {string}
 */
export function definitionFingerprint(value, kind = 'report') {
  return kind === 'sql' ? fingerprintSql(String(value)) : 'sha256:' + sha256Hex(stableJson(value));
}

/**
 * Zero is valid; missing, invalid and future timestamps are not fresh.
 * @param {{retrievedAt:string|null|undefined}} evidence
 * @param {number} [now]
 * @param {number} [maxAgeMs]
 */
export function isEvidenceFresh(evidence, now = Date.now(), maxAgeMs = DEFAULT_EVIDENCE_MAX_AGE_MS) {
  const age = now - Date.parse(evidence?.retrievedAt ?? '');
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

/** @param {{status:string, value:number|null}} evidence */
export function isEvidenceAvailable(evidence) {
  return evidence?.status === 'live' && evidence.value !== null && Number.isFinite(evidence.value);
}

/** Available, fresh and fingerprinted: the only evidence a human may approve. */
export function isVerifiableEvidence(evidence, now = Date.now(), maxAgeMs = DEFAULT_EVIDENCE_MAX_AGE_MS) {
  return !!evidence && !!evidence.fingerprint && isEvidenceAvailable(evidence) && isEvidenceFresh(evidence, now, maxAgeMs);
}

/**
 * @typedef {{by:string, at:string, fingerprint:string}} DefinitionApproval
 * @typedef {{by:string, at:string, reviewer:string, reviewerId?:string, fingerprint:string}} ReviewRequest
 * @typedef {{revision:number, approval:DefinitionApproval|null, review:ReviewRequest|null}} GovernanceState
 */

/** @type {Readonly<GovernanceState>} */
export const EMPTY_GOVERNANCE = Object.freeze({ revision: 0, approval: null, review: null });

/**
 * Apply human approval state to host evidence and recompute the verdict with the
 * existing precedence (computeVerdict). Approval never changes the value.
 * Pass available=false when the governance store could not be read: the verdict
 * degrades to stale instead of showing an unconfirmed approval.
 *
 * Pass approvals=false when the host has turned definition approval off for this
 * metric (see contracts/approvals.mjs). Health rules still apply: unavailable or
 * old data is stale; otherwise the verdict is 'ungoverned', never 'certified'.
 * @param {Omit<MetricEvidence,'verdict'>|MetricEvidence} evidence
 * @param {GovernanceState} [state]
 * @param {{available?:boolean, approvals?:boolean, now?:number, maxAgeMs?:number}} [opts]
 * @returns {MetricEvidence}
 */
export function governedEvidence(evidence, state = EMPTY_GOVERNANCE, opts = {}) {
  const { available = true, approvals = true, now = Date.now(), maxAgeMs = DEFAULT_EVIDENCE_MAX_AGE_MS } = opts;
  if (approvals === false) {
    const current = isEvidenceAvailable(evidence) && isEvidenceFresh(evidence, now, maxAgeMs);
    return { ...evidence, approvedFingerprint: null, verdict: current ? VERDICT.UNGOVERNED : VERDICT.STALE };
  }
  const approvedFingerprint = available ? state?.approval?.fingerprint ?? null : null;
  const verdict = computeVerdict({
    fpCurrent: evidence.fingerprint,
    fpApproved: approvedFingerprint,
    hasApprovedBaseline: !!approvedFingerprint,
    ingestFresh: isEvidenceFresh(evidence, now, maxAgeMs),
    providerReachable: available && isEvidenceAvailable(evidence),
    reviewOpen: !!state?.review,
  });
  return { ...evidence, approvedFingerprint, verdict };
}

/**
 * @typedef {'green'|'yellow'|'neutral'|'red'} StatusTone
 * @typedef {{label:string, tone:StatusTone}} EvidenceStatus
 */

/**
 * One presentation status per number, shared by tiles, icons and receipts.
 * Precedence: failed data checks > intentional unavailability > missing data >
 * governance loading/unavailable > verdict > warning checks > ungoverned > certified.
 * Health failures always outrank approval: an approved definition over broken
 * data is still red.
 * @param {MetricEvidence} evidence
 * @returns {EvidenceStatus}
 */
export function evidenceStatus(evidence) {
  const checks = evidence.checks ?? [];
  if (checks.some((c) => c.status === 'fail')) return { label: 'Failed data checks', tone: 'red' };
  if (evidence.status === 'unavailable' && evidence.unavailableReason) {
    return { label: evidence.unavailableReason === 'definition' ? 'Definition needed' : 'Source unavailable', tone: 'neutral' };
  }
  if (!isEvidenceAvailable(evidence)) return { label: 'Data unavailable', tone: 'red' };
  if (evidence.governanceStatus === 'loading') return { label: 'Checking approval…', tone: 'yellow' };
  if (evidence.governanceStatus === 'unavailable') return { label: 'Approval status unavailable', tone: 'red' };
  switch (evidence.verdict) {
    case 'stale': return { label: 'Unable to verify current data', tone: 'red' };
    case 'drifted': return { label: 'Definition changed—needs approval', tone: 'red' };
    case 'uncertified': return { label: 'Awaiting approval', tone: 'yellow' };
    case 'pending': return { label: 'In review', tone: 'yellow' };
  }
  if (checks.some((c) => c.status === 'warn')) return { label: 'Checks need review', tone: 'yellow' };
  // Neutral, not green: current data, but nobody has approved the definition.
  if (evidence.verdict === 'ungoverned') return { label: 'Current · approval not required', tone: 'neutral' };
  if (evidence.verdict === 'certified') return { label: 'Certified and current', tone: 'green' };
  return { label: 'Unknown', tone: 'red' };
}
