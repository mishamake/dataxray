import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareLink, parseShareView, readShareParams, shareChoice, shareChoicesValid, shareDate, shareAsOf, ShareLinkError,
} from '../contracts/index.mjs';

test('buildShareLink replaces unrelated query/hash state and round-trips', () => {
  const href = buildShareLink('https://hub.example.com/dash?metric=x&comment=9#c', 'demo.bookings', { period: 'mtd' });
  const url = new URL(href);
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams.keys()], ['focus', 'view']);
  assert.deepEqual(readShareParams(url.searchParams), { focus: 'demo.bookings', view: { period: 'mtd' }, invalid: false, key: 'demo.bookings:{"period":"mtd"}' });
});

test('buildShareLink throws instead of truncating an oversized view', () => {
  assert.throws(() => buildShareLink('https://hub.example.com/d', 'x', { a: 'y'.repeat(2500) }), ShareLinkError);
  assert.throws(() => buildShareLink('https://hub.example.com/d', 'x', { a: 1 }), ShareLinkError);
});

test('parseShareView: absent is default, malformed is invalid (never silently replaced)', () => {
  assert.deepEqual(parseShareView(null), {});
  assert.equal(parseShareView(''), null);
  assert.equal(parseShareView('[1]'), null);
  assert.equal(parseShareView('{"a":1}'), null);
  assert.equal(parseShareView('{bad'), null);
  assert.equal(readShareParams(new URLSearchParams('focus=a&view=%7Bbad')).invalid, true);
});

test('choice and date validators', () => {
  assert.equal(shareChoice('qtd', ['mtd', 'qtd'], 'mtd'), 'qtd');
  assert.equal(shareChoice('evil', ['mtd', 'qtd'], 'mtd'), 'mtd');
  assert.equal(shareChoicesValid({ period: 'mtd' }, { period: ['mtd'] }), true);
  assert.equal(shareChoicesValid({ period: 'x' }, { period: ['mtd'] }), false);
  assert.equal(shareDate('2026-02-28'), '2026-02-28');
  assert.equal(shareDate('2026-02-30'), undefined);
  assert.equal(shareDate('2026-2-3'), undefined);
});

test('shareAsOf anchors a date and rejects future dates in the reporting time zone', () => {
  const now = new Date('2026-09-25T02:00:00Z'); // still Sept 24 in New York
  assert.equal(shareAsOf('2026-09-24', { timeZone: 'America/New_York', now }).toISOString().slice(0, 10), '2026-09-24');
  assert.throws(() => shareAsOf('2026-09-25', { timeZone: 'America/New_York', now }), ShareLinkError);
  assert.equal(shareAsOf(null, { now }), now);
});
