// Type declarations for dataxray/contracts. Runtime is plain ESM (contracts/index.mjs).
import type { MetricEvidence, GovernanceState } from "../core/index.js";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; path: Array<string | number> };

// ---- Share links (v1) ----
export type ShareView = Record<string, string>;
export const SHARE_LINK_VERSION: 1;
export const MAX_SHARE_LINK_LENGTH: number;
export class ShareLinkError extends Error {}
export function parseShareView(value: string | null | undefined): ShareView | null;
export function buildShareLink(location: string, targetId: string, view?: ShareView): string;
export function readShareParams(params: { get(name: string): string | null } | null | undefined): { focus: string; view: ShareView; invalid: boolean; key: string };
export function shareChoicesValid(view: ShareView, choices: Record<string, readonly string[]>): boolean;
export function shareChoice<const T extends string>(value: string | undefined, choices: readonly T[], fallback: T): T;
export function shareDate(value: string | undefined): string | undefined;
export function shareAsOf(value: string | null | undefined, opts?: { timeZone?: string; now?: Date }): Date;

// ---- Feedback context (v1) ----
export type FeedbackKind = "metric" | "chart" | "table" | "section";
export type RuntimeEnvironment = "development" | "staging" | "production" | "local" | "preview" | "unknown";
export type FeedbackRuntime = { appVersion: string | null; environment: RuntimeEnvironment; viewport: { width: number; height: number } };
export type FeedbackTarget = {
  id: string;
  label: string;
  kind: FeedbackKind;
  view: Record<string, string>;
  capturedAt: string;
  runtime?: FeedbackRuntime;
  observation: { text: string; data?: unknown };
};
export type FeedbackContext = { version: 1; targets: FeedbackTarget[] };
export const FEEDBACK_CONTEXT_VERSION: 1;
export const MAX_FEEDBACK_CONTEXT_BYTES: number;
export const MAX_FEEDBACK_TARGETS: number;
export const FEEDBACK_KINDS: readonly FeedbackKind[];
export const RUNTIME_ENVIRONMENTS: readonly RuntimeEnvironment[];
export function isBoundedJson(value: unknown, maxNodes?: number, maxDepth?: number): boolean;
export function validateFeedbackRuntime(runtime: unknown): Result<FeedbackRuntime>;
export function validateFeedbackContext(context: unknown): Result<FeedbackContext>;
export function parseFeedbackContext(context: unknown): FeedbackContext;
export function resolveRuntimeEnvironment(p?: { deployEnv?: string; deployEnvMap?: Record<string, string>; vercelEnv?: string; nodeEnv?: string }): RuntimeEnvironment;

// ---- Targets ----
export type TargetDefinition = { label: string; kind: FeedbackKind; source: { file: string; component: string }; metricId?: string };
export type DynamicTargetResolver = (dashboardId: string, id: string, input?: unknown) => TargetDefinition | null;
export type TargetResolution =
  | { id: string; status: "current"; label: string; kind: FeedbackKind; metricId?: string; source: { file: string; component: string } }
  | { id: string; status: "unresolved" };
export type TargetRegistry = {
  add(dashboardId: string, id: string, target: TargetDefinition): TargetRegistry;
  alias(dashboardId: string, oldId: string, newId: string): TargetRegistry;
  addResolver(dashboardId: string, resolver: DynamicTargetResolver): TargetRegistry;
  resolve(dashboardId: string, id: string, input?: unknown): TargetDefinition | null;
  resolveContext(dashboardId: string, context: FeedbackContext | null | undefined, input?: unknown): TargetResolution[];
  dashboards(): string[];
  list(dashboardId: string): Array<TargetDefinition & { id: string }>;
};
export function createTargetRegistry(): TargetRegistry;

// ---- Workflow ----
export type CommentStatus = "Open" | "In Progress" | "Needs Review" | "Completed";
export type Actor = { tenant: string; oid: string; name: string; email?: string; viaAgent?: boolean };
export type Scope = { dashboardId: string; metricId?: string };
export const COMMENT_STATUSES: readonly CommentStatus[];
export type StatusChangeDecision =
  | { ok: true; event: { status: Exclude<CommentStatus, "Open">; feedback: string | null; actorId: string; actorName: string; viaAgent: boolean; reviewed: boolean } }
  | { ok: false; code: 400 | 403 | 409; error: string };
