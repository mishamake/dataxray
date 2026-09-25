// Type declarations for dataxray/core. Runtime is plain ESM (core/index.mjs).

export type TrustVerdict = "certified" | "uncertified" | "pending" | "drifted" | "stale" | "ungoverned";
export const VERDICT: Readonly<{ STALE: "stale"; PENDING: "pending"; CERTIFIED: "certified"; DRIFTED: "drifted"; UNCERTIFIED: "uncertified"; UNGOVERNED: "ungoverned" }>;

export function sha256Hex(input: string | Uint8Array): string;
export function normalizeSql(raw: string): string;
export function lineDiff(approved: string, current: string): Array<{ t: string; s: string }>;
export function fingerprint(normalizedString: string): string;
export function fingerprintSql(rawSql: string): string;
export function compareFingerprint(
  currentCompiledSql: string,
  approved: { fingerprint?: string | null; sql?: string | null } | string | null,
): { drifted: boolean; hasApprovedFingerprint: boolean; currentFingerprint: string; approvedFingerprint: string | null; diff: Array<{ t: string; s: string }> };
export function driftVerdict(fpCurrent: string | null, fpApproved: string | null): "MATCH" | "DRIFT" | "UNKNOWN";
export function computeVerdict(p?: {
  fpCurrent?: string | null;
  fpApproved?: string | null;
  hasApprovedBaseline?: boolean;
  ingestFresh?: boolean;
  providerReachable?: boolean;
  reviewOpen?: boolean;
}): Exclude<TrustVerdict, "ungoverned">;
export function verdictLabel(verdict: string, opts?: { reviewOpen?: boolean }): string;
export function computeHealth(stats?: object, config?: object, meta?: object): unknown;
export function deriveStatus(p: object): string;
export function badFlavor(p: object): string | null;
export function worstOf(statuses: string[]): string;
export function rollupComposite(inputStatuses: string[]): string;
export const STATUS_LABEL: Record<string, string>;
export const STATUSES: string[];
export function assembleLlmNarrationInput(signals?: object): unknown;

// ---- Metric evidence (0.3.0) ----
export type EvidenceCheck = { label: string; status: "pass" | "warn" | "fail"; detail: string };
export type MetricEvidence = {
  id: string;
  title: string;
  definition: string;
  status: "live" | "unavailable";
  unavailableReason?: "definition" | "source";
  verdict: TrustVerdict;
  governanceStatus?: "loading" | "ready" | "unavailable";
  value: number | null;
  format: "number" | "currency" | "percent";
  fingerprint: string | null;
  approvedFingerprint: string | null;
  retrievedAt: string | null;
  periodId?: string;
  dateWindow?: { start: string; end: string };
  period: string;
  sources: Array<{ label: string; href?: string; definition: string }>;
  checks: EvidenceCheck[];
  caveats: string[];
  message?: string;
};
export type DefinitionApproval = { by: string; at: string; fingerprint: string };
export type ReviewRequest = { by: string; at: string; reviewer: string; reviewerId?: string; fingerprint: string };
export type GovernanceState = { revision: number; approval: DefinitionApproval | null; review: ReviewRequest | null };
export type StatusTone = "green" | "yellow" | "neutral" | "red";
export type EvidenceStatus = { label: string; tone: StatusTone };

export const DEFAULT_EVIDENCE_MAX_AGE_MS: number;
export const EMPTY_GOVERNANCE: Readonly<GovernanceState>;
export function stableJson(value: unknown): string;
export function definitionFingerprint(value: unknown, kind?: "report" | "sql"): string;
export function isEvidenceFresh(evidence: { retrievedAt: string | null | undefined }, now?: number, maxAgeMs?: number): boolean;
export function isEvidenceAvailable(evidence: { status: string; value: number | null }): boolean;
export function isVerifiableEvidence(
  evidence: Pick<MetricEvidence, "retrievedAt" | "status" | "value" | "fingerprint"> | null | undefined,
  now?: number,
  maxAgeMs?: number,
): boolean;
export function governedEvidence<E extends Omit<MetricEvidence, "verdict">>(
  evidence: E,
  state?: GovernanceState,
  opts?: { available?: boolean; approvals?: boolean; now?: number; maxAgeMs?: number },
): E & { verdict: TrustVerdict; approvedFingerprint: string | null };
export function evidenceStatus(evidence: MetricEvidence): EvidenceStatus;
