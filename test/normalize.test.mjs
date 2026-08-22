import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSql } from '../core/normalize.mjs';

test('collapses whitespace and newlines to single spaces', () => {
  assert.equal(normalizeSql('select   a\n\n  from   t'), 'select a from t');
});

test('lowercases keywords/identifiers outside string literals', () => {
  assert.equal(normalizeSql('SELECT Amount FROM Opportunity'), 'select amount from opportunity');
});

test('preserves case inside single-quoted string literals', () => {
  const out = normalizeSql("where stage in ('SQL','Proposal')");
  assert.ok(out.includes("'SQL'"), out);
  assert.ok(out.includes("'Proposal'"), out);
});

test('strips line comments', () => {
  assert.equal(normalizeSql('select a -- a comment here\nfrom t'), 'select a from t');
});

test('strips block comments', () => {
  assert.equal(normalizeSql('select a /* block\ncomment */ from t'), 'select a from t');
});

test('drops trailing semicolons and tightens spacing around ( ) ,', () => {
  assert.equal(normalizeSql('select sum( amount ) , x from t ;'), 'select sum(amount),x from t');
});

test('two cosmetically-different but semantically-identical SQLs normalize equal', () => {
  const a = 'SELECT fiscal_period,\n  SUM(amount) AS qp   -- rollup\nFROM q\nGROUP BY 1';
  const b = 'select fiscal_period, sum(amount) as qp from q group by 1';
  assert.equal(normalizeSql(a), normalizeSql(b));
});

test('a real semantic change does NOT normalize equal', () => {
  const approved = 'sum(case when arr_change < 0 then arr_change else 0 end) as contraction';
  const drifted = 'sum(case when is_churn then arr_change else 0 end) as contraction';
  assert.notEqual(normalizeSql(approved), normalizeSql(drifted));
});

test('is idempotent and order-stable', () => {
  const once = normalizeSql('SELECT  A , B FROM  T');
  assert.equal(normalizeSql(once), once);
});

test('handles null/empty safely', () => {
  assert.equal(normalizeSql(null), '');
  assert.equal(normalizeSql(''), '');
});
