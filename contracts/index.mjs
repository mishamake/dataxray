// contracts/index.mjs — versioned, framework-free contracts shared by every host
// dashboard and by the agents that read dashboard feedback. Pure; no I/O.

export {
  SHARE_LINK_VERSION, MAX_SHARE_LINK_LENGTH, ShareLinkError,
  parseShareView, buildShareLink, readShareParams,
  shareChoicesValid, shareChoice, shareDate, shareAsOf,
} from './share-link.mjs';
export {
  FEEDBACK_CONTEXT_VERSION, MAX_FEEDBACK_CONTEXT_BYTES, MAX_FEEDBACK_TARGETS, FEEDBACK_KINDS, RUNTIME_ENVIRONMENTS,
  isBoundedJson, validateFeedbackRuntime, validateFeedbackContext, parseFeedbackContext, resolveRuntimeEnvironment,
} from './feedback-context.mjs';
export { createTargetRegistry } from './targets.mjs';
export {
  COMMENT_STATUSES, planStatusChange, isReviewer, validateReviewerIds, isThreadCompleted,
} from './workflow.mjs';
export { PORT_METHODS, assertPort, defineDashboard } from './ports.mjs';
export { APPROVAL_SOURCES, resolveApprovals, definitionApprovalRequired } from './approvals.mjs';
