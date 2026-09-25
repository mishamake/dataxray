// Upgrade safety: every runtime export is declared in the shipped .d.ts, and every
// declared value exists at runtime, so a TypeScript host never drifts from the code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const declared = (file) => new Set([...readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
  .matchAll(/^export (?:function|const|class) (\w+)/gm)].map((m) => m[1]));

for (const entry of ['core', 'contracts']) {
  test(`${entry}: runtime exports and type declarations match`, async () => {
    const runtime = new Set(Object.keys(await import(`../${entry}/index.mjs`)));
    const types = declared(`../${entry}/index.d.ts`);
    assert.deepEqual([...runtime].filter((n) => !types.has(n)), [], 'runtime exports missing from .d.ts');
    assert.deepEqual([...types].filter((n) => !runtime.has(n)), [], '.d.ts declares values missing at runtime');
  });
}

test('package exports resolve by name', async () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  for (const [sub, target] of Object.entries(pkg.exports)) {
    const file = typeof target === 'string' ? target : target.default;
    await assert.doesNotReject(import(`../${file.slice(2)}`), sub);
  }
});
