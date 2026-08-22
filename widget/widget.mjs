// widget/widget.mjs
// The thin front-end SDK. Mounts the verdict-carrying badge on a tile or a
// chat answer and opens the progressive-disclosure drawer. Holds NO
// credentials and NO verdict logic — every status comes from the endpoints.
// v2: the badge is driven by the GOVERNANCE verdict (fingerprint@current vs
// fingerprint@approved), and the drawer carries the governor loop + comments.

import { createClient } from './client.mjs';
import {
  badgeMarkup,
  renderBody,
  renderFoot,
  renderUnmapped,
  renderUnavailable,
  renderDiag,
  renderLLM,
  renderComposite,
  renderLineage,
  renderTests,
  renderRelated,
  renderReceipt,
  healthTagFor,
  STATUS_LABEL,
} from './render.mjs';
import { renderGovernanceBody, govBadgeMeta } from './governance-render.mjs';
import { BADGE_ICON } from './icons.mjs';
import { sectionIcon } from './icons.mjs';

const SURFACE_TAG = {
  dash: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};

export function createProvenanceWidget(opts = {}) {
  const client = opts.client || createClient();
  const onDeflect = typeof opts.onDeflect === 'function' ? opts.onDeflect : () => {};
  const onAction = typeof opts.onAction === 'function' ? opts.onAction : () => {};
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
  const getPersona =
    typeof opts.persona === 'function' ? opts.persona : () => opts.persona || null;
  const now = opts.now; // optional fixed clock for stable demos/tests

  // ---- one shared drawer ----
  const scrim = el('div', 'pw-scrim');
  const drawer = el('aside', 'pw-drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Provenance details');
  drawer.innerHTML = `
    <div class="pw-drawer-head">
      <div class="pw-head-main">
        <div class="pw-surface-tag"></div>
        <h3 class="pw-title">—</h3>
        <div class="pw-num"></div>
      </div>
      <button class="pw-x" aria-label="Close panel">✕</button>
    </div>
    <div class="pw-drawer-body"></div>
    <div class="pw-drawer-foot"></div>`;
  document.body.appendChild(scrim);
  document.body.appendChild(drawer);

  const $body = drawer.querySelector('.pw-drawer-body');
  const $foot = drawer.querySelector('.pw-drawer-foot');
  const $title = drawer.querySelector('.pw-title');
  const $num = drawer.querySelector('.pw-num');
  const $tag = drawer.querySelector('.pw-surface-tag');
  let lastFocus = null;
  let active = null; // { metricId, surface, meta }
  const badgeButtons = new Map(); // metricId -> Set of badge buttons to repaint

  function openDrawer() {
    scrim.classList.add('open');
    drawer.classList.add('open');
    $body.scrollTop = 0;
    lastFocus = document.activeElement;
    drawer.querySelector('.pw-x').focus();
  }
  function closeDrawer() {
    scrim.classList.remove('open');
    drawer.classList.remove('open');
    active = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  scrim.addEventListener('click', closeDrawer);
  drawer.querySelector('.pw-x').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });
  drawer.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pw-deflect]');
    if (t) {
      onDeflect(t.getAttribute('data-pw-deflect'));
      closeDrawer();
    }
  });

  /* ---------------------- v1 deep-drawer sections ----------------------- */
  function deepSections(prov, health, stats) {
    const status = health.status;
    let html = `<hr class="pw-sep">`;
    const openHealth = status !== 'ok' ? 'open' : '';
    html += `<details class="pw-disclose" ${openHealth}>
      <summary>${sectionIcon('pulse')} Health diagnostics ${healthTagFor(status)} <span class="pw-chev">›</span></summary>
      <div class="pw-disclose-body">${renderDiag(health.signals)}${renderLLM(health.narration)}</div>
    </details>`;
    if (health.composite) html += renderComposite(health.composite);
    const drifted = prov.driftReceipt != null;
    html += `<details class="pw-disclose">
      <summary>${sectionIcon('flow')} Lineage · source → bronze → silver → gold ${drifted ? '<span class="pw-sm bad">drift at gold</span>' : ''} <span class="pw-chev">›</span></summary>
      <div class="pw-disclose-body">${renderLineage(prov.lineage)}</div>
    </details>`;
    const failCount = (prov.tests || []).filter((t) => !t.pass).length;
    html += `<details class="pw-disclose">
      <summary>${sectionIcon('check')} dbt test results ${failCount ? `<span class="pw-sm bad">${failCount} failing</span>` : '<span class="pw-sm ok">all pass</span>'} <span class="pw-chev">›</span></summary>
      <div class="pw-disclose-body">${renderTests(prov.tests)}</div>
    </details>`;
    html += `<details class="pw-disclose">
      <summary>${sectionIcon('siblings')} Look-alike &amp; related fields <span class="pw-sm">${(prov.related || []).length}</span> <span class="pw-chev">›</span></summary>
      <div class="pw-disclose-body">${renderRelated(prov.related)}</div>
    </details>`;
    return html;
  }

  /* ------------------------- fetch + render body ------------------------ */
  async function renderActive() {
    const { metricId, surface, meta } = active;
    const persona = getPersona();

    const [g, prov, health, stats] = await Promise.all([
      client.hasGovernance()
        ? client.governance(metricId, { now, personaHandle: persona && persona.handle })
        : Promise.resolve(null),
      client.provenance(metricId, { now }),
      client.health(metricId, { now }),
      client.stats(metricId, { now }),
    ]);

    // Loud outage: the governance read failed -> never a cached green.
    if (g && g.unavailable) {
      $body.innerHTML = renderUnavailable();
      $foot.innerHTML = '';
      return;
    }
    if (health.unavailable || prov.unavailable) {
      $body.innerHTML = renderUnavailable();
      $foot.innerHTML = '';
      return;
    }
    if (!prov.mapped || health.status === 'unknown' || (g && !g.mapped)) {
      $body.innerHTML = renderUnmapped(meta.value);
      $foot.innerHTML = renderFoot({ metricId: metricId || null }, { status: 'unknown', flavor: null });
      return;
    }

    // US-6: a stale metric's value renders as — (never a quotable number).
    if (g && g.verdict === 'stale') $num.textContent = '—';

    if (g && g.mapped) {
      // v2 body: governance blocks first, then the v1 deep sections.
      let html = '';
      if (surface === 'chat') {
        html += `<div class="pw-resolved">Resolved to <code>metric.${escapeHtml(prov.metricId)}</code> — same badge, same panel as a dashboard tile.</div>`;
      }
      html += renderGovernanceBody(g, persona);
      // The v1 SQL diff receipt rides inside the drift story when drifted.
      if (prov.driftReceipt) html += renderReceipt(prov.driftReceipt);
      html += deepSections(prov, health, stats);
      $body.innerHTML = html;
      $foot.innerHTML = `<div class="pw-footnote">Actions here write to the nest via the service token — the audit trail names the service account, not ${escapeHtml(
        persona && persona.name ? persona.name : 'you'
      )}. Author names are self-asserted.</div>`;
      wireGovernance(metricId, g);
    } else {
      // v1 fallback (no governance source wired): the classic drawer.
      $body.innerHTML = renderBody(prov, health, stats, surface);
      $foot.innerHTML = renderFoot(prov, health);
    }
  }

  /* --------------------------- intent wiring ---------------------------- */
  function wireGovernance(metricId) {
    const persona = getPersona() || { name: 'anonymous', handle: null, role: '' };
    const composer = $body.querySelector('.pw-composer');
    const input = $body.querySelector('[data-pw-comment-input]');
    const flag = $body.querySelector('[data-pw-flag-owner]');
    const replying = $body.querySelector('[data-pw-replying]');
    let replyParentId = null;

    async function act(kind, fn, toast) {
      const res = await fn();
      if (res && res.unavailable) {
        onAction({ kind: 'error', title: 'Provider unavailable', sub: 'The action did not reach the nest — nothing was written.' });
        return;
      }
      if (toast) onAction(toast(res));
      if (kind !== 'comment' || (res && !res.unavailable)) onDeflect('Governed without a Slack ping');
      await renderActive(); // re-read governance: the badge/ladder reflect the new state
      repaintBadges(metricId);
      onChange(metricId);
    }

    $body.querySelector('[data-pw-post]')?.addEventListener('click', () => {
      const body = (input.value || '').trim();
      if (!body) return;
      const flagToOwner = !!(flag && flag.checked);
      act('comment',
        () => client.postComment(metricId, {
          body,
          parentId: replyParentId,
          flagToOwner,
          author: persona.name,
          authorHandle: persona.handle,
        }),
        (res) => res.notified
          ? { kind: 'notify', title: `Review opened — owner notified`, sub: 'A watcher notification fired. This is the real ping path; a bare comment would not have notified.' }
          : { kind: 'comment', title: 'Comment posted to the definition', sub: 'No notification was sent — a bare comment doesn\u2019t ping anyone.' }
      );
    });

    $body.querySelectorAll('[data-pw-reply]').forEach((b) =>
      b.addEventListener('click', () => {
        replyParentId = b.getAttribute('data-pw-reply');
        replying.classList.remove('hidden');
        replying.querySelector('[data-pw-replying-name]').textContent =
          b.getAttribute('data-pw-reply-name') || 'comment';
        input.focus();
      })
    );
    $body.querySelector('[data-pw-cancel-reply]')?.addEventListener('click', () => {
      replyParentId = null;
      replying.classList.add('hidden');
    });

    $body.querySelectorAll('[data-pw-resolve]').forEach((b) =>
      b.addEventListener('click', () =>
        act('resolve',
          () => client.resolveComment(metricId, b.getAttribute('data-pw-resolve')),
          () => ({ kind: 'comment', title: 'Thread resolved', sub: 'It stays on the definition for the next reader. Resolving a comment ≠ moving governance.' })
        )
      )
    );

    $body.querySelector('[data-pw-propose]')?.addEventListener('click', () =>
      act('propose',
        () => client.propose(metricId, { author: persona.name, authorHandle: persona.handle }),
        () => ({ kind: 'notify', title: 'Submitted for review — owner notified', sub: 'submit-review fired a watcher notification. approvedVersion stays put until a human approves.' })
      )
    );

    $body.querySelector('[data-pw-approve]')?.addEventListener('click', () =>
      act('approve',
        () => client.approve(metricId, { author: persona.name, authorHandle: persona.handle }),
        () => ({ kind: 'approve', title: 'Approved — baseline re-pinned', sub: 'approvedVersion moved. The current fingerprint is now the blessed one, so the drift clears to Certified & current.' })
      )
    );

    $body.querySelector('[data-pw-reject]')?.addEventListener('click', () =>
      act('reject',
        () => client.reject(metricId, { author: persona.name, authorHandle: persona.handle }),
        () => ({ kind: 'reject', title: 'Change rejected', sub: 'approvedVersion unchanged — rejection blesses nothing. The number stays flagged while fingerprints differ.' })
      )
    );
  }

  async function open(metricId, surface, meta) {
    $title.textContent = meta.label || metricId || 'Unmapped tile';
    $num.textContent = meta.value ? `${meta.value}` : '';
    $tag.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${SURFACE_TAG[surface] || SURFACE_TAG.dash}</svg> ${surface === 'chat' ? 'On a chat answer' : 'On a dashboard tile'}`;

    if (!metricId) {
      $body.innerHTML = renderUnmapped(meta.value);
      $foot.innerHTML = renderFoot({ metricId: null }, { status: 'unknown', flavor: null });
      openDrawer();
      return;
    }

    active = { metricId, surface, meta };
    await renderActive();
    openDrawer();
  }

  /* ------------------------------ badges -------------------------------- */
  function trackBadge(metricId, btn) {
    if (!badgeButtons.has(metricId)) badgeButtons.set(metricId, new Set());
    badgeButtons.get(metricId).add(btn);
  }
  function paintBadge(btn, meta) {
    btn.className = `pw-badge ${meta.cls}`;
    btn.innerHTML = `${BADGE_ICON[meta.cls] || BADGE_ICON.unknown} <span>${escapeHtml(meta.label)}</span>`;
    btn.setAttribute('aria-label', `Provenance: ${meta.label}. Click to inspect.`);
  }
  function repaintBadges(metricId) {
    const set = badgeButtons.get(metricId);
    if (!set) return;
    set.forEach((btn) => resolveBadge(metricId).then((m) => paintBadge(btn, m)));
  }
  async function resolveBadge(metricId) {
    if (client.hasGovernance()) {
      const g = await client.governance(metricId, { now });
      return govBadgeMeta(g);
    }
    const h = await client.health(metricId, { now });
    const status = h.unavailable ? 'unavailable' : h.status || 'unknown';
    return {
      cls: status,
      label:
        STATUS_LABEL[status] ||
        (status === 'unavailable' ? 'Unavailable' : status === 'loading' ? 'Checking…' : 'Unmapped'),
    };
  }

  // ---- mount a badge on a host tile/answer ----
  function mount(target, { metricId = null, surface = 'dash', label = '', value = '' } = {}) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) return null;

    const initialStatus = metricId ? 'loading' : 'unknown';
    host.innerHTML = badgeMarkup(initialStatus, BADGE_ICON);
    const btn = host.querySelector('[data-pw-open]');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      open(metricId, surface, { label, value });
    });

    // Carry the verdict BEFORE any click (US-1): resolve status, then paint.
    if (metricId) {
      trackBadge(metricId, btn);
      resolveBadge(metricId)
        .then((m) => paintBadge(btn, m))
        .catch(() => paintBadge(btn, { cls: 'unavailable', label: 'Unavailable' }));
    }

    return {
      el: btn,
      open: () => open(metricId, surface, { label, value }),
    };
  }

  async function refresh() {
    badgeButtons.forEach((set, metricId) => repaintBadges(metricId));
    if (active) await renderActive();
  }

  return { mount, open, close: closeDrawer, refresh, client };
}

/* ------------------------------ helpers ---------------------------------- */
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
