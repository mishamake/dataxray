// widget/governance-render.mjs
// v2 presentation: governance view-model in -> HTML strings out. Pure display;
// every verdict, gate, and receipt value was computed provider-side by the
// pure core. Design language follows the approved v2 prototype with the
// design-review refinements folded in (real owner gating, consistent comment
// identity, threaded replies, >=44px targets, louder stale, honest ladder).

import { VERDICT } from '../core/index.mjs';
import { VERDICT_ICON, NEST_GLYPH, chipIcon, sectionIcon } from './icons.mjs';
import { escapeHtml, fmtWhen } from './render.mjs';

/* --------------------------- verdict -> display -------------------------- */
export const GOV_BADGE = {
  [VERDICT.CERTIFIED]: { cls: 'ok', label: 'Certified & current' },
  [VERDICT.DRIFTED]: { cls: 'bad', label: 'Drifted' },
  [VERDICT.PENDING]: { cls: 'pend', label: 'Change pending review' },
  [VERDICT.STALE]: { cls: 'stale', label: "Stale · can't confirm current" },
  [VERDICT.UNCERTIFIED]: { cls: 'uncert', label: 'Awaiting first approval' },
};

export function govBadgeMeta(g) {
  if (!g || !g.mapped) return { cls: 'unknown', label: 'Unmapped' };
  if (g.unavailable) return { cls: 'unavailable', label: 'Unavailable' };
  const meta = GOV_BADGE[g.verdict] || { cls: 'unknown', label: 'Unknown' };
  if (g.verdict === VERDICT.DRIFTED && g.review) {
    return { cls: 'bad', label: 'Drifted · re-approval in review' };
  }
  return meta;
}

/* ------------------------------ verdict banner --------------------------- */
function govBanner(g) {
  const v = g.verdict;
  const r = g.receipt || {};
  let cls = 'unknown';
  let icon = VERDICT_ICON.unknown;
  let title = '';
  let text = '';

  if (v === VERDICT.CERTIFIED) {
    cls = 'ok';
    icon = VERDICT_ICON.ok;
    title = 'Certified & current — safe to quote';
    text = `The compiled SQL matches the fingerprint ${r.blessedBy || 'a steward'} blessed at version ${r.approvedVersion}. No drift since the last human sign-off.`;
  } else if (v === VERDICT.DRIFTED) {
    cls = 'bad';
    icon = VERDICT_ICON.bad;
    title = 'Drifted from the approved definition — do NOT quote';
    text = g.review
      ? `The current compiled SQL no longer matches the fingerprint blessed at v${r.approvedVersion}. A re-approval is <b>in review</b> — approving it re-pins the baseline and clears this.`
      : `The current compiled SQL no longer matches the fingerprint blessed at v${r.approvedVersion}. Until a human re-approves, this number is <b>not</b> certified current.`;
  } else if (v === VERDICT.PENDING) {
    cls = 'pend';
    icon = VERDICT_ICON.pend;
    title = 'Change pending review';
    text = 'A definition change is submitted and awaiting a steward\u2019s approval. The current number still matches the approved baseline — but the definition of record is in flux.';
  } else if (v === VERDICT.STALE) {
    cls = 'stale';
    icon = VERDICT_ICON.stale;
    title = 'Stale provenance — can\u2019t confirm current';
    text = `Last ingest was <b>${escapeHtml(fmtWhen(r.ingestedAt) || 'unknown')}</b>, past the ${Math.round((r.stalenessThresholdMs || 0) / 3600000)}h freshness window. The current fingerprint may be out of date, so we <b>will not</b> show a green verdict. Deliberately loud — never silent-green.`;
  } else if (v === VERDICT.UNCERTIFIED) {
    cls = 'uncert';
    icon = VERDICT_ICON.uncert;
    title = 'Awaiting first approval';
    text = 'A definition exists in draft, but no human has ever blessed a baseline. There is nothing to judge drift against — this number is not certified.';
  }

  return `<div class="pw-verdict ${cls}">
    <div class="pw-vtop">${icon} ${escapeHtml(title)}</div>
    <div class="pw-vsub">${text}</div>
  </div>`;
}