export function planStatusChange(p: {
  actor: Actor;
  current: CommentStatus;
  next: Exclude<CommentStatus, "Open">;
  feedback?: string;
  authorId: string;
  reviewerIds?: string[];
  hasTasks?: boolean;
  isBuilder: (actor: Actor) => boolean;
  requireReview?: boolean;
}): StatusChangeDecision;
export function isReviewer(actor: Actor, authorId: string, reviewerIds?: string[]): boolean;
export function validateReviewerIds(ids: unknown): { ok: true; value: string[] } | { ok: false; code: 400; error: string };
export function isThreadCompleted(comment: { status: string; tasks?: Array<{ status: string }> }): boolean;

// ---- Ports ----
export type ActorResolver = { current(): Promise<Actor> };
export type ScopePolicy = {
  canView(actor: Actor, scope: Scope): boolean | Promise<boolean>;
  canApprove(actor: Actor, scope: Scope): boolean | Promise<boolean>;
  isBuilder(actor: Actor): boolean;
};
export type GovernanceStore = {
  read(scopes: Scope[]): Promise<Record<string, GovernanceState>>;
  approve(actor: Actor, scope: Scope, p: { fingerprint: string; revision: number }): Promise<unknown>;
  revoke(actor: Actor, scope: Scope, p: { revision: number }): Promise<unknown>;
  requestReview(actor: Actor, scope: Scope, p: { reviewerId: string; fingerprint: string; revision: number }): Promise<unknown>;
  reject(actor: Actor, scope: Scope, p: { reason: string; revision: number }): Promise<unknown>;
  decline(actor: Actor, scope: Scope, p: { note?: string; revision: number }): Promise<unknown>;
  history(scope: Scope): Promise<unknown[]>;
};
export type CommentStore = {
  create(actor: Actor, scope: Scope, p: { body: string; requestId: string; context?: FeedbackContext; parentId?: number }): Promise<unknown>;
  list(actor: Actor, scope: Scope, p: { before?: number; group?: "active" | "completed" }): Promise<unknown>;
  edit(actor: Actor, scope: Scope, p: { id: number; body: string; revision: number }): Promise<unknown>;
  remove(actor: Actor, scope: Scope, p: { id: number }): Promise<void>;
  changeStatus(actor: Actor, scope: Scope, p: { id: number; status: Exclude<CommentStatus, "Open">; revision: number; feedback?: string }): Promise<unknown>;
  setReviewers(actor: Actor, scope: Scope, p: { id: number; reviewerIds: string[]; revision: number }): Promise<unknown>;
};
export type NotificationSink = { notify(event: { kind: string; recipients: string[]; scope: Scope; commentId?: number; replyId?: number }): Promise<void> };
export type EvidenceResolver = { resolve(scope: Scope, view: ShareView): Promise<MetricEvidence[]> };
export type PortName = "actors" | "policy" | "governance" | "comments" | "notifications" | "evidence";
export const PORT_METHODS: Readonly<Record<PortName, readonly string[]>>;
export function assertPort<T>(name: PortName, impl: T): T;

export type DashboardDefinition = {
  id: string;
  title: string;
  metrics: string[];
  targets?: Record<string, TargetDefinition>;
  aliases?: Record<string, string>;
  resolveTarget?: DynamicTargetResolver;
  viewChoices?: Record<string, readonly string[]>;
  approvals?: ApprovalConfig;
};
export type Dashboard = Readonly<{
  id: string;
  title: string;
  metrics: readonly string[];
  viewChoices: Readonly<Record<string, readonly string[]>>;
  approvals: ResolvedApprovals;
  registry: TargetRegistry;
  definitionApprovals(metricId?: string): boolean;
  readonly feedbackReview: boolean;
  hasScope(scope: Scope | null | undefined): boolean;
  resolveTarget(id: string, input?: unknown): TargetDefinition | null;
}>;
export function defineDashboard(d: DashboardDefinition, registry?: TargetRegistry): Dashboard;

// ---- Approvals (optional) ----
export type ApprovalSource = "nest" | "host";
export type ApprovalConfig = boolean | { definitions?: boolean; feedback?: boolean; metrics?: Record<string, boolean>; source?: ApprovalSource };
export type ResolvedApprovals = Readonly<{ definitions: boolean; feedback: boolean; metrics: Readonly<Record<string, boolean>>; source: ApprovalSource }>;
export const APPROVAL_SOURCES: readonly ApprovalSource[];
export function resolveApprovals(config?: ApprovalConfig): ResolvedApprovals;
export function definitionApprovalRequired(approvals: ApprovalConfig | ResolvedApprovals, metricId?: string): boolean;
