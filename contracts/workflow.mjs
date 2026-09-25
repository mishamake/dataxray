// contracts/workflow.mjs
// Feedback workflow state machine: Open → In Progress → Needs Review → Completed.
// Pure rules only. Hosts own persistence, identity and who may act as a builder.
//
//   Open ──submit──▶ Needs Review ──approve──▶ Completed
//   In Progress ─┘        │
//        ▲                └─request changes (feedback required)─┐
//        └──────────────────────────────────────────────────────┘
//
// Roles:
//   builder  — may submit work for review (host policy: a role, never a hardcoded user)
//   reviewer — the original author or an assigned reviewer; may approve or request changes
// One decision resolves the round for every reviewer. Completed is terminal.
//
// With requireReview=false (approvals.feedback off) a builder may also close
// Open/In Progress work directly, with an optional note. The review path still works.

export const COMMENT_STATUSES = Object.freeze(['Open', 'In Progress', 'Needs Review', 'Completed']);
export const MAX_FEEDBACK_LENGTH = 4000;
export const MAX_REVIEWERS = 20;

/** @typedef {'Open'|'In Progress'|'Needs Review'|'Completed'} CommentStatus */
/** @typedef {{tenant:string, oid:string, name:string, viaAgent?:boolean}} Actor */

const TRANSITIONS = Object.freeze({
  'Needs Review': { from: ['Open', 'In Progress'], role: 'builder' },
  'In Progress': { from: ['Needs Review'], role: 'reviewer' },
  Completed: { from: ['Needs Review'], role: 'reviewer' },
});

const deny = (code, error) => ({ ok: false, code, error });

/**
 * Decide whether a status change is allowed. Returns the normalized event to
 * persist, or a denial with an HTTP-shaped code (400/403/409).
 *
 * @param {object} p
 * @param {Actor} p.actor
 * @param {CommentStatus} p.current           current stored status
 * @param {Exclude<CommentStatus,'Open'>} p.next
 * @param {string} [p.feedback]
 * @param {string} p.authorId                 original comment author's stable ID
 * @param {string[]} [p.reviewerIds]          additional assigned reviewers
 * @param {boolean} [p.hasTasks]              originals with subtasks are reviewed per task
 * @param {(actor:Actor) => boolean} p.isBuilder  host policy for submitting work
 * @param {boolean} [p.requireReview]         default true; false lets a builder close work directly
 */
export function planStatusChange(p) {
  const { actor, current, next, authorId, reviewerIds = [], hasTasks = false, isBuilder, requireReview = true } = p;
  const direct = requireReview === false && next === 'Completed' && ['Open', 'In Progress'].includes(current);
  const rule = direct ? { from: ['Open', 'In Progress'], role: 'builder' } : TRANSITIONS[next];
  if (!rule) return deny(400, 'Unknown status.');
  const feedback = typeof p.feedback === 'string' ? p.feedback.trim() : undefined;
  if (feedback !== undefined && (feedback.length < 1 || feedback.length > MAX_FEEDBACK_LENGTH))
    return deny(400, `Feedback must be 1–${MAX_FEEDBACK_LENGTH} characters.`);
  if (next === 'In Progress' && !feedback) return deny(400, 'Requests for changes require written feedback.');
  if (next === 'Completed' && feedback !== undefined && !direct) return deny(400, 'Approval does not take feedback.');
  if (hasTasks) return deny(409, 'Review the individual tasks for this comment.');
  if (rule.role === 'builder' && !(typeof isBuilder === 'function' && isBuilder(actor)))
    return deny(403, 'Only a builder can submit work for review.');
  if (rule.role === 'reviewer' && !isReviewer(actor, authorId, reviewerIds))
    return deny(403, 'Only the original author or an assigned reviewer can approve or request changes.');
  if (!rule.from.includes(current)) return deny(409, 'This status change is not available.');
  return { ok: true, event: { status: next, feedback: feedback ?? null, actorId: actor.oid, actorName: actor.name, viaAgent: !!actor.viaAgent, reviewed: !direct } };
}

/** The original author is always a reviewer, independently of the assigned list. */
export function isReviewer(actor, authorId, reviewerIds = []) {
  return actor.oid === authorId || reviewerIds.includes(actor.oid);
}

/** Validate a replacement list of additional reviewer IDs. */
export function validateReviewerIds(ids) {
  if (!Array.isArray(ids) || ids.length > MAX_REVIEWERS) return deny(400, `Select at most ${MAX_REVIEWERS} reviewers.`);
  const trimmed = ids.map((id) => (typeof id === 'string' ? id.trim() : ''));
  if (trimmed.some((id) => id.length < 1 || id.length > 200)) return deny(400, 'Reviewer IDs must be stable identifiers.');
  if (new Set(trimmed).size !== trimmed.length) return deny(400, 'Select each reviewer once.');
  return { ok: true, value: trimmed };
}

/** A thread is complete when all its tasks are, or (without tasks) its own status is. */
export function isThreadCompleted(comment) {
  return comment.tasks?.length ? comment.tasks.every((t) => t.status === 'Completed') : comment.status === 'Completed';
}
