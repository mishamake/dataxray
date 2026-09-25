// contracts/ports.mjs
// Interfaces a host implements so dashboards inherit receipts, approvals, feedback,
// share links and agent access. DataXray defines the shapes; the host owns identity,
// storage and access policy. Nothing here performs I/O.
//
// Trust rules every implementation must keep:
//   - The actor always comes from the host's verified session. Never accept an
//     author name or ID supplied by the client.
//   - Agent actions set actor.viaAgent = true; the client cannot supply it.
//   - No machine self-approval: only a human actor may approve a definition.
//   - Approval requires verifiable evidence (see isVerifiableEvidence).

import { createTargetRegistry } from './targets.mjs';
import { resolveApprovals, definitionApprovalRequired } from './approvals.mjs';

/**
 * @typedef {{tenant:string, oid:string, name:string, email?:string, viaAgent?:boolean}} Actor
 * @typedef {{dashboardId:string, metricId?:string}} Scope
 *
 * @typedef {object} ActorResolver
 * @property {() => Promise<Actor>} current   verified session actor; throw when signed out
 *
 * @typedef {object} ScopePolicy
 * @property {(actor:Actor, scope:Scope) => boolean|Promise<boolean>} canView
 * @property {(actor:Actor, scope:Scope) => boolean|Promise<boolean>} canApprove
 *           definition approval; decide deliberately (owners/stewards vs any viewer).
 *           Must return false when definition approval is off for that metric.
 * @property {(actor:Actor) => boolean} isBuilder   may submit feedback work for review
 *
 * @typedef {object} GovernanceStore
 * Backed by Context Nest (provider/governance.mjs) or a host database.
 * @property {(scopes:Scope[]) => Promise<Record<string, import('../core/evidence.mjs').GovernanceState>>} read
 * @property {(actor:Actor, scope:Scope, p:{fingerprint:string, revision:number}) => Promise<unknown>} approve
 * @property {(actor:Actor, scope:Scope, p:{revision:number}) => Promise<unknown>} revoke
 * @property {(actor:Actor, scope:Scope, p:{reviewerId:string, fingerprint:string, revision:number}) => Promise<unknown>} requestReview
 * @property {(actor:Actor, scope:Scope, p:{reason:string, revision:number}) => Promise<unknown>} reject
 * @property {(actor:Actor, scope:Scope, p:{note?:string, revision:number}) => Promise<unknown>} decline
 * @property {(scope:Scope) => Promise<unknown[]>} history
 *
 * @typedef {object} CommentStore
 * @property {(actor:Actor, scope:Scope, p:{body:string, requestId:string, context?:unknown, parentId?:number}) => Promise<unknown>} create
 * @property {(actor:Actor, scope:Scope, p:{before?:number, group?:'active'|'completed'}) => Promise<unknown>} list
 * @property {(actor:Actor, scope:Scope, p:{id:number, body:string, revision:number}) => Promise<unknown>} edit
 * @property {(actor:Actor, scope:Scope, p:{id:number}) => Promise<void>} remove
 * @property {(actor:Actor, scope:Scope, p:{id:number, status:string, revision:number, feedback?:string}) => Promise<unknown>} changeStatus
 *           must enforce contracts/workflow.mjs planStatusChange
 * @property {(actor:Actor, scope:Scope, p:{id:number, reviewerIds:string[], revision:number}) => Promise<unknown>} setReviewers
 *
 * @typedef {object} NotificationSink
 * @property {(event:{kind:string, recipients:string[], scope:Scope, commentId?:number, replyId?:number}) => Promise<void>} notify
 *
 * @typedef {object} EvidenceResolver
 * @property {(scope:Scope, view:Record<string,string>) => Promise<import('../core/evidence.mjs').MetricEvidence[]>} resolve
 */

export const PORT_METHODS = Object.freeze({
  actors: ['current'],
  policy: ['canView', 'canApprove', 'isBuilder'],
  governance: ['read', 'approve', 'revoke', 'requestReview', 'reject', 'decline', 'history'],
  comments: ['create', 'list', 'edit', 'remove', 'changeStatus', 'setReviewers'],
  notifications: ['notify'],
  evidence: ['resolve'],
});

/** Throw a precise error when an implementation is missing a method. */
export function assertPort(name, impl) {
  const methods = PORT_METHODS[name];
  if (!methods) throw new TypeError(`Unknown port "${name}".`);
  const missing = methods.filter((m) => typeof impl?.[m] !== 'function');
  if (missing.length) throw new TypeError(`Port "${name}" is missing: ${missing.join(', ')}.`);
  return impl;
}

const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/**
 * One declaration per dashboard. Registers its metrics and targets and validates
 * the configuration up front so a mistake fails at startup, not in front of a user.
 *
 * @param {object} d
 * @param {string} d.id                           permanent dashboard ID
 * @param {string} d.title
 * @param {string[]} d.metrics                    permanent metric IDs with receipts/discussions
 * @param {Record<string, import('./targets.mjs').TargetDefinition>} [d.targets]
 * @param {Record<string, string>} [d.aliases]    oldId → newId, keeps old links working
 * @param {import('./targets.mjs').DynamicTargetResolver} [d.resolveTarget]
 * @param {Record<string, readonly string[]>} [d.viewChoices]  allowed values per share-link control
 * @param {import('./approvals.mjs').ApprovalConfig} [d.approvals]  optional; both kinds default on
 * @param {ReturnType<typeof createTargetRegistry>} [registry]  shared host registry
 */
export function defineDashboard(d, registry = createTargetRegistry()) {
  if (!d || !ID.test(d.id ?? '')) throw new TypeError('Dashboard id must be a lowercase permanent identifier.');
  if (!d.title) throw new TypeError(`Dashboard "${d.id}" needs a title.`);
  const metrics = [...new Set(d.metrics ?? [])];
  if (metrics.length !== (d.metrics ?? []).length) throw new TypeError(`Dashboard "${d.id}" lists a metric twice.`);
  for (const [id, target] of Object.entries(d.targets ?? {})) {
    if (target.metricId && !metrics.includes(target.metricId))
      throw new TypeError(`Target "${id}" refers to unregistered metric "${target.metricId}".`);
    registry.add(d.id, id, target);
  }
  for (const [oldId, newId] of Object.entries(d.aliases ?? {})) registry.alias(d.id, oldId, newId);
  const approvals = resolveApprovals(d.approvals);
  for (const metricId of Object.keys(approvals.metrics)) {
    if (!metrics.includes(metricId)) throw new TypeError(`approvals.metrics refers to unregistered metric "${metricId}".`);
  }
  if (d.resolveTarget) registry.addResolver(d.id, d.resolveTarget);
  return Object.freeze({
    id: d.id,
    title: d.title,
    metrics: Object.freeze(metrics),
    viewChoices: Object.freeze({ ...(d.viewChoices ?? {}) }),
    approvals,
    registry,
    /** Pass as governedEvidence(e, state, {approvals: dashboard.definitionApprovals(id)}). */
    definitionApprovals(metricId) { return definitionApprovalRequired(approvals, metricId); },
    /** Pass as planStatusChange({... requireReview: dashboard.feedbackReview}). */
    get feedbackReview() { return approvals.feedback; },
    /** Is this a registered scope? Unknown dashboard/metric scopes must be rejected. */
    hasScope(scope) {
      return scope?.dashboardId === d.id && (scope.metricId === undefined || scope.metricId === '' || metrics.includes(scope.metricId));
    },
    resolveTarget(id, input) { return registry.resolve(d.id, id, input); },
  });
}