/* --------------------------- definition of record ------------------------ */
function govDefinition(g) {
  return `<div class="pw-field"><div class="pw-k">Definition of record</div>
    <div class="pw-governed">${escapeHtml(g.humanDefinition || 'No human definition recorded.')}
      <div class="pw-src">${NEST_GLYPH} Source of truth: Context Nest · <code>metric.${escapeHtml(g.metricId)}</code>${g.dbtModelRef ? ` · <code>${escapeHtml(g.dbtModelRef)}</code>` : ''}</div>
      <div class="pw-src">${chipIcon('user')} Owner / steward: <b>${escapeHtml(g.owner || '— (unassigned)')}</b>${g.ownerHandle ? ` <code>${escapeHtml(g.ownerHandle)}</code>` : ''}</div>
    </div></div>`;
}

/* -------------------------------- receipt -------------------------------- */
function govReceipt(g) {
  const r = g.receipt || {};
  const match = r.fpCurrent != null && r.fpCurrent === r.fpApproved;
  const stale = g.verdict === VERDICT.STALE;
  const noBaseline = r.approvedVersion == null;
  const curCls = stale || noBaseline ? '' : match ? 'match' : 'mism';
  const verdictLine = stale
    ? '<span class="mism">CANNOT CONFIRM — stale ingest</span>'
    : noBaseline
      ? '<span class="mism">NO BASELINE — awaits human</span>'
      : match
        ? '<span class="match">MATCH · certified</span>'
        : '<span class="mism">MISMATCH · drift</span>';

  const row = (k, v, cls2 = '') =>
    `<div class="pw-rline"><span class="pw-rk">${k}</span><span class="${cls2}">${v}</span></div>`;

  let html = `<div class="pw-field" style="margin-top:14px"><div class="pw-k">Drift receipt · current fingerprint vs. approved baseline</div>
    <div class="pw-receipt2">
      ${row('Approved fingerprint', noBaseline ? '—' : `<code>${escapeHtml(shortFp(r.fpApproved))}</code>`)}
      ${row('Approved at version', noBaseline ? '—' : `v${r.approvedVersion}`)}
      ${row('Current fingerprint', r.fpCurrent ? `<code>${escapeHtml(shortFp(r.fpCurrent))}</code>` : '(unavailable)', curCls)}
      ${row('Current version', `v${r.currentVersion}${!match && !noBaseline && r.currentVersion > r.approvedVersion ? ' (unblessed)' : ''}`)}
      ${row('Verdict', verdictLine)}
      ${row('Last ingest', `${escapeHtml(fmtWhen(r.ingestedAt) || 'unknown')}${r.ingestFresh === false ? ' · <b class="pw-bad-text">STALE</b>' : ''}`)}
    </div>`;

  if (noBaseline) {
    html += `<div class="pw-blessed none"><span class="pw-seal">🔏</span><span>No baseline yet — the ladder below shows <b>awaits human</b>. Only a human <code>approve</code> creates the first blessed fingerprint; the ingester never does.</span></div>`;
  } else {
    html += `<div class="pw-blessed"><span class="pw-seal">🔏</span><span>Baseline blessed by <b>${escapeHtml(r.blessedBy || 'a steward')}</b> at <b>version ${r.approvedVersion}</b>${r.blessedAt ? ` on ${escapeHtml(fmtWhen(r.blessedAt))}` : ''}. Only a human <code>approve</code> moves this line — the ingester never does.</span></div>`;
  }
  return html + `</div>`;
}

/* ---------------------------- governance ladder -------------------------- */
// Design-review #6: steps come from REAL state. The middle step is "in review"
// only when the node is actually pending_review; otherwise a neutral
// "not in review" — no phantom done/dash step on certified nodes.
function govLadder(g) {
  const s = g.nodeStatus;
  const r = g.receipt || {};
  const pending = s === 'pending_review';
  const approved = s === 'approved' && r.approvedVersion != null;

  const mid = pending
    ? `<div class="step active"><div class="node">◔</div><div class="slabel">Pending review</div><div class="ver">v${g.review ? g.review.proposedVersion : r.currentVersion} submitted</div></div>`
    : `<div class="step"><div class="node">2</div><div class="slabel">Pending review</div><div class="ver">not in review</div></div>`;

  const right = approved
    ? `<div class="step done"><div class="node">✓</div><div class="slabel">Approved</div><div class="ver">v${r.approvedVersion}</div></div>`
    : `<div class="step"><div class="node">3</div><div class="slabel">Approved</div><div class="ver">awaits human</div></div>`;

  return `<div class="pw-ladder">
    <div class="step done"><div class="node">✓</div><div class="slabel">Draft ingested</div><div class="ver">v${r.currentVersion}</div></div>
    ${mid}
    ${right}
  </div>`;
}

