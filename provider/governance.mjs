// provider/governance.mjs
// The governance mapper (PRD §5.3, §5.4, §6). Reads the nest's /versions
// governance for a metric's definition node, extracts the TWO fingerprints
// (fpCurrent from the current version's body, fpApproved from the approved
// version's body), applies the ingest-freshness heartbeat, and feeds the pure
// core — which alone computes the verdict. Also owns the governed intents
// (comments, propose/approve/reject) the widget relays.
//
// Loud-degradation contract: ANY nest failure degrades to { unavailable } —
// the widget shows the loud can't-verify state, never a cached green.

import { VERDICT, computeVerdict, verdictLabel } from '../core/index.mjs';

export const DEFAULT_STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h (PRD §5.4)

export function createGovernance({ client, stalenessThresholdMs = DEFAULT_STALENESS_THRESHOLD_MS } = {}) {
  if (!client) throw new Error('createGovernance requires a nest client');
  const nodeIdCache = new Map(); // metricId -> nodeId | null

  /* --------------------- metricId -> nodeId resolution ------------------ */
  async function resolveNodeId(metricId) {
    if (nodeIdCache.has(metricId)) return nodeIdCache.get(metricId);
    const res = await client.listNodes({ type: 'definition' });
    const found = (res.nodes || []).find(
      (n) => n.frontmatter && n.frontmatter.metricId === metricId
    );
    const id = found ? found.id : null;
    nodeIdCache.set(metricId, id);
    return id;
  }

  function threadComments(flat) {
    const top = flat.filter((c) => c.parentId == null);
    const replies = flat.filter((c) => c.parentId != null);
    return top.map((c) => ({
      ...c,
      replies: replies.filter((r) => r.parentId === c.id),
    }));
  }

  /* ------------------------- the metric view model ---------------------- */
  async function getGovernance(metricId, { now = Date.now(), personaHandle = null } = {}) {
    if (!metricId) return { metricId: null, mapped: false };
    const nowMs = typeof now === 'number' ? now : new Date(now).getTime();

    try {
      const nodeId = await resolveNodeId(metricId);
      if (!nodeId) return { metricId, mapped: false };

      const [node, versions, commentsRes, reviewRes] = await Promise.all([
        client.getNode(nodeId),
        client.getVersions(nodeId),
        client.listComments(nodeId),
        client.getActiveReview(nodeId),
      ]);

      const fm = node.frontmatter || {};
      const fpCurrent = fm.currentFingerprint || null;
      const ingestedAt = fm.ingestedAt || null;

      // The approved baseline = the fingerprint recorded in the body of the
      // version approvedVersion points at (PRD §5.2). Read that version.
      let fpApproved = null;
      let blessedBy = null;
      let blessedAt = null;
      if (versions.approvedVersion != null) {
        const approvedBody = await client.getNode(nodeId, { version: versions.approvedVersion });
        fpApproved = (approvedBody.frontmatter || {}).currentFingerprint || null;
        const approvedRecord = (versions.versions || []).find(
          (v) => v.version === versions.approvedVersion
        );
        blessedBy = (approvedRecord && (approvedRecord.resolvedBy || approvedRecord.createdBy)) || versions.resolvedBy || null;
        blessedAt = (approvedRecord && (approvedRecord.resolvedAt || approvedRecord.createdAt)) || null;
      }

      // Ingest-freshness heartbeat (PRD §5.4): missing or ancient => not fresh.
      const ingestFresh =
        ingestedAt != null && nowMs - Date.parse(ingestedAt) <= stalenessThresholdMs;

      const reviewOpen = node.status === 'pending_review';

      const verdict = computeVerdict({
        fpCurrent,
        fpApproved,
        hasApprovedBaseline: versions.approvedVersion != null,
        ingestFresh,
        providerReachable: true, // we just reached it — proven, not assumed
        reviewOpen,
      });

      const comments = threadComments(commentsRes.comments || []);
      const review = reviewOpen ? reviewRes.review || null : null;

      return {
        metricId,
        mapped: true,
        nodeId,
        nodeStatus: node.status,
        verdict,
        verdictLabel: verdictLabel(verdict, { reviewOpen }),
        owner: fm.owner || null,
        ownerHandle: fm.ownerHandle || null,
        humanDefinition: fm.humanDefinition || null,
        dbtModelRef: fm.dbtModelRef || null,
        receipt: {
          fpApproved,
          approvedVersion: versions.approvedVersion,
          fpCurrent,
          currentVersion: versions.currentVersion,
          ingestedAt,
          ingestFresh,
          stalenessThresholdMs,
          blessedBy,
          blessedAt,
        },
        review,
        comments,
        openCommentCount: comments.filter((c) => !c.resolved).length,
        // Design-review fix #1: gating compares the ACTING persona against the
        // ACTING node's owner handle — never a hardcoded name.
        canGovern: personaHandle != null && fm.ownerHandle != null && personaHandle === fm.ownerHandle,
      };
    } catch (err) {
      // Loud provider-outage degradation (PRD §5.7): never silent-green.
      return {
        metricId,
        mapped: true,
        unavailable: true,
        verdict: VERDICT.STALE,
        verdictLabel: verdictLabel(VERDICT.STALE),
        error: String((err && err.message) || err),
      };
    }
  }

  /* ------------------------------ intents ------------------------------- */
  async function mustResolve(metricId) {
    const nodeId = await resolveNodeId(metricId);
    if (!nodeId) {
      const e = new Error(`no definition node for metric: ${metricId}`);
      e.status = 404;
      throw e;
    }
    return nodeId;
  }

  // Marcus's question. A bare comment does NOT notify; flag-to-owner routes
  // through a review — the only path that pings (PRD §5.6, US-3).
  async function postComment(metricId, { body, parentId = null, flagToOwner = false, author, authorHandle } = {}) {
    const nodeId = await mustResolve(metricId);
    const { comment } = await client.postComment(nodeId, { body, parentId, author, authorHandle });
    let reviewOpened = false;
    let notified = false;
    if (flagToOwner) {
      const node = await client.getNode(nodeId);
      if (node.status !== 'pending_review') {
        await client.submitReview(nodeId, { actor: author, actorHandle: authorHandle });
        reviewOpened = true;
      }
      notified = true; // a review is open/attached — the watcher path fires
    }
    return { comment, reviewOpened, notified };
  }

  async function resolveComment(metricId, commentId) {
    const nodeId = await mustResolve(metricId);
    return client.resolveComment(nodeId, commentId);
  }

  // Propose a definition change / request re-approval (PRD §5.6, US-5).
  async function propose(metricId, { author, authorHandle } = {}) {
    const nodeId = await mustResolve(metricId);
    const res = await client.submitReview(nodeId, { actor: author, actorHandle: authorHandle });
    return { ...res, notified: true };
  }

  // The human-only baseline move. approve re-pins approvedVersion to the
  // current version; the next getGovernance re-reads fpApproved == fpCurrent.
  async function approve(metricId, { author, authorHandle } = {}) {
    const nodeId = await mustResolve(metricId);
    return client.approve(nodeId, { actor: author, actorHandle: authorHandle });
  }

  async function reject(metricId, { author, authorHandle } = {}) {
    const nodeId = await mustResolve(metricId);
    return client.reject(nodeId, { actor: author, actorHandle: authorHandle });
  }

  return {
    getGovernance,
    postComment,
    resolveComment,
    propose,
    approve,
    reject,
    resolveNodeId,
    stalenessThresholdMs,
  };
}
