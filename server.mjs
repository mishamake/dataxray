// server.mjs — the thin proxy (the v2 deployment reality, made runnable).
//
//   widget (browser) -> THIS server (holds the cnst_ token) -> hosted Context Nest
//
// The browser never sees the token. With CONTEXTNEST_BASE_URL /
// CONTEXTNEST_NEST_ID / CONTEXTNEST_TOKEN set, governed reads + writes go to
// the real nest; without them the server falls back to the seeded mock so the
// demo runs with zero config. It also serves the demo statics.
//
//   node server.mjs [--port 8000]
//
// Endpoints (all JSON):
//   GET  /api/governance/:metricId?persona=@handle
//   GET  /api/provenance/:metricId · /api/stats/:metricId · /api/health/:metricId
//   POST /api/intent/:metricId/comment   { body, parentId?, flagToOwner?, author, authorHandle }
//   POST /api/intent/:metricId/resolve   { commentId }
//   POST /api/intent/:metricId/propose|approve|reject   { author, authorHandle }

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { provider } from './provider/provider.mjs';
import { createGovernance } from './provider/governance.mjs';
import { nestClientFromEnv } from './provider/nest-client.mjs';
import { createMockNestClient } from './provider/mock-nest-client.mjs';
import { seedNest } from './fixtures/seed-nest.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv.find((a, i) => process.argv[i - 1] === '--port') || process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

/* ------------------------- backend: real or mock ------------------------ */
let nestClient = nestClientFromEnv();
let backend = 'real';
if (!nestClient) {
  nestClient = createMockNestClient({ nestId: 'demo-governed-metrics' });
  await seedNest(nestClient);
  backend = 'mock (set CONTEXTNEST_BASE_URL / CONTEXTNEST_NEST_ID / CONTEXTNEST_TOKEN for the real nest)';
}
const governance = createGovernance({ client: nestClient });

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = decodeURIComponent(url.pathname);

  try {
    /* ------------------------------ API ------------------------------- */
    const govMatch = p.match(/^\/api\/governance\/(.+)$/);
    if (req.method === 'GET' && govMatch) {
      const out = await governance.getGovernance(govMatch[1], {
        personaHandle: url.searchParams.get('persona'),
      });
      return send(res, 200, out);
    }
    const intentMatch = p.match(/^\/api\/intent\/(.+)\/(comment|resolve|propose|approve|reject)$/);
    if (req.method === 'POST' && intentMatch) {
      const [, metricId, action] = intentMatch;
      const body = await readBody(req);
      let out;
      if (action === 'comment') out = await governance.postComment(metricId, body);
      else if (action === 'resolve') out = await governance.resolveComment(metricId, body.commentId);
      else out = await governance[action](metricId, body);
      return send(res, 200, out);
    }
    const v1 = p.match(/^\/api\/(provenance|stats|health)\/(.+)$/);
    if (req.method === 'GET' && v1) {
      const fn = { provenance: 'getProvenance', stats: 'getStats', health: 'getHealth' }[v1[1]];
      return send(res, 200, await provider[fn](v1[2]));
    }
    if (req.method === 'GET' && p === '/api/backend') {
      return send(res, 200, { backend, nestId: nestClient.nestId });
    }

    /* ----------------------------- statics ----------------------------- */
    let file = path.join(dir, p === '/' ? 'index.html' : p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('404 ' + p);
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    send(res, err.status || 500, { error: String((err && err.message) || err) });
  }
});

server.listen(PORT, () => {
  console.log(`provenance proxy listening on http://127.0.0.1:${PORT}  ·  nest backend: ${backend}`);
});
