// widget/render.mjs
// Pure presentation: endpoint payloads in -> HTML strings out. No verdict logic
// here (that came from the core via the endpoints); only labels, wording, and
// open-by-default display rules live in the widget. No internal ids/seeds/hashes
// are surfaced except the intended drift fingerprints and metric.<id>.

import { STATUS_LABEL } from '../core/index.mjs';
import { VERDICT_ICON, NEST_GLYPH, chipIcon, sectionIcon } from './icons.mjs';

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { STATUS_LABEL };

/* ---------------- verdict banner copy (deterministic status only) --------- */
function verdictCopy(health, prov) {
  const status = health.status;
  const flavor = health.flavor;
  if (status === 'ok') {
    return {
      title: 'Certified — safe to quote',
      text: 'The governed definition and the live dbt SQL match exactly, tests pass, and the data is fresh. The verdict is deterministic — from the fingerprint and tests, not an opinion.',
    };
  }
  if (status === 'warn') {
    return {
      title: 'Certified — but stale',
      text: 'The definition matches and tests pass, but freshness is breached against the SLA. The meaning is fine; the value is out of date. Fitness reduced.',
    };
  }
  if (status === 'bad' && flavor === 'drift') {
    return {
      title: 'Drift detected — do NOT quote',
      text: 'The compiled SQL behind this number no longer matches the governed definition it was approved against. The fingerprint mismatch proves it — no LLM opinion, no human toggle.',
    };
  }
  if (status === 'bad' && flavor === 'test') {
    return {
      title: 'Data-quality tests failing — do NOT quote',
      text: 'One or more dbt tests are failing on this model. The number may be wrong at the row level regardless of its definition.',
    };
  }
  // unapproved / ungoverned
  return {
    title: 'Not governed — no approved definition',
    text: prov && prov.governed
      ? 'A definition exists but it is not approved in the health config, so this number is not certified.'
      : 'This tile has no governed semantic definition in Context Nest and no owner has approved what it means. Anyone could read it differently.',
  };
}

/* ------------------------------ badge ------------------------------------ */
export function badgeMarkup(status, iconMap, opts = {}) {
  const label =
    STATUS_LABEL[status] ||
    (status === 'unavailable' ? 'Unavailable' : status === 'loading' ? 'Checking…' : 'Unmapped');
  const cls = ['pw-badge', status];
  const aria = `Provenance: ${label}. Click to inspect.`;
  return `<button class="${cls.join(' ')}" data-pw-open="1" aria-label="${escapeHtml(aria)}">${iconMap[status] || iconMap.unknown} <span>${escapeHtml(label)}</span></button>`;
}

/* --------------------------- unavailable state --------------------------- */
export function renderUnavailable() {
  return `<div class="pw-empty">
    <div class="pw-eico bad">${VERDICT_ICON.unavailable}</div>
    <h4>Provider unavailable</h4>
    <p>The widget couldn't reach the provenance endpoints (the nest or the dbt artifacts). We won't show a green badge we can't stand behind.</p>
    <div class="pw-honest">This is a loud transport failure — deliberately distinct from an unmapped tile. No verdict is being claimed either way.</div>
  </div>`;
}

/* ------------------------------ unmapped --------------------------------- */
export function renderUnmapped(value) {
  return `<div class="pw-empty">
    <div class="pw-eico unknown">${VERDICT_ICON.unknown}</div>
    <h4>Provenance not available</h4>
    <p>This tile isn't mapped to a governed metric id, so we can't trace where <b>${escapeHtml(value || 'this number')}</b> came from.</p>
    <div class="pw-honest">We won't fake a verdict. An unmapped number is neither trusted nor flagged — just unknown.</div>
  </div>`;
}

