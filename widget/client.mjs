// widget/client.mjs
// The front-end's ONLY door to data — the endpoint client. It holds no
// warehouse credentials and no nest token; it calls the provider endpoints
// (v1: provenance/stats/health; v2: governance + governed intents). In the
// demo those endpoints are in-process; behind the proxy they're HTTP — same
// shapes either way. Also models the loud "provider unavailable" transport
// state, distinct from unmapped: fail loud, never silent-green.

import { provider as defaultProvider } from '../provider/provider.mjs';

export function createClient(provider = defaultProvider, governance = null) {
  let outage = false;

  async function guard(kind, fn) {
    if (outage) {
      return { unavailable: true, status: 'unavailable', verdict: 'stale', kind };
    }
    try {
      const res = await fn();
      return res;
    } catch (err) {
      // A thrown endpoint == provider unreachable. Fail loud, never silent-green.
      return { unavailable: true, status: 'unavailable', verdict: 'stale', kind, error: String(err && err.message || err) };
    }
  }

  return {
    /* ------------------------- v1 read endpoints ------------------------ */
    provenance: (id, opts) => guard('provenance', () => provider.getProvenance(id, opts)),
    stats: (id, opts) => guard('stats', () => provider.getStats(id, opts)),
    health: (id, opts) => guard('health', () => provider.getHealth(id, opts)),

    /* ---------------------- v2 governance endpoints --------------------- */
    hasGovernance: () => governance != null,
    governance: (id, opts) =>
      governance
        ? guard('governance', () => governance.getGovernance(id, opts))
        : Promise.resolve({ unavailable: true, kind: 'governance', error: 'no governance source configured' }),

    /* --------------------------- v2 intents ----------------------------- */
    postComment: (id, payload) => guard('postComment', () => governance.postComment(id, payload)),
    resolveComment: (id, commentId) => guard('resolveComment', () => governance.resolveComment(id, commentId)),
    propose: (id, payload) => guard('propose', () => governance.propose(id, payload)),
    approve: (id, payload) => guard('approve', () => governance.approve(id, payload)),
    reject: (id, payload) => guard('reject', () => governance.reject(id, payload)),

    setOutage(v) {
      outage = !!v;
    },
    isOutage() {
      return outage;
    },
  };
}
