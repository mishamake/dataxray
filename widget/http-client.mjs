// widget/http-client.mjs
// HTTP transport for the widget client — the production path. The browser
// talks ONLY to the team's thin proxy (server.mjs), which holds the cnst_
// token and relays to the hosted nest. Same method surface as the in-process
// client, so the widget doesn't know or care which transport it's on.

export function createHttpClient(baseUrl = '') {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const e = new Error(`proxy ${method} ${path} -> ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  return {
    /* ------------------------- v1 read endpoints ------------------------ */
    provenance: (id) => call('GET', `/api/provenance/${encodeURIComponent(id)}`),
    stats: (id) => call('GET', `/api/stats/${encodeURIComponent(id)}`),
    health: (id) => call('GET', `/api/health/${encodeURIComponent(id)}`),

    /* ---------------------- v2 governance endpoints --------------------- */
    hasGovernance: () => true,
    governance: (id, opts = {}) =>
      call('GET', `/api/governance/${encodeURIComponent(id)}` +
        (opts.personaHandle ? `?persona=${encodeURIComponent(opts.personaHandle)}` : '')),

    /* --------------------------- v2 intents ----------------------------- */
    postComment: (id, payload) => call('POST', `/api/intent/${encodeURIComponent(id)}/comment`, payload),
    resolveComment: (id, commentId) => call('POST', `/api/intent/${encodeURIComponent(id)}/resolve`, { commentId }),
    propose: (id, payload) => call('POST', `/api/intent/${encodeURIComponent(id)}/propose`, payload),
    approve: (id, payload) => call('POST', `/api/intent/${encodeURIComponent(id)}/approve`, payload),
    reject: (id, payload) => call('POST', `/api/intent/${encodeURIComponent(id)}/reject`, payload),

    // Outage is detected, not simulated, in production; these exist for parity.
    setOutage() {},
    isOutage: () => false,
  };
}