/* ------------------------- full disclosure body -------------------------- */
export function renderBody(prov, health, stats, surface) {
  const status = health.status;
  const copy = verdictCopy(health, prov);
  let html = '';

  // Chat parity line (US-6): name the resolved metric id.
  if (surface === 'chat') {
    html += `<div class="pw-resolved">Resolved to <code>metric.${escapeHtml(prov.metricId)}</code> — same badge, same panel as a dashboard tile.</div>`;
  }

  // DEPTH 1 — verdict banner.
  html += `<div class="pw-verdict ${status}">
    <div class="pw-vtop">${VERDICT_ICON[status] || VERDICT_ICON.unknown} ${escapeHtml(copy.title)}</div>
    <div class="pw-vsub">${escapeHtml(copy.text)}</div>
  </div>`;

  // Provenance-of-the-provenance.
  if (prov.provenanceAsOf) {
    html += `<div class="pw-asof">Provenance as of manifest run ${escapeHtml(fmtWhen(prov.provenanceAsOf))}</div>`;
  }

  // Supersession notice.
  if (prov.supersededBy) {
    html += `<div class="pw-supersede">Superseded by <code>metric.${escapeHtml(prov.supersededBy)}</code> — prefer the newer governed metric.</div>`;
  }

  // Plain-language definition.
  html += `<div class="pw-field"><div class="pw-k">What this means (plain language)</div>
    <div class="pw-plain">${escapeHtml(prov.definition.plain)}</div></div>`;

  // Governed semantic definition (real metric.<id> rendered, never blank).
  if (prov.governed && prov.definition.governed) {
    const matchNote = prov.definition.matchesLiveSql ? ' · matches live SQL' : '';
    html += `<div class="pw-field" style="margin-top:14px"><div class="pw-k">Governed semantic definition</div>
      <div class="pw-governed">${prov.definition.governed}
        <div class="pw-src">${NEST_GLYPH} Source of truth: Context Nest · <code>metric.${escapeHtml(prov.metricId)}</code>${matchNote}</div>
      </div></div>`;
  } else {
    html += `<div class="pw-field" style="margin-top:14px"><div class="pw-k">Governed semantic definition</div>
      <div class="pw-governed flag">
        <b class="pw-bad-text">None — no approved definition exists in Context Nest.</b> Its meaning is undefined and ungoverned.
        <div class="pw-src">${NEST_GLYPH} Context Nest returned no governed record for <code>metric.${escapeHtml(prov.metricId)}</code></div>
      </div></div>`;
  }

  // Certification chips.
  html += `<div class="pw-chips">
    <span class="pw-chip">${chipIcon('user')} Owner: ${escapeHtml(prov.owner)}</span>
    <span class="pw-chip">${chipIcon('shield')} Steward: ${escapeHtml(prov.steward)}</span>
    <span class="pw-chip">${chipIcon('clock')} ${escapeHtml(prov.certifiedOn)}</span>
  </div>`;

  // DRIFT RECEIPT at depth 1 (the headline), right after the verdict.
  if (prov.driftReceipt) {
    html += renderReceipt(prov.driftReceipt);
  }

  html += `<hr class="pw-sep">`;

  // DEPTH 2 — health diagnostics. Open by default when not certified (US-4).
  const openHealth = status !== 'ok' ? 'open' : '';
  const healthTag = healthTagFor(status);
  html += `<details class="pw-disclose" ${openHealth}>
    <summary>${sectionIcon('pulse')} Health diagnostics ${healthTag} <span class="pw-chev">›</span></summary>
    <div class="pw-disclose-body">
      ${renderDiag(health.signals)}
      ${renderLLM(health.narration)}
    </div>
  </details>`;

  // Composite worst-of gate detail.
  if (health.composite) {
    html += renderComposite(health.composite);
  }

  // DEPTH 3 — lineage.
  const drifted = prov.driftReceipt != null;
  html += `<details class="pw-disclose">
    <summary>${sectionIcon('flow')} Lineage · source → bronze → silver → gold ${drifted ? '<span class="pw-sm bad">drift at gold</span>' : ''} <span class="pw-chev">›</span></summary>
    <div class="pw-disclose-body">${renderLineage(prov.lineage)}</div>
  </details>`;

  // dbt tests.
  const failCount = (prov.tests || []).filter((t) => !t.pass).length;
  html += `<details class="pw-disclose">
    <summary>${sectionIcon('check')} dbt test results ${failCount ? `<span class="pw-sm bad">${failCount} failing</span>` : '<span class="pw-sm ok">all pass</span>'} <span class="pw-chev">›</span></summary>
    <div class="pw-disclose-body">${renderTests(prov.tests)}</div>
  </details>`;

  // look-alike / related.
  html += `<details class="pw-disclose">
    <summary>${sectionIcon('siblings')} Look-alike &amp; related fields <span class="pw-sm">${(prov.related || []).length}</span> <span class="pw-chev">›</span></summary>
    <div class="pw-disclose-body">${renderRelated(prov.related)}</div>
  </details>`;

  return html;
}

