// core/llm.mjs
// LLM narration is a SUMMARY of deterministic signals, never a judge (PRD §5.7).
// Core only ASSEMBLES the prompt payload from already-computed signals. The
// model call lives in the provider; core never consumes the model's output as a
// verdict. This module has no authority over status by construction.

/**
 * Assemble the input the narrator is allowed to see: the deterministic signals
 * only. No place to inject a verdict — the payload carries signals, and the
 * fixed instruction forbids introducing conclusions the signals don't support.
 *
 * @param {object} signals { status, fill, freshness, distribution, volumeDrift, drift, tests }
 * @returns {{ instruction:string, authority:'none', signals:object }}
 */
export function assembleLlmNarrationInput(signals = {}) {
  const s = signals;
  return {
    authority: 'none',
    instruction:
      'Restate ONLY the deterministic signals below in one short paragraph. ' +
      'Do not decide trust and do not introduce any conclusion the signals do not support. ' +
      'If the fingerprint shows the model changed, attribute the "unverified" conclusion to ' +
      'the deterministic fingerprint check, never to your own judgement.',
    signals: {
      status: s.status ?? null,
      fill: pick(s.fill),
      freshness: pick(s.freshness),
      distribution: pick(s.distribution),
      volumeDrift: pick(s.volumeDrift),
      drift: s.drift
        ? { drifted: !!s.drift.drifted, currentFingerprint: s.drift.currentFingerprint || null }
        : null,
      tests: Array.isArray(s.tests)
        ? { total: s.tests.length, failing: s.tests.filter((t) => !t.pass).length }
        : null,
    },
  };
}

function pick(sig) {
  if (!sig) return null;
  return { value: sig.value ?? null, note: sig.note ?? null, state: sig.state ?? null };
}
