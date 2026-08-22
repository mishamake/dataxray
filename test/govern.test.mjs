// test/govern.test.mjs
// The v2 verdict spine (PRD §5.2, §5.3, §5.5, §5.10; US-1, US-6).
// Two fingerprints, never conflated; precedence STALE > UNCERTIFIED > PENDING >
// CERTIFIED > DRIFTED; fail-loud defaults — never silent-green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERDICT, driftVerdict, computeVerdict, verdictLabel } from '../core/index.mjs';

const FP_A = 'sha256:aaaa';
const FP_B = 'sha256:bbbb';

/* ------------------------------ driftVerdict ----------------------------- */

test('driftVerdict: identical fingerprints MATCH', () => {
  assert.equal(driftVerdict(FP_A, FP_A), 'MATCH');
});

test('driftVerdict: different fingerprints DRIFT', () => {
  assert.equal(driftVerdict(FP_A, FP_B), 'DRIFT');
});

test('driftVerdict: UNKNOWN when either side is absent (no baseline claim without both)', () => {
  assert.equal(driftVerdict(null, FP_A), 'UNKNOWN');
  assert.equal(driftVerdict(FP_A, null), 'UNKNOWN');
  assert.equal(driftVerdict('', ''), 'UNKNOWN');
  assert.equal(driftVerdict(null, null), 'UNKNOWN');
});

/* ------------------------- computeVerdict precedence ---------------------- */

const CERTIFIED = {
  fpCurrent: FP_A,
  fpApproved: FP_A,
  hasApprovedBaseline: true,
  ingestFresh: true,
  providerReachable: true,
  reviewOpen: false,
};

test('US-1: match + fresh + no review => CERTIFIED ("Certified & current")', () => {
  assert.equal(computeVerdict(CERTIFIED), VERDICT.CERTIFIED);
});

test('US-1: mismatch + fresh => DRIFTED', () => {
  assert.equal(computeVerdict({ ...CERTIFIED, fpCurrent: FP_B }), VERDICT.DRIFTED);
});

test('US-1: mismatch + fresh + review open => still DRIFTED (label notes the review)', () => {
  assert.equal(computeVerdict({ ...CERTIFIED, fpCurrent: FP_B, reviewOpen: true }), VERDICT.DRIFTED);
});

test('US-1: match + review open => PENDING ("Change pending review")', () => {
  assert.equal(computeVerdict({ ...CERTIFIED, reviewOpen: true }), VERDICT.PENDING);
});

test('US-6: stale ingest degrades loudly even when fingerprints match', () => {
  assert.equal(computeVerdict({ ...CERTIFIED, ingestFresh: false }), VERDICT.STALE);
});

test('US-6: provider unreachable => STALE, never green', () => {
  assert.equal(computeVerdict({ ...CERTIFIED, providerReachable: false }), VERDICT.STALE);
});

test('STALE outranks everything, including drift and pending review', () => {
  assert.equal(
    computeVerdict({ ...CERTIFIED, fpCurrent: FP_B, reviewOpen: true, ingestFresh: false }),
    VERDICT.STALE
  );
  assert.equal(
    computeVerdict({ ...CERTIFIED, fpCurrent: FP_B, providerReachable: false }),
    VERDICT.STALE
  );
});

test('§5.10: missing currentFingerprint => STALE (cannot confirm current)', () => {
  assert.equal(computeVerdict({ ...CERTIFIED, fpCurrent: null }), VERDICT.STALE);
  assert.equal(computeVerdict({ ...CERTIFIED, fpCurrent: '' }), VERDICT.STALE);
});

test('§5.10: no approved baseline => UNCERTIFIED, never green', () => {
  assert.equal(
    computeVerdict({ ...CERTIFIED, hasApprovedBaseline: false, fpApproved: null }),
    VERDICT.UNCERTIFIED
  );
});

test('§5.10: approvedVersion exists but its fingerprint is absent => UNCERTIFIED', () => {
  assert.equal(
    computeVerdict({ ...CERTIFIED, hasApprovedBaseline: true, fpApproved: null }),
    VERDICT.UNCERTIFIED
  );
});

test('UNCERTIFIED outranks PENDING: no baseline + review open is still not green', () => {
  assert.equal(
    computeVerdict({ ...CERTIFIED, hasApprovedBaseline: false, fpApproved: null, reviewOpen: true }),
    VERDICT.UNCERTIFIED
  );
});

test('§5.10: currentVersion == approvedVersion => fingerprints equal by construction => CERTIFIED', () => {
  assert.equal(computeVerdict(CERTIFIED), VERDICT.CERTIFIED);
});

test('FAIL-LOUD DEFAULTS: empty input => STALE (reachability/freshness must be proven)', () => {
  assert.equal(computeVerdict({}), VERDICT.STALE);
  assert.equal(computeVerdict(), VERDICT.STALE);
});

test('FAIL-LOUD DEFAULTS: fingerprints alone are not enough for green', () => {
  // A caller that forgets the I/O flags must not get CERTIFIED.
  assert.equal(
    computeVerdict({ fpCurrent: FP_A, fpApproved: FP_A, hasApprovedBaseline: true }),
    VERDICT.STALE
  );
});

test('DETERMINISM: same input => same output', () => {
  const a = computeVerdict(CERTIFIED);
  const b = computeVerdict(CERTIFIED);
  assert.equal(a, b);
});

/* ------------------------------ verdictLabel ----------------------------- */

test('verdictLabel: canonical copy per verdict', () => {
  assert.equal(verdictLabel(VERDICT.CERTIFIED), 'Certified & current');
  assert.equal(verdictLabel(VERDICT.DRIFTED), 'Drifted');
  assert.equal(verdictLabel(VERDICT.DRIFTED, { reviewOpen: true }), 'Drifted · re-approval in review');
  assert.equal(verdictLabel(VERDICT.PENDING), 'Change pending review');
  assert.equal(verdictLabel(VERDICT.STALE), "Stale · can't confirm current");
  assert.equal(verdictLabel(VERDICT.UNCERTIFIED), 'Awaiting first approval');
  assert.equal(verdictLabel('nonsense'), 'Unknown');
});
