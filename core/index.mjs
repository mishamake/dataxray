// core/index.mjs — the pure, DOM-free, I/O-free correctness heart.
// Both the provider endpoints and the widget SDK drive from exactly this.

export { sha256Hex } from './sha256.mjs';
export { normalizeSql } from './normalize.mjs';
export { lineDiff } from './diff.mjs';
export { fingerprint, fingerprintSql, compareFingerprint } from './fingerprint.mjs';
export { computeHealth } from './health.mjs';
export {
  deriveStatus,
  badFlavor,
  worstOf,
  rollupComposite,
  STATUS_LABEL,
  STATUSES,
} from './verdict.mjs';
export { assembleLlmNarrationInput } from './llm.mjs';
export { VERDICT, driftVerdict, computeVerdict, verdictLabel } from './govern.mjs';