/* ----------------------------- governor zone ----------------------------- */
function govZone(g, persona) {
  const r = g.receipt || {};
  const acting = persona && persona.name ? persona.name.split(' ')[0] : 'you';
  let html = `<div class="pw-k" style="margin:18px 0 8px">Governor · propose change → review → approve</div>`;
  html += govLadder(g);

  if (g.verdict === VERDICT.STALE) {
    // US-6: approval is BLOCKED against a stale fingerprint.
    return html + `<div class="pw-gov-cta">
      <div class="gt">Provenance can\u2019t be confirmed — approval is blocked</div>
      <div class="gd">The ingest heartbeat is stale, so we can\u2019t judge drift right now. Approving against a stale fingerprint would bless a number we can\u2019t verify. Fix the ingest first.</div>
    </div>`;
  }

  if (g.nodeStatus === 'pending_review') {
    const rv = g.review || {};
    html += `<div class="pw-reviewer"><span class="ri">🔔</span><div class="rt"><b>${escapeHtml(rv.submittedBy || 'Someone')}</b> submitted v${rv.proposedVersion || r.currentVersion} for re-approval${rv.submittedAt ? ` on ${escapeHtml(fmtWhen(rv.submittedAt))}` : ''}. <b>${escapeHtml(g.owner || 'The owner')}</b> was notified via the review watcher.</div></div>`;
    if (g.canGovern) {
      // Design-review #1: the CTA addresses the ACTING user, not m.owner.
      return html + `<div class="pw-gov-cta">
        <div class="gt">Your decision, ${escapeHtml(acting)}</div>
        <div class="gd">Approving re-pins <code>approvedVersion</code> to v${rv.proposedVersion || r.currentVersion} and freezes the new fingerprint as the blessed baseline — the drift clears. Rejecting leaves the number un-blessed and still flagged.</div>
        <div class="pw-btn-row">
          <button class="pw-btn2 approve" data-pw-approve>✓ Approve v${rv.proposedVersion || r.currentVersion}</button>
          <button class="pw-btn2 reject" data-pw-reject>Reject</button>
        </div>
      </div>`;
    }
    return html + `<div class="pw-gov-cta">
      <div class="gt">Waiting on ${escapeHtml(g.owner || 'the owner')}</div>
      <div class="gd">The re-approval is submitted and the owner has been pinged. You\u2019ll see the badge flip here when they decide — no need to chase them in Slack.</div>
    </div>`;
  }

  // Not in review: anyone may propose; the ping goes through the review watcher.
  const why =
    g.verdict === VERDICT.DRIFTED
      ? 'This number is drifted. Requesting re-approval opens a review and notifies the owner — the ping path that actually reaches them.'
      : g.verdict === VERDICT.UNCERTIFIED
        ? 'No human has ever approved this definition. Requesting a first approval opens a review and notifies the owner.'
        : 'Definition is approved & current. If the SQL or wording needs to change, propose it for re-approval.';
  return html + `<div class="pw-gov-cta">
    <div class="gt">${g.verdict === VERDICT.CERTIFIED ? 'Definition is approved &amp; current' : 'Get this number governed'}</div>
    <div class="gd">${why}</div>
    <div class="pw-btn-row"><button class="pw-btn2" data-pw-propose>✎ Propose a definition change / request re-approval</button></div>
  </div>`;
}

