import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, fingerprintSql, compareFingerprint } from '../core/fingerprint.mjs';
import { normalizeSql } from '../core/normalize.mjs';
import { lineDiff } from '../core/diff.mjs';

const APPROVED = [
  'select',
  '  sum(expansion_arr) as expansion,',
  '  sum(case when arr_change < 0 then arr_change else 0 end) as contraction',
  'from int_customer_arr__monthly',
].join('\n');

const DRIFTED = [
  'select',
  '  sum(expansion_arr) as expansion,',
  '  -- contraction now only counts churn, not downgrades',
  '  sum(case when is_churn then arr_change else 0 end) as contraction',
  'from int_customer_arr__monthly',
].join('\n');

test('fingerprint has sha256: prefix and matches fingerprintSql path', () => {
  const fp = fingerprintSql(APPROVED);
  assert.match(fp, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fp, fingerprint(normalizeSql(APPROVED)));
});

test('identical SQL (cosmetic differences only) is NOT drifted', () => {
  const compiled = 'SELECT  sum(expansion_arr) AS expansion,\n sum(case when arr_change < 0 then arr_change else 0 end) as contraction FROM int_customer_arr__monthly';
  const approved = { fingerprint: fingerprintSql(APPROVED), sql: APPROVED };
  const r = compareFingerprint(compiled, approved);
  assert.equal(r.drifted, false);
  assert.equal(r.diff.length, 0);
});

test('a real change IS drifted and produces a diff with add+del', () => {
  const approved = { fingerprint: fingerprintSql(APPROVED), sql: APPROVED };
  const r = compareFingerprint(DRIFTED, approved);
  assert.equal(r.drifted, true);
  assert.equal(r.hasApprovedFingerprint, true);
  assert.notEqual(r.currentFingerprint, r.approvedFingerprint);
  assert.ok(r.diff.some((d) => d.t === 'del'));
  assert.ok(r.diff.some((d) => d.t === 'add'));
});

test('missing approved fingerprint => not drifted but flagged unapproved-capable', () => {
  const r = compareFingerprint(DRIFTED, null);
  assert.equal(r.hasApprovedFingerprint, false);
  assert.equal(r.drifted, false); // cannot claim drift without a baseline
  assert.equal(r.approvedFingerprint, null);
});

test('DETERMINISM: same manifest + same approved fingerprint => identical verdict every run', () => {
  const approved = { fingerprint: fingerprintSql(APPROVED), sql: APPROVED };
  const a = compareFingerprint(DRIFTED, approved);
  const b = compareFingerprint(DRIFTED, approved);
  assert.deepEqual(a, b);
  assert.equal(a.currentFingerprint, b.currentFingerprint);
});

test('lineDiff marks the changed contraction line', () => {
  const d = lineDiff(APPROVED, DRIFTED);
  const dels = d.filter((x) => x.t === 'del').map((x) => x.s).join('\n');
  const adds = d.filter((x) => x.t === 'add').map((x) => x.s).join('\n');
  assert.match(dels, /arr_change < 0/);
  assert.match(adds, /is_churn/);
});