function healthTagFor(status) {
  if (status === 'ok') return '<span class="pw-sm ok">Healthy</span>';
  if (status === 'warn') return '<span class="pw-sm warn">Reduced</span>';
  return '<span class="pw-sm bad">At risk</span>';
}

// v2: the deep-drawer section renderers are exported so the governance body
// composer (governance-render.mjs) can place them below the governor blocks.
export {
  healthTagFor,
  renderDiag,
  renderLLM,
  renderComposite,
  renderLineage,
  renderTests,
  renderRelated,
  renderReceipt,
  fmtWhen,
};

function renderReceipt(d) {
  return `<div class="pw-receipt">
    <div class="pw-rhead">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
      <b>Definition-vs-implementation drift · the receipt</b>
      <span class="pw-rtag">deterministic · SQL fingerprint</span>
    </div>
    <div class="pw-rbody">
      <div class="pw-rline"><span class="pw-rk">What changed</span><span>${escapeHtml(d.whatChanged)}</span></div>
      <div class="pw-rline"><span class="pw-rk">Who &amp; when</span><span><code>${escapeHtml(d.changedBy)}</code>${d.when ? ' · ' + escapeHtml(fmtWhen(d.when)) : ''}</span></div>
      <div class="pw-rline"><span class="pw-rk">Commit / PR</span><span>${d.commit ? '<code>' + escapeHtml(d.commit) + '</code>' : '—'}${d.pr ? ' · ' + escapeHtml(d.pr) : ''}</span></div>
      <div class="pw-diff">${(d.diff || []).map((l) => `<span class="pw-dl ${l.t}">${escapeHtml(diffPrefix(l.t) + l.s)}</span>`).join('')}</div>
      <div class="pw-fp">
        <div class="pw-fpcol approved"><div class="pw-fpk">Approved fingerprint</div><div class="pw-fpv">${escapeHtml(shortFp(d.approvedFingerprint))}</div></div>
        <div class="pw-fpcol current"><div class="pw-fpk">Current compiled SQL</div><div class="pw-fpv">${escapeHtml(shortFp(d.currentFingerprint))}</div></div>
      </div>
      <div class="pw-rfoot">Hashes don't match → flagged automatically. The fingerprint recorded at approval time simply stopped matching the compiled SQL in the latest <code>manifest.json</code>.</div>
    </div>
  </div>`;
}

function renderDiag(signals) {
  const d = (sig, label, icon) => {
    const s = sig || { value: 'n/a', note: 'not available', state: 'unavailable', level: 0 };
    const cls = s.state === 'good' ? 'good' : s.state === 'warn' ? 'warn' : s.state === 'bad' ? 'bad' : 'na';
    const pct = Math.round((s.level || 0) * 100);
    return `<div class="pw-d ${cls}">
      <div class="pw-dk">${icon} ${escapeHtml(label)}</div>
      <div class="pw-dv">${escapeHtml(s.value)}</div>
      <div class="pw-dnote">${escapeHtml(s.note)}</div>
      <div class="pw-meter"><i style="width:${pct}%"></i></div>
    </div>`;
  };
  return `<div class="pw-diag">
    ${d(signals.fill, 'Fill rate', '◧')}
    ${d(signals.freshness, 'Update frequency', '⟳')}
    ${d(signals.distribution, 'Distribution', '∿')}
    ${d(signals.volumeDrift, 'Volume drift', '⇅')}
  </div>`;
}

function renderLLM(narration) {
  const text = (narration && narration.text) || 'No narration available for this metric.';
  return `<div class="pw-llm">
    <div class="pw-lh">✦ LLM summary <span class="pw-lh-sub">— narration, not a verdict</span></div>
    <p>${escapeHtml(text)}</p>
    <div class="pw-disclaimer">This paragraph only restates the deterministic signals above (fill, freshness, distribution, drift, tests). It never independently decides trust — the fingerprint and tests do.</div>
  </div>`;
}

