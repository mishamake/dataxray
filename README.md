# DataXray

**Trust the number without leaving the number.** A drop-in JavaScript library that adds a provenance affordance to any dashboard tile — and to any chat-on-data answer — so a consumer can see, at zero click-cost, whether a number is trustworthy, and click in for the full receipt: governed definition, drift receipt, lineage, health diagnostics, and a real governor loop.

The badge is not a vibe. It is a **deterministic verdict**: the SHA-256 fingerprint of the metric's current compiled dbt SQL, compared against the fingerprint a **human** last blessed in [Context Nest](https://github.com/promptowl) — the governed source of truth for what the metric means.

```
fingerprint@currentVersion  vs.  fingerprint@approvedVersion
        (the ingester writes this)      (only a human approve moves this)
```

## The two trust rules the whole design stands on

1. **No machine self-approval.** The ingester only ever writes a new *draft/current* version carrying the current fingerprint. It never authors an "approved" fingerprint and never moves the baseline. Only a human `approve` re-pins `approvedVersion` — that is the one act that blesses a fingerprint.
2. **Never silent-green.** If the ingest pipeline falls behind (stale heartbeat) or the nest is unreachable, the verdict degrades to a loud **"Stale · can't confirm current"** — never a cached or false "certified."

## Verdicts (zero-click badge states)

| Verdict | Meaning |
|---|---|
| **Certified & current** | fingerprints match, ingest fresh, nothing in review |
| **Drifted** | current SQL ≠ the human-blessed baseline — do not quote |
| **Change pending review** | fingerprints match, but a definition change is in review |
| **Stale · can't confirm current** | ingest heartbeat stale or provider unreachable — value renders as `—` |
| **Awaiting first approval** | a draft definition exists; no human has ever blessed it |

Precedence: `STALE > UNCERTIFIED > PENDING > CERTIFIED > DRIFTED` (first match wins; stale outranks everything).

## Quick start (demo, zero config)

Requires Node ≥ 18. No dependencies — plain ES modules.

```bash
node server.mjs --port 8000
# open http://127.0.0.1:8000
```

The demo runs against `MockNestClient` seeded in-page through the **real** ingester and governance methods — one metric per verdict state, including the drifted NRR case you can take through **propose → review → approve** (switch persona between Marcus · consumer and Priya · steward/owner in the top bar; approve/reject controls follow the acting node's owner, not a hardcoded name).

## Architecture

Three plain modules, no framework, no build step:

```
core/       pure, deterministic, DOM-free rules — normalize → SHA-256 fingerprint,
            drift compare, verdict precedence. No I/O, ever.
provider/   the only I/O layer — NestClient (real HTTP) / MockNestClient (offline twin),
            dbt-manifest ingester, governance mapper, freshness heartbeat.
widget/     the front-end SDK — badge + progressive-disclosure drawer (comments,
            governor loop), transport-agnostic (in-process or HTTP).
server.mjs  the thin proxy: holds the cnst_ token server-side and relays to the nest.
ingest.mjs  the ingest CLI (run on dbt build, in CI).
```

## Deployment reality (read this before "drop-in")

The `cnst_` token must never reach the browser, so production is:

```
widget (browser)  →  your thin proxy (server.mjs, holds the token)  →  hosted Context Nest
```

"Drop-in" means a snippet **plus** a proxy you host. `server.mjs` is that proxy: with env set it talks to the real nest; without env it falls back to the seeded mock for local dev.

```bash
CONTEXTNEST_BASE_URL=https://<host> \
CONTEXTNEST_NEST_ID=<nest-id> \
CONTEXTNEST_TOKEN=cnst_<token> \
node server.mjs --port 8000
```

In the browser, point the widget at the proxy's HTTP transport instead of the in-process one:

```js
import { createProvenanceWidget } from './widget/widget.mjs';
import { createHttpClient } from './widget/http-client.mjs';

const widget = createProvenanceWidget({
  client: createHttpClient('https://your-proxy.example.com'),
  persona: () => ({ name: 'A. User', handle: '@auser', role: 'Analyst' }),
});

widget.mount(document.querySelector('#nrr-badge'), {
  metricId: 'nrr', surface: 'dash', label: 'Net Revenue Retention', value: '118%',
});
```

## Ingest (the machine half — a CLI, not an admin UI)

On every dbt build, in CI:

```bash
CONTEXTNEST_BASE_URL=... CONTEXTNEST_NEST_ID=... CONTEXTNEST_TOKEN=cnst_... \
node ingest.mjs --manifest target/manifest.json
```

Parses `manifest.json` (models carrying `meta.metricId`), fingerprints each `compiled_sql` with the same core routine the drift check uses, and idempotently upserts `definition` nodes — **current/draft version only**. Re-running on unchanged SQL creates no duplicate node and refreshes the freshness heartbeat. Offline dry-run: `node ingest.mjs --manifest target/manifest.json --mock`.

## The governor loop + comments

- **Comments** attach to the metric's definition node (threads via `parentId`, resolve, open/resolved). **A bare comment does not notify anyone** — the UI says so plainly.
- **Flag to owner** opens/attaches a **review** — the only path that pings (watcher notification → Slack/Teams/webhook).
- **Propose a definition change** → `submit-review` (owner notified, `approvedVersion` unchanged) → owner **approves** (baseline re-pins, drift clears to *Certified & current*) or **rejects** (baseline unchanged, drift persists).
- Approve/reject/resolve controls are gated to the acting node's **owner/steward**; everyone else sees "Waiting on \<owner\>". Against a stale ingest, approval is **blocked** — approving would bless a number that can't be verified.

## Testing

```bash
npm test                  # 115 offline tests, deterministic, no network
npm run test:integration  # NETWORK contract test — needs env, runs outside the offline gate
```

The offline suite proves our wiring against `MockNestClient` (which mirrors the real API shapes). The integration test proves the **server contract** against a live/staging nest: that `submit-review` registers a review (the event watcher notifications key on) and that `approve` actually moves `approvedVersion`. It skips loudly without `CONTEXTNEST_BASE_URL` / `CONTEXTNEST_NEST_ID` / `CONTEXTNEST_TOKEN`.

## Known limitations (named, not hidden)

- **Audit attribution.** Every action posts under one shared service token, so the nest's audit trail records the *service account*, not the real person. Names in comments/approvals are self-asserted (forgeable, not authenticated). Per-user identity pass-through is roadmap, not shipped — the UI labels this wherever it matters.
- **A proxy is required.** There is no tokenless deployment.
- **The proxy has no authn of its own.** `/api/intent/*` accepts self-asserted author names from any caller that can reach it. Localhost demo is fine; a deployed proxy must sit behind your auth boundary (SSO/IAP/session) before anyone lets it approve things.
- **Governed-definition HTML renders raw.** The drawer's v1 governed-definition block interpolates nest-authored HTML directly (fixture markup uses `<code>`/`<b>`). User-generated fields (comments, authors) are HTML-escaped everywhere — but if you render nest frontmatter you don't fully trust, sanitize it or restrict it to markdown first.
- **dbt-first.** The metadata seam is a stable adapter interface (`ManifestAdapter`); warehouse/catalog/OpenLineage adapters can slot in behind it, but only dbt artifacts ship here.

## License

MIT — see [LICENSE](./LICENSE).
