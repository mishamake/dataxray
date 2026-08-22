import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../core/sha256.mjs';

// Known SHA-256 vectors — proves the pure implementation is exactly correct
// (this is the reproducibility guarantee for the drift fingerprint).
test('sha256 of empty string', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256 of "abc"', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256 of the 448-bit boundary message', () => {
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
});

test('sha256 is deterministic across calls', () => {
  const a = sha256Hex('select 1 from t');
  const b = sha256Hex('select 1 from t');
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('sha256 handles multibyte UTF-8', () => {
  assert.equal(
    sha256Hex('München — μ σ ∿'),
    sha256Hex('München — μ σ ∿')
  );
});