function renderComposite(c) {
  const rows = c.inputs
    .map(
      (i) =>
        `<div class="pw-crow"><code>metric.${escapeHtml(i.metricId)}</code><span class="pw-sm ${i.status}">${escapeHtml(STATUS_LABEL[i.status] || i.status)}</span></div>`
    )
    .join('');
  return `<div class="pw-composite">
    <div class="pw-k">Composite — worst-of gate (no averaging)</div>
    <div class="pw-crows">${rows}</div>
    <div class="pw-cnote">Overall = worst of the named inputs: <span class="pw-sm ${c.worstOf}">${escapeHtml(STATUS_LABEL[c.worstOf] || c.worstOf)}</span>. If either input drifted, this tile goes red — a good input can't dilute a bad one.</div>
  </div>`;
}

function renderLineage(hops) {
  return `<div class="pw-lineage">${(hops || [])
    .map(
      (h) => `<div class="pw-hop ${h.drift ? 'drift' : ''}">
      <span class="pw-node"></span>
      <div class="pw-layer">${escapeHtml(h.layer)}${h.drift ? ' · ⚠ drift here' : ''}</div>
      <div class="pw-model">${escapeHtml(h.model)}</div>
      <div class="pw-modelsub">${escapeHtml(h.transform)}</div>
      <details><summary>View dbt model + SQL</summary><pre class="pw-sql">${escapeHtml(h.sql)}</pre></details>
    </div>`
    )
    .join('')}</div>`;
}

function renderTests(tests) {
  return `<div class="pw-tests">${(tests || [])
    .map(
      (t) => `<div class="pw-test ${t.pass ? 'pass' : 'fail'}">
      <span class="pw-tico">${t.pass ? '✓' : '✕'}</span>
      <span><b>${escapeHtml(t.name)}</b> · <code>${escapeHtml(t.column)}</code></span>
      <span class="pw-tres">${t.pass ? 'PASS' : 'FAIL'}</span>
    </div>`
    )
    .join('')}</div>`;
}

function renderRelated(rel) {
  if (!rel || rel.length === 0) {
    return `<div class="pw-modelsub" style="padding:12px 0">No related fields recorded for this metric.</div>`;
  }
  return `<div class="pw-related">${rel
    .map(
      (r) => `<div class="pw-rel">
      <span class="pw-rname">${escapeHtml(r.name)}</span>
      <span class="pw-rmatch">${escapeHtml(r.match)}</span>
      <span class="pw-rgov ${r.governed ? 'ok' : 'no'}">${r.governed ? 'governed' : 'ungoverned'}</span>
    </div>`
    )
    .join('')}</div>`;
}

/* ------------------------------ footer ----------------------------------- */
export function renderFoot(prov, health) {
  if (health.status === 'unknown') {
    return `<button class="pw-btn" data-pw-deflect="Requested a provenance mapping for this tile">
      ${chipIcon('link')} Ask Priya to map this tile</button>
      <div class="pw-footnote">Read-only widget — it discloses, it never edits definitions.</div>`;
  }
  if (health.status === 'bad' || health.status === 'warn') {
    const verb =
      health.flavor === 'drift'
        ? 'flag the drift to the owner'
        : health.flavor === 'unapproved'
        ? 'ask the owner to govern this'
        : health.flavor === 'test'
        ? 'flag the failing tests'
        : 'notify the owner about staleness';
    return `<button class="pw-btn bad" data-pw-deflect="You resolved this yourself — no data-team meeting needed">
      ${chipIcon('flag')} One-click: ${escapeHtml(verb)}</button>
      <div class="pw-footnote">You just answered "is this number right?" without a Slack ping. That's the ROI.</div>`;
  }
  return `<button class="pw-btn" data-pw-deflect="Confirmed trusted — quoted with confidence">
    ${chipIcon('check2')} Looks good — I can quote this</button>
    <div class="pw-footnote">80% of readers stop at the verdict above. You went deeper because you could.</div>`;
}

/* ------------------------------ helpers ---------------------------------- */
function diffPrefix(t) {
  return t === 'add' ? '+ ' : t === 'del' ? '- ' : '  ';
}
function shortFp(fp) {
  if (!fp) return '—';
  const hex = fp.replace(/^sha256:/, '');
  return 'sha256:' + hex.slice(0, 4) + '…' + hex.slice(-4);
}
function fmtWhen(w) {
  if (!w) return '';
  const d = new Date(w);
  if (Number.isNaN(d.getTime())) return String(w);
  return d.toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');
}
