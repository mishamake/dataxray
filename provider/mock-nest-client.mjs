// provider/mock-nest-client.mjs
// MockNestClient — the offline twin of NestClient. Identical method surface,
// faithfully mirroring the Community Nest API response shapes (node read /
// versions / comments / review workflow / writes) so the demo and the
// deterministic unit tests run with NO network. The mock proves OUR wiring;
// the marked integration test proves the real server's semantics.
//
// Governance rules mirrored here (PRD §5.2, §5.6):
//   - Every write (create/patch) appends a new CURRENT version.
//   - approvedVersion moves ONLY on a human approve() — never on a write.
//   - submit-review -> pending_review and records a watcher notification.
//   - Comment-create records NO notification (only reviews notify).

let seq = 0;
function nextId(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function createMockNestClient({ nestId = 'mock-nest' } = {}) {
  const nodes = new Map(); // nodeId -> internal node record
  const notificationLog = []; // watcher notifications fired by review actions

  function mustGet(nodeId) {
    const n = nodes.get(nodeId);
    if (!n) throw err(404, `node not found: ${nodeId}`);
    return n;
  }

  function currentVersionRecord(n) {
    return n.versions[n.versions.length - 1];
  }

  function notify(kind, n, actor) {
    // Watchers of a definition node = its owner (frontmatter ownerHandle).
    const watcher = n.frontmatter && n.frontmatter.ownerHandle ? [n.frontmatter.ownerHandle] : [];
    const note = {
      kind, // 'review_request' | 'approved' | 'rejected'
      nodeId: n.id,
      metricId: n.frontmatter ? n.frontmatter.metricId : null,
      actor: actor || 'unknown',
      notified: watcher,
      at: new Date().toISOString(),
    };
    notificationLog.push(note);
    return note;
  }

  function summary(n) {
    return {
      id: n.id,
      type: n.type,
      status: n.status,
      frontmatter: n.frontmatter,
      approvedVersion: n.approvedVersion,
      currentVersion: currentVersionRecord(n).version,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
  }

  return {
    kind: 'mock',
    nestId,

    /* ------------------------------ reads ------------------------------ */
    async listNodes({ type, status, approved_only, limit } = {}) {
      let out = [...nodes.values()];
      if (type) out = out.filter((n) => n.type === type);
      if (status) out = out.filter((n) => n.status === status);
      if (approved_only === true || approved_only === 'true') out = out.filter((n) => n.approvedVersion != null);
      if (limit) out = out.slice(0, limit);
      return { nodes: out.map(summary) };
    },

    async getNode(nodeId, { version } = {}) {
      const n = mustGet(nodeId);
      if (version != null) {
        const v = n.versions.find((x) => x.version === Number(version));
        if (!v) throw err(404, `version not found: ${nodeId}@${version}`);
        return {
          ...summary(n),
          version: v.version,
          frontmatter: v.frontmatter,
          body: v.body,
        };
      }
      return { ...summary(n), body: currentVersionRecord(n).body };
    },

    async getVersions(nodeId) {
      const n = mustGet(nodeId);
      const approved = n.approvedVersion != null ? n.versions.find((v) => v.version === n.approvedVersion) : null;
      return {
        currentVersion: currentVersionRecord(n).version,
        approvedVersion: n.approvedVersion,
        versions: n.versions.map((v) => ({
          version: v.version,
          createdAt: v.createdAt,
          createdBy: v.createdBy,
          resolvedBy: v.resolvedBy,
          resolvedAt: v.resolvedAt,
          resolutionStatus: v.resolutionStatus,
        })),
        resolvedBy: approved ? approved.resolvedBy : null,
        resolutionStatus: approved ? approved.resolutionStatus : null,
      };
    },

    async getActiveReview(nodeId) {
      const n = mustGet(nodeId);
      return { review: n.review || null };
    },

    /* ----------------------------- comments ---------------------------- */
    async listComments(nodeId, { status } = {}) {
      const n = mustGet(nodeId);
      let out = n.comments;
      if (status === 'open') out = out.filter((c) => !c.resolved);
      if (status === 'resolved') out = out.filter((c) => c.resolved);
      return { comments: out.map((c) => ({ ...c })) };
    },

    async postComment(nodeId, { body, parentId = null, anchor = null, author = 'unknown', authorHandle = null } = {}) {
      const n = mustGet(nodeId);
      if (!body || !String(body).trim()) throw err(400, 'comment body is required');
      if (parentId != null && !n.comments.some((c) => c.id === parentId)) {
        throw err(404, `parent comment not found: ${parentId}`);
      }
      const comment = {
        id: nextId('cmt'),
        parentId,
        anchor,
        body: String(body),
        author,
        authorHandle,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      n.comments.push(comment);
      // Deliberately NO notification — comment-create does not notify (contract).
      return { comment: { ...comment } };
    },

    async resolveComment(nodeId, commentId) {
      const n = mustGet(nodeId);
      const c = n.comments.find((x) => x.id === commentId);
      if (!c) throw err(404, `comment not found: ${commentId}`);
      c.resolved = true;
      // Resolving a comment does NOT move governance (PRD §5.9).
      return { comment: { ...c } };
    },

    /* ---------------------------- governance --------------------------- */
    async submitReview(nodeId, { actor = 'unknown', actorHandle = null } = {}) {
      const n = mustGet(nodeId);
      n.status = 'pending_review';
      n.review = {
        proposedVersion: currentVersionRecord(n).version,
        submittedBy: actor,
        submittedByHandle: actorHandle,
        submittedAt: new Date().toISOString(),
      };
      n.updatedAt = new Date().toISOString();
      const notification = notify('review_request', n, actor);
      return { id: n.id, status: n.status, approvedVersion: n.approvedVersion, notification };
    },

    async approve(nodeId, { actor = 'unknown', actorHandle = null } = {}) {
      const n = mustGet(nodeId);
      // THE human-only baseline move: approvedVersion re-pins to the current version.
      n.approvedVersion = currentVersionRecord(n).version;
      n.status = 'approved';
      const v = currentVersionRecord(n);
      v.resolvedBy = actor;
      v.resolvedByHandle = actorHandle;
      v.resolvedAt = new Date().toISOString();
      v.resolutionStatus = 'approved';
      n.review = null;
      n.updatedAt = new Date().toISOString();
      const notification = notify('approved', n, actor);
      return { id: n.id, status: n.status, approvedVersion: n.approvedVersion, notification };
    },

    async reject(nodeId, { actor = 'unknown', actorHandle = null } = {}) {
      const n = mustGet(nodeId);
      // approvedVersion is UNCHANGED — rejection blesses nothing (PRD §5.6).
      n.status = n.approvedVersion != null ? 'approved' : 'draft';
      const v = currentVersionRecord(n);
      v.resolvedBy = actor;
      v.resolvedByHandle = actorHandle;
      v.resolvedAt = new Date().toISOString();
      v.resolutionStatus = 'rejected';
      n.review = null;
      n.updatedAt = new Date().toISOString();
      const notification = notify('rejected', n, actor);
      return { id: n.id, status: n.status, approvedVersion: n.approvedVersion, notification };
    },

    /* ------------------------------ writes ----------------------------- */
    async createNode({ type = 'document', frontmatter = {}, body = '', author = 'unknown' } = {}) {
      const id = nextId('node');
      const now = new Date().toISOString();
      const n = {
        id,
        type,
        status: 'draft', // NEVER created approved — no machine self-approval.
        approvedVersion: null,
        frontmatter: { ...frontmatter },
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            version: 1,
            frontmatter: { ...frontmatter },
            body,
            createdAt: now,
            createdBy: author,
            resolvedBy: null,
            resolvedAt: null,
            resolutionStatus: null,
          },
        ],
        comments: [],
        review: null,
      };
      nodes.set(id, n);
      return { node: summary(n) };
    },

    async patchNode(nodeId, { frontmatter = {}, body, author = 'unknown' } = {}) {
      const n = mustGet(nodeId);
      const now = new Date().toISOString();
      const prev = currentVersionRecord(n);
      const merged = { ...prev.frontmatter, ...frontmatter };
      // A write appends a new CURRENT version. It NEVER moves approvedVersion
      // and NEVER flips status — the blessed baseline is untouched by writes.
      n.versions.push({
        version: prev.version + 1,
        frontmatter: merged,
        body: body != null ? body : prev.body,
        createdAt: now,
        createdBy: author,
        resolvedBy: null,
        resolvedAt: null,
        resolutionStatus: null,
      });
      n.frontmatter = merged;
      n.updatedAt = now;
      return { node: summary(n) };
    },

    /* ------------------------- test/demo introspection ------------------ */
    // The watcher-notification log — what the demo's "owner was pinged" proof
    // and the offline tests assert against. Mirrors what the notify-service
    // drains to Slack/Teams/webhook on the real server.
    notifications() {
      return notificationLog.map((x) => ({ ...x }));
    },
  };
}