/* ----------------------------- comments panel ---------------------------- */
// Design-review #2: identity is consistent — the avatar is derived from the
// author HANDLE (deterministic hash), the name shown is the self-asserted
// author name, and every comment carries the service-token attribution label.
function avatarFor(handle, name) {
  const key = handle || name || '?';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const cls = `pw-av-${(h % 6) + 1}`;
  const initials = String(name || '?')
    .split(/\s+/)
    .map((x) => x[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return `<span class="pw-avatar ${cls}">${escapeHtml(initials)}</span>`;
}

function commentHTML(c, isReply, g) {
  const canResolve = g.canGovern && !isReply && !c.resolved;
  return `<div class="pw-cmt ${isReply ? 'reply' : ''}">
    <div class="pw-chead">
      ${avatarFor(c.authorHandle, c.author)}
      <span class="pw-cname">${escapeHtml(c.author || 'unknown')}</span>
      <span class="pw-ctime">${escapeHtml(fmtWhen(c.createdAt))}</span>
    </div>
    <div class="pw-cbody">${escapeHtml(c.body)}</div>
    <div class="pw-cmeta">
      ${!isReply ? (c.resolved ? '<span class="pw-resolved-chip">✓ Resolved</span>' : '<span class="pw-open-chip">● Open</span>') : ''}
      ${!isReply && !c.resolved ? `<button class="pw-linkbtn" data-pw-reply="${escapeHtml(c.id)}" data-pw-reply-name="${escapeHtml(c.author || '')}">Reply</button>` : ''}
      ${canResolve ? `<button class="pw-linkbtn" data-pw-resolve="${escapeHtml(c.id)}">Mark resolved</button>` : ''}
      <span class="pw-svc-attr">⚠ posted via service token · author self-asserted</span>
    </div>
  </div>`;
}

function govComments(g, persona) {
  const comments = g.comments || [];
  const open = comments.filter((c) => !c.resolved).length;
  let html = `<div class="pw-k" style="margin:18px 0 8px">Discussion on this definition · ${comments.length ? `${open} open` : 'none yet'}</div>`;

  if (comments.length === 0) {
    html += `<div class="pw-empty2"><div class="ei">💬</div>No questions yet. Ask right here — it stays attached to the definition, not lost in a DM.</div>`;
  } else {
    html += `<div class="pw-thread">`;
    for (const c of comments) {
      html += commentHTML(c, false, g);
      for (const r of c.replies || []) html += commentHTML(r, true, g);
    }
    html += `</div>`;
  }

  const asName = persona && persona.name ? persona.name : 'anonymous';
  const asRole = persona && persona.role ? persona.role : '';
  // Design-review #3: Reply captures parentId and shows a "replying to…" chip.
  html += `<div class="pw-composer">
    <div class="pw-replying hidden" data-pw-replying>
      Replying to <b data-pw-replying-name></b>
      <button class="pw-linkbtn" data-pw-cancel-reply>cancel</button>
    </div>
    <textarea data-pw-comment-input placeholder="Ask a question or answer one — as ${escapeHtml(asName)}…" aria-label="Comment on this definition"></textarea>
    <div class="pw-crow">
      <span class="pw-as">posting as <b>${escapeHtml(asName)}</b>${asRole ? ` · ${escapeHtml(asRole)}` : ''}</span>
      <button class="pw-btn2 primary" data-pw-post>Post comment</button>
    </div>
    <div class="pw-route-note">ⓘ <b>A bare comment does not notify anyone.</b> To make sure this reaches ${escapeHtml(g.owner || 'the owner')}, tick “flag to owner” — it opens/attaches a <b>review</b>, the only path that pings.
      <label class="pw-flag"><input type="checkbox" data-pw-flag-owner> Flag to owner (opens a review → notifies via watcher)</label>
    </div>
  </div>`;
  return html;
}

/* ------------------------------ assemble --------------------------------- */
export function renderGovernanceBody(g, persona) {
  return (
    govBanner(g) +
    govDefinition(g) +
    govReceipt(g) +
    govZone(g, persona) +
    govComments(g, persona)
  );
}

function shortFp(fp) {
  if (!fp) return '—';
  const hex = String(fp).replace(/^sha256:/, '');
  return 'sha256:' + hex.slice(0, 4) + '…' + hex.slice(-4);
}
