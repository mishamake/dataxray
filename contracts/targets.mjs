// contracts/targets.mjs
// Code-owned target registry: every card, chart, table and section a person can
// share or comment on, keyed by a permanent ID and mapped to the source file and
// component that renders it. That source mapping is what lets an agent go from a
// comment to the code without guessing.
//
// Never derive IDs from labels, DOM paths or list positions.

import { FEEDBACK_KINDS } from './feedback-context.mjs';

/**
 * @typedef {'metric'|'chart'|'table'|'section'} FeedbackKind
 * @typedef {{label:string, kind:FeedbackKind, source:{file:string, component:string}, metricId?:string}} TargetDefinition
 * @typedef {(dashboardId:string, id:string, input?:unknown) => TargetDefinition|null} DynamicTargetResolver
 */

export function createTargetRegistry() {
  /** @type {Map<string, Map<string, TargetDefinition>>} */
  const targets = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const aliases = new Map();
  /** @type {Map<string, DynamicTargetResolver[]>} */
  const resolvers = new Map();

  const forDashboard = (map, id) => map.get(id) ?? map.set(id, new Map()).get(id);

  return {
    /**
     * Register a static target. Re-registering an ID with a different kind or metric
     * throws: IDs are permanent and never recycled.
     */
    add(dashboardId, id, { label, kind, source, metricId }) {
      if (!dashboardId || !id) throw new TypeError('dashboardId and id are required.');
      if (!FEEDBACK_KINDS.includes(kind)) throw new TypeError(`Unknown target kind "${kind}".`);
      if (!source?.file || !source?.component) throw new TypeError('source {file, component} is required.');
      const existing = targets.get(dashboardId)?.get(id);
      if (existing && (existing.kind !== kind || existing.metricId !== metricId))
        throw new Error(`Target "${dashboardId}/${id}" is already registered with a different meaning.`);
      forDashboard(targets, dashboardId).set(id, Object.freeze({ label, kind, source: Object.freeze({ ...source }), ...(metricId ? { metricId } : {}) }));
      return this;
    },
    /** Keep old links working after a target is replaced or moved. */
    alias(dashboardId, oldId, newId) {
      forDashboard(aliases, dashboardId).set(oldId, newId);
      return this;
    },
    /** IDs generated from configuration (e.g. one per tracked domain). */
    addResolver(dashboardId, resolver) {
      (resolvers.get(dashboardId) ?? resolvers.set(dashboardId, []).get(dashboardId)).push(resolver);
      return this;
    },
    /**
     * @param {string} dashboardId
     * @param {string} id
     * @param {unknown} [input] host-supplied data for dynamic resolvers
     * @returns {TargetDefinition|null}
     */
    resolve(dashboardId, id, input) {
      const resolvedId = aliases.get(dashboardId)?.get(id) ?? id;
      const found = targets.get(dashboardId)?.get(resolvedId);
      if (found) return found;
      for (const resolver of resolvers.get(dashboardId) ?? []) {
        const dynamic = resolver(dashboardId, resolvedId, input);
        if (dynamic) return dynamic;
      }
      return null;
    },
    /** Resolution entries for an agent: current source, or explicitly unresolved. */
    resolveContext(dashboardId, context, input) {
      return (context?.targets ?? []).map(({ id }) => {
        const t = this.resolve(dashboardId, id, input);
        return t ? { id, status: 'current', label: t.label, kind: t.kind, ...(t.metricId ? { metricId: t.metricId } : {}), source: t.source }
          : { id, status: 'unresolved' };
      });
    },
    dashboards() { return [...targets.keys()]; },
    list(dashboardId) { return [...(targets.get(dashboardId) ?? new Map())].map(([id, t]) => ({ id, ...t })); },
  };
}
