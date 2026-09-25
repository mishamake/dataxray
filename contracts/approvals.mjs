// contracts/approvals.mjs
// Approvals are optional, per dashboard and per metric. Two kinds:
//
//   definitions — a human approves a metric's definition fingerprint (DataXray
//                 governance). Off → numbers show 'ungoverned' instead of
//                 'awaiting approval'. Health checks still apply.
//   feedback    — a reviewer approves a builder's work before a comment closes.
//                 Off → a builder may close their own work directly.
//
// Defaults keep both ON, so omitting the config never weakens an existing host.
//
//   approvals: false                                    // both off
//   approvals: { feedback: false }                      // definitions on, feedback off
//   approvals: { definitions: false, metrics: { 'x.revenue': true } }  // opt-in per metric
//   approvals: { source: 'nest' }                       // where definition approvals live

export const APPROVAL_SOURCES = Object.freeze(['nest', 'host']);

/**
 * @typedef {{definitions?:boolean, feedback?:boolean, metrics?:Record<string, boolean>, source?:'nest'|'host'}} ApprovalConfigObject
 * @typedef {boolean|ApprovalConfigObject|undefined} ApprovalConfig
 * @typedef {Readonly<{definitions:boolean, feedback:boolean, metrics:Readonly<Record<string, boolean>>, source:'nest'|'host'}>} ResolvedApprovals
 */

/**
 * Normalize any accepted config shape. Throws on unknown keys or non-boolean flags
 * so a typo can't silently turn approvals off.
 * @param {ApprovalConfig} config
 * @returns {ResolvedApprovals}
 */
export function resolveApprovals(config) {
  if (config === undefined || config === true) config = {};
  if (config === false) config = { definitions: false, feedback: false };
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('approvals must be a boolean or an object.');
  const extra = Object.keys(config).find((k) => !['definitions', 'feedback', 'metrics', 'source'].includes(k));
  if (extra) throw new TypeError(`Unknown approvals option "${extra}".`);
  const { definitions = true, feedback = true, metrics = {}, source = 'host' } = config;
  if (typeof definitions !== 'boolean' || typeof feedback !== 'boolean') throw new TypeError('approvals.definitions and approvals.feedback must be booleans.');
  if (!APPROVAL_SOURCES.includes(source)) throw new TypeError(`approvals.source must be one of: ${APPROVAL_SOURCES.join(', ')}.`);
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics) || Object.values(metrics).some((v) => typeof v !== 'boolean'))
    throw new TypeError('approvals.metrics must map metric IDs to booleans.');
  return Object.freeze({ definitions, feedback, metrics: Object.freeze({ ...metrics }), source });
}

/** Is definition approval required for this metric? Per-metric override wins. */
export function definitionApprovalRequired(approvals, metricId) {
  const resolved = resolveApprovals(approvals); // idempotent on an already-resolved config
  return metricId !== undefined && Object.hasOwn(resolved.metrics, metricId) ? resolved.metrics[metricId] : resolved.definitions;
}
