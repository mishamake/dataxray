// app.mjs — the v2 demo host. Builds the sample dashboard (heatmap + tiles)
// and a chat-on-data surface, then drops the provenance widget onto every
// number. v2: the nest is REAL code — a MockNestClient seeded through the
// actual ingester + governance methods (swap for NestClient behind the proxy
// to go live). This file is DEMO glue only — no verdict logic (that's core).

import { createProvenanceWidget } from './widget/widget.mjs';
import { createClient } from './widget/client.mjs';
import { provider } from './provider/provider.mjs';
import { createMockNestClient } from './provider/mock-nest-client.mjs';
import { createGovernance } from './provider/governance.mjs';
import { seedNest, DEMO_PERSONAS } from './fixtures/seed-nest.mjs';
import { govBadgeMeta } from './widget/governance-render.mjs';
import { tiles, chat } from './fixtures/board.mjs';

/* ----------------------- boot: nest -> governance -> widget --------------- */
const nestClient = createMockNestClient({ nestId: 'demo-governed-metrics' });
await seedNest(nestClient); // real ingester + real governance methods, no back doors
const governance = createGovernance({ client: nestClient });
const client = createClient(provider, governance);

let currentWho = 'marcus';
const pingEl = document.getElementById('pingCount');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const toastSub = document.getElementById('toastSub');

let pings = 18;
const widget = createProvenanceWidget({
  client,
  persona: () => DEMO_PERSONAS[currentWho],
  onDeflect() {
    pings++;
    if (pingEl) pingEl.textContent = String(pings);
  },
  onAction({ title, sub }) {
    showToast(title, sub);
  },
  onChange() {
    buildDashboard(); // heatmap + tiles reflect the new governance state
  },
});

function showToast(msg, sub) {
  if (!toast) return;
  toastMsg.innerHTML = '<b>' + escape(msg) + '</b>';
  toastSub.textContent = sub || '';
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 4200);
}

/* ------------------------------ dashboard -------------------------------- */
async function buildDashboard() {
  const heatmap = document.getElementById('heatmap');
  const grid = document.getElementById('tileGrid');
  if (!heatmap || !grid) return;

  const governances = await Promise.all(
    tiles.map((t) => (t.metricId ? client.governance(t.metricId) : Promise.resolve(null)))
  );
  const metas = governances.map((g) => (g ? govBadgeMeta(g) : { cls: 'unknown', label: 'Unmapped' }));

  heatmap.innerHTML = '';
  tiles.forEach((t, i) => {
    const m = metas[i];
    const cell = document.createElement('button');
    cell.className = `cell ${m.cls}`;
    cell.setAttribute('aria-label', `${t.label}: ${m.label}`);
    cell.innerHTML = `<span class="cn">${escape(t.label)}</span><span class="cbar"></span><span class="cstatus">${statusDot(m.cls)} ${escape(m.label)}</span>`;
    cell.addEventListener('click', () => widget.open(t.metricId, 'dash', { label: t.label, value: t.value }));
    heatmap.appendChild(cell);
  });

  grid.innerHTML = '';
  tiles.forEach((t, i) => {
    const g = governances[i];
    const stale = g && g.mapped && !g.unavailable && g.verdict === 'stale';
    const tile = document.createElement('div');
    tile.className = 'tile';
    // US-6: a stale metric's value renders as — (never a quotable number).
    tile.innerHTML = `<div class="label">${escape(t.label)}</div>
      <div class="value">${stale ? '—' : escape(t.value)}</div>
      <div class="delta">${escape(t.delta || '')}</div>
      <span class="badge-slot"></span>`;
    grid.appendChild(tile);
    widget.mount(tile.querySelector('.badge-slot'), {
      metricId: t.metricId,
      surface: 'dash',
      label: t.label,
      value: t.value,
    });
  });
}

/* --------------------------------- chat ---------------------------------- */
function buildChat() {
  const feed = document.getElementById('chatFeed');
  if (!feed) return;
  feed.innerHTML = '';
  chat.forEach((turn) => {
    const q = document.createElement('div');
    q.className = 'msg user';
    q.innerHTML = `<div class="who">M</div><div class="bubble"><div class="lead" style="color:var(--text)">${escape(turn.question)}</div></div>`;
    feed.appendChild(q);

    const a = document.createElement('div');
    a.className = 'msg ai';
    a.innerHTML = `<div class="who">AI</div><div class="bubble">
      <p class="lead">${escape(turn.lead)}</p>
      <div class="answer-num">${escape(turn.value)} <span class="badge-slot"></span></div>
    </div>`;
    feed.appendChild(a);
    widget.mount(a.querySelector('.badge-slot'), {
      metricId: turn.metricId,
      surface: 'chat',
      label: turn.value + ' — ' + turn.question,
      value: turn.value,
    });
  });
}

/* ------------------------------ surfaces --------------------------------- */
function switchSurface(s) {
  const dash = s === 'dash';
  document.getElementById('surface-dash').classList.toggle('hidden', !dash);
  document.getElementById('surface-chat').classList.toggle('hidden', dash);
  document.getElementById('tab-dash').setAttribute('aria-selected', String(dash));
  document.getElementById('tab-chat').setAttribute('aria-selected', String(!dash));
}
document.getElementById('tab-dash').addEventListener('click', () => switchSurface('dash'));
document.getElementById('tab-chat').addEventListener('click', () => switchSurface('chat'));

/* --------------------------- persona switch ------------------------------ */
const whoSel = document.getElementById('whoSel');
whoSel.addEventListener('change', async () => {
  currentWho = whoSel.value;
  const p = DEMO_PERSONAS[currentWho];
  showToast(`Viewing as ${p.name}`, `${p.role} · ${p.handle} — governor controls follow the acting node's owner, not a hardcoded name.`);
  await widget.refresh();
  buildDashboard();
});

/* --------------------------- provider outage ----------------------------- */
const outageBtn = document.getElementById('outageBtn');
outageBtn.addEventListener('click', async () => {
  const next = !client.isOutage();
  client.setOutage(next);
  outageBtn.setAttribute('aria-pressed', String(next));
  outageBtn.querySelector('.outage-label').textContent = next ? 'Provider: offline' : 'Simulate outage';
  await widget.refresh();
  await buildDashboard();
  showToast(next ? 'Provider offline — badges fail loud, never silent-green' : 'Provider back online');
});

/* --------------------------------- init ---------------------------------- */
function statusDot(s) {
  return `<span class="dot-ico ${s}"></span>`;
}
function escape(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

buildChat();
buildDashboard();
