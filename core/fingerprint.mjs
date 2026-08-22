// core/fingerprint.mjs
// The deterministic definition-vs-implementation drift check (PRD §5.3).
// normalize -> SHA-256 -> compare. No LLM, no timestamps, no human toggle.

import { normalizeSql } from './normalize.mjs';
import { sha256Hex } from './sha256.mjs';
import { lineDiff } from './diff.mjs';

/**
 * Fingerprint an already-normalized SQL string.
 * @param {string} normalizedString
 * @returns {string} "sha256:<hex>"
 */
export function fingerprint(normalizedString) {
  return 'sha256:' + sha256Hex(normalizedString);
}

/**
 * Convenience: normalize then fingerprint raw compiled SQL.
 * This is the SAME path used to record the approved fingerprint and to check
 * the current one — that identity is what guarantees reproducibility.
 * @param {string} rawSql
 * @returns {string} "sha256:<hex>"
 */
export function fingerprintSql(rawSql) {
  return fingerprint(normalizeSql(rawSql));
}

/**
 * Compare the current compiled SQL to the approved definition.
 * @param {string} currentCompiledSql
 * @param {{fingerprint?:string|null, sql?:string|null}|string|null} approved
 *        The nest's approved record. Object form carries the approved
 *        fingerprint (recorded at approval time) and the approved SQL (for the
 *        diff). A bare string is treated as the approved fingerprint.
 * @returns {{drifted:boolean, hasApprovedFingerprint:boolean,
 *            currentFingerprint:string, approvedFingerprint:string|null,
 *            diff:{t:string,s:string}[]}}
 */
export function compareFingerprint(currentCompiledSql, approved) {
  const currentFingerprint = fingerprintSql(currentCompiledSql);

  let approvedFingerprint = null;
  let approvedSql = null;
  if (typeof approved === 'string') {
    approvedFingerprint = approved || null;
  } else if (approved && typeof approved === 'object') {
    approvedFingerprint = approved.fingerprint || null;
    approvedSql = approved.sql != null ? approved.sql : null;
  }

  const hasApprovedFingerprint = !!approvedFingerprint;
  const drifted = hasApprovedFingerprint && currentFingerprint !== approvedFingerprint;
  const diff = drifted && approvedSql != null ? lineDiff(approvedSql, currentCompiledSql) : [];

  return { drifted, hasApprovedFingerprint, currentFingerprint, approvedFingerprint, diff };
}
