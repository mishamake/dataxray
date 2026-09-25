# Upgrading DataXray

## The upgrade path, in one line

Pin a released tag and bump it:

```jsonc
// package.json of the host app
"dataxray": "github:mishamake/dataxray#v0.3.0"
```

```bash
npm install dataxray@github:mishamake/dataxray#v0.3.1   # the whole upgrade
npm test && npm run typecheck                            # host gate
```

Do not depend on the bare repository (`github:mishamake/dataxray`). It follows `main`,
so any fresh install or lockfile regeneration can pull unreleased changes.

## What the SDK promises

| Change | Version bump | What a host does |
|---|---|---|
| Bug fix, no API change | patch | Bump the tag. |
| New export, new optional field | minor | Bump the tag. Adopt new features when you want to. |
| Removed/renamed export, changed behavior | minor while `0.x` (major from `1.0`), listed under **Breaking** in the CHANGELOG | Follow the migration below for that version. |

These contracts are stored in databases or sent in URLs, so they carry **their own version**
and are never reinterpreted in place:

| Contract | Version | Compatibility rule |
|---|---|---|
| Share link (`focus` + `view`) | `SHARE_LINK_VERSION = 1` | New controls are optional with defaults. A change in meaning ships a new version plus the old reader. Target IDs are permanent: use `alias`, never recycle an ID. |
| Feedback context snapshot | `FEEDBACK_CONTEXT_VERSION = 1` | Stored snapshots are immutable. A new version adds a validator; v1 stays readable. |
| Definition fingerprint | `sha256:` + canonical JSON / normalized SQL | Never changes for existing definitions. A new canonicalization ships as a new prefix, so existing approvals don't show as drifted. |
| Verdict precedence | `computeVerdict` | Changes are breaking and listed in the CHANGELOG. |
| Approval defaults | `resolveApprovals` | Both kinds default **on**. A release never turns approvals off for a host that didn't configure it. |

The test suite enforces two of these: `test/evidence.test.mjs` pins fingerprint parity,
and `test/exports.test.mjs` keeps the shipped `.d.ts` in sync with runtime exports.

## 0.2.0 → 0.3.0

Nothing breaks. Existing imports keep working. Adopt the new modules one at a time.

### Step 1: use the shipped types

0.3.0 ships `.d.ts` files. If the host declared its own ambient
`declare module "dataxray/core"` shim, **delete it**. The ambient shim takes
precedence and hides the new exports.

### Step 2: replace in-app copies with SDK imports

If your app built any of these features itself, swap them for the SDK version one at a time:

| In-app feature | SDK replacement | Watch for |
|---|---|---|
| Evidence/receipt type for a displayed number | `MetricEvidence` (`dataxray/core`) | Same fields as the documented contract. |
| Fingerprinting report JSON or query bodies | `definitionFingerprint(value)` | Keys sorted with `localeCompare`, `undefined` dropped, arrays kept in order. If your existing hashes came from the same canonical form, approvals survive. Check with one known definition before switching. |
| Freshness / availability checks | `isEvidenceFresh`, `isEvidenceAvailable`, `isVerifiableEvidence` | Default max age is 5 minutes; pass `maxAgeMs` to change it. |
| Applying approvals to a number | `governedEvidence(e, state, {available, now, maxAgeMs})` | Pass `available: false` when approvals can't be read. The verdict becomes stale instead of showing an old approval. |
| Tile/receipt status color | `evidenceStatus(e)` → `{label, tone}` | Map `tone` to your own CSS. The SDK ships no styling. |
| Share-link parsing/building | `parseShareView`, `buildShareLink`, `readShareParams`, `shareChoice`, `shareDate`, `shareAsOf` | `shareAsOf` takes your reporting `timeZone`. `buildShareLink` throws `ShareLinkError` rather than truncating. |
| Validation of saved comment context | `validateFeedbackContext` | Strict v1 limits. To keep a schema library at the route boundary, wrap it, e.g. `z.custom(v => validateFeedbackContext(v).ok)`. |
| A table of commentable components | `defineDashboard({targets, aliases, resolveTarget})` | IDs are permanent. Use `aliases` when a component moves. |
| Comment status transitions | `planStatusChange` | Call it inside your storage transaction, then persist `event`. |
| "Only user X can submit work" checks | `ScopePolicy.isBuilder(actor)` | Use a role or allowlist, never a hardcoded identity. |
| Dashboard/metric allowlists | `dashboard.hasScope(scope)` | Keep rejecting unknown scopes. |

### Step 3: decide approval policy explicitly

Approvals are optional. Configure them per dashboard, with per-metric overrides:

```js
defineDashboard({
  id: 'web', title: 'Web', metrics: ['web.visits', 'web.revenue'],
  approvals: {
    definitions: false,                  // most numbers here don't need sign-off...
    metrics: { 'web.revenue': true },    // ...except this one
    feedback: false,                     // builders close their own feedback work
    source: 'host',                      // or 'nest' for Context Nest governance
  },
});
// approvals: false turns both kinds off. Omitting it keeps both on.

governedEvidence(e, state, { approvals: dashboard.definitionApprovals(e.id) });
planStatusChange({ ...change, requireReview: dashboard.feedbackReview });
```

If you render verdicts yourself, handle `'ungoverned'` (definition approval off,
data current). It only appears for metrics you've opted out.

`ScopePolicy.canApprove` has no default. It must return false for metrics with
definition approval off. The host must choose. Options:
- any verified viewer (fast, weak separation of duties)
- the metric's owner/steward (the rule the bundled widget demo follows)

The host must also pick one source of truth for approvals: Context Nest
(`provider/governance.mjs`) or a host `GovernanceStore`. Don't run both for the same metric.

## Not yet in the SDK (planned)

- `dataxray/react`: an unstyled React layer (metric card + share menu + spotlight,
  receipt drawer, comments panel, component selection, runtime capture).
- Reference `GovernanceStore` / `CommentStore` adapters (SQLite; Context Nest).
- A generic MCP adapter for agents over any host that implements the comment routes.

Until those ship, hosts keep their own implementations behind the ports above. When
they ship, adopting them is optional and additive.
