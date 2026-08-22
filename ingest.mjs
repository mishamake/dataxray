// ingest.mjs — Dana's terminal: dbt manifest.json -> governed definition nodes.
//
// The interaction layer for the machine half of v2 (no admin UI by design):
// run this on dbt build, in CI. It parses the manifest, fingerprints each
// mapped model's compiled SQL with the deterministic core routine, and
// upserts definition nodes — current/draft version ONLY. It never authors an
// approved fingerprint and never moves the baseline; only a human approve
// does that (from the widget drawer).
//
// Real nest:
//   CONTEXTNEST_BASE_URL=https://<host> \
//   CONTEXTNEST_NEST_ID=<nest-id> \
//   CONTEXTNEST_TOKEN=cnst_<token> \
//   node ingest.mjs --manifest target/manifest.json
//
// Offline dry-run against the mock (prints what it would write):
//   node ingest.mjs --manifest target/manifest.json --mock

import fs from 'node:fs';
import { ingestManifest } from './provider/ingester.mjs';
import { nestClientFromEnv } from './provider/nest-client.mjs';
import { createMockNestClient } from './provider/mock-nest-client.mjs';

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}

const manifestPath = arg('manifest');
if (!manifestPath) {
  console.error('usage: node ingest.mjs --manifest <path-to-manifest.json> [--mock]');
  process.exit(2);
}
if (!fs.existsSync(manifestPath)) {
  console.error(`manifest not found: ${manifestPath}`);
  process.exit(2);
}
const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let client;
if (args.includes('--mock')) {
  client = createMockNestClient({ nestId: 'ingest-dry-run' });
  console.log('[ingest] --mock: running against MockNestClient (no network)');
} else {
  client = nestClientFromEnv();
  if (!client) {
    console.error('[ingest] missing env: set CONTEXTNEST_BASE_URL, CONTEXTNEST_NEST_ID, CONTEXTNEST_TOKEN (or pass --mock)');
    process.exit(2);
  }
  console.log(`[ingest] target nest: ${process.env.CONTEXTNEST_BASE_URL}/nests/${process.env.CONTEXTNEST_NEST_ID}`);
}

const res = await ingestManifest(client, manifestJson, { author: 'dbt-ingest (ci)' });
console.log(JSON.stringify({
  ok: true,
  created: res.created,
  updated: res.updated,
  fingerprints: res.fingerprints,
  ingestedAt: res.ingestedAt,
  note: 'current/draft versions only — no baseline was authored or moved. Only a human approve re-pins approvedVersion.',
}, null, 2));
