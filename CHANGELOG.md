# Changelog

All notable changes to DataXray. Versions follow [Semantic Versioning](https://semver.org/):
while `0.x`, a **minor** bump may add features but must not break existing exports;
anything breaking is called out under **Breaking** with a migration in
[UPGRADING.md](UPGRADING.md).

Versioned contracts (share links, feedback context, fingerprints) have their own
version numbers and are never reinterpreted in place. See UPGRADING.md.

## 0.3.0

Lifts the portable parts of a production dashboard integration (receipts, approvals,
targeted feedback, share links and agent handoff) into the SDK so other dashboards
inherit them instead of re-implementing them.

### Added

- **`dataxray/core` — metric evidence** (`core/evidence.mjs`)
  - `MetricEvidence` contract (typed) for every displayed number.
  - `stableJson` / `definitionFingerprint` — fingerprint non-SQL definitions (saved
    report JSON, API query bodies) as well as SQL. Byte-identical to the reference
    `node:crypto` implementation, so existing approvals do not drift on upgrade.
  - `isEvidenceFresh`, `isEvidenceAvailable`, `isVerifiableEvidence` with a
    configurable max age (`DEFAULT_EVIDENCE_MAX_AGE_MS`, 5 minutes).
  - `governedEvidence` — apply human approval state and recompute the verdict with
    the existing `computeVerdict` precedence. Fails loud (stale) when the governance
    store is unreadable.
  - `evidenceStatus` — one presentation status per number (`{label, tone}`), where
    failed data checks outrank approval.
- **`dataxray/contracts`** (new entry point, pure, no dependencies)
  - Share-link contract v1: `buildShareLink`, `parseShareView`, `readShareParams`,
    `shareChoice`, `shareChoicesValid`, `shareDate`, `shareAsOf`.
  - Feedback-context contract v1: `validateFeedbackContext`, `parseFeedbackContext`,
    `validateFeedbackRuntime`, `isBoundedJson`, `resolveRuntimeEnvironment`. The
    immutable snapshot agents read when acting on feedback (≤20 targets, ≤256 KiB).
  - Target registry: `createTargetRegistry` with permanent IDs, aliases for moved
    targets, dynamic resolvers, and `resolveContext` for agents (`current` source or
    explicit `unresolved`).
  - Feedback workflow: `planStatusChange` (Open → In Progress → Needs Review →
    Completed), `isReviewer`, `validateReviewerIds`, `isThreadCompleted`. Builders
    are a host policy (`isBuilder`), never a hardcoded user.
  - Ports: typed `ActorResolver`, `ScopePolicy`, `GovernanceStore`, `CommentStore`,
    `NotificationSink`, `EvidenceResolver`; `assertPort` checks implementations.
  - `defineDashboard` — one declaration per dashboard; validates IDs, metrics,
    targets and aliases at startup and exposes `hasScope` / `resolveTarget`.
  - **Optional approvals** (`contracts/approvals.mjs`): `approvals` config on
    `defineDashboard` turns definition approval and/or feedback review off per
    dashboard, with per-metric overrides and a `source` (`nest` | `host`). Both
    default **on**. Unknown keys and non-boolean flags throw, so a typo can't
    silently disable approvals.
- **`VERDICT.UNGOVERNED` / `'ungoverned'`**: current, healthy data where the host
  turned definition approval off. Rendered neutral ("Current · approval not
  required"), never green. Only `governedEvidence(e, s, {approvals: false})` emits
  it; `computeVerdict` is unchanged.
- `planStatusChange({requireReview: false})`: a builder may close Open/In Progress
  work directly with an optional note; `event.reviewed` records which path was used.
- **TypeScript declarations** for `dataxray/core` and `dataxray/contracts`
  (`types` export condition). A test keeps runtime exports and declarations in sync.
- `CHANGELOG.md`, `UPGRADING.md`.

### Changed

- `package.json` `exports["./core"]` is now a conditional export
  (`types` + `default`). The runtime path is unchanged.

### Breaking

- None. Every 0.2.0 export is unchanged.
