// provider/nest-client.mjs
// NestClient — the REAL HTTP adapter to a hosted Community Nest (v1.16.0
// contract, verified). Server/provider-side ONLY: it holds the `cnst_` Bearer
// token, which must never reach the browser. Same method surface as
// MockNestClient so the two are interchangeable behind the provider seam.
//
// Config: baseUrl + nestId + token (from env — see server.mjs / ingest.mjs).

function qs(params) {
  const p = Object.entries(params || {}).filter(([, v]) => v != null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
}

export function createNestClient({ baseUrl, nestId, token, fetchImpl } = {}) {
  if (!baseUrl) throw new Error('NestClient requires a baseUrl');
  if (!nestId) throw new Error('NestClient requires a nestId');
  if (!token) throw new Error('NestClient requires a token (cnst_…, server-side only)');
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('NestClient needs fetch (Node 18+ or inject fetchImpl)');

  const root = `${baseUrl.replace(/\/+$/, '')}/nests/${encodeURIComponent(nestId)}`;

  async function call(method, path, body) {
    const res = await doFetch(root + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const e = new Error((data && data.error) || `nest request failed: ${method} ${path} -> ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  return {
    kind: 'http',
    nestId,

    /* ------------------------------ reads ------------------------------ */
    listNodes: ({ type, status, approved_only, limit } = {}) =>
      call('GET', '/nodes' + qs({ type, status, approved_only, limit })),

    getNode: (nodeId, { format = 'raw', version } = {}) =>
      call('GET', `/nodes/${encodeURIComponent(nodeId)}` + qs({ format, version })),

    getVersions: (nodeId) => call('GET', `/nodes/${encodeURIComponent(nodeId)}/versions`),

    async getActiveReview(nodeId) {
      const data = await call('GET', `/nodes/${encodeURIComponent(nodeId)}/reviews`);
      const reviews = (data && (data.reviews || data)) || [];
      const open = Array.isArray(reviews)
        ? reviews.find((r) => r.status === 'open' || r.status === 'pending') || null
        : null;
      return {
        review: open && {
          proposedVersion: open.version || open.proposedVersion || null,
          submittedBy: open.submittedBy || open.author || null,
          submittedByHandle: open.submittedByHandle || null,
          submittedAt: open.submittedAt || open.createdAt || null,
        },
      };
    },

    /* ----------------------------- comments ---------------------------- */
    listComments: (nodeId, { status } = {}) =>
      call('GET', `/nodes/${encodeURIComponent(nodeId)}/comments` + qs({ status })),

    postComment: (nodeId, { body, parentId = null, anchor = null, author } = {}) =>
      call('POST', `/nodes/${encodeURIComponent(nodeId)}/comments`, {
        body,
        parentId: parentId || undefined,
        anchor: anchor || undefined,
        author, // self-asserted attribution (service token is the real actor)
      }).then((d) => ({ comment: (d && (d.comment || d)) || d })),

    resolveComment: (nodeId, commentId) =>
      call('POST', `/nodes/${encodeURIComponent(nodeId)}/comments/${encodeURIComponent(commentId)}/resolve`)
        .then((d) => ({ comment: (d && (d.comment || d)) || d })),

    /* ---------------------------- governance --------------------------- */
    submitReview: (nodeId, { actor } = {}) =>
      call('POST', `/nodes/${encodeURIComponent(nodeId)}/submit-review`, { actor }),

    approve: (nodeId, { actor } = {}) =>
      call('POST', `/nodes/${encodeURIComponent(nodeId)}/approve`, { actor }),

    reject: (nodeId, { actor } = {}) =>
      call('POST', `/nodes/${encodeURIComponent(nodeId)}/reject`, { actor }),

    /* ------------------------------ writes ----------------------------- */
    createNode: ({ type = 'definition', frontmatter = {}, body = '', author } = {}) =>
      call('POST', '/nodes', { type, frontmatter, body, author })
        .then((d) => ({ node: (d && (d.node || d)) || d })),

    patchNode: (nodeId, { frontmatter = {}, body, author } = {}) =>
      call('PATCH', `/nodes/${encodeURIComponent(nodeId)}`, { frontmatter, body, author })
        .then((d) => ({ node: (d && (d.node || d)) || d })),
  };
}

/** Read NestClient config from the environment (server-side only). */
export function nestClientFromEnv(env = process.env) {
  const { CONTEXTNEST_BASE_URL, CONTEXTNEST_NEST_ID, CONTEXTNEST_TOKEN } = env;
  if (!CONTEXTNEST_BASE_URL || !CONTEXTNEST_NEST_ID || !CONTEXTNEST_TOKEN) return null;
  return createNestClient({
    baseUrl: CONTEXTNEST_BASE_URL,
    nestId: CONTEXTNEST_NEST_ID,
    token: CONTEXTNEST_TOKEN,
  });
}
