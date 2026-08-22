// core/normalize.mjs
// THE shared SQL-normalization function. Used identically at approval time and
// at check time so the fingerprint is stable and reproducible (PRD §5.3).
// Single source of truth — never a second implementation.

/**
 * Deterministically normalize compiled SQL before hashing.
 *  (a) strip block + line comments
 *  (b) lowercase everything OUTSIDE string literals (case-insensitive SQL,
 *      but string contents preserved because they are semantic)
 *  (c) collapse all whitespace runs (incl. newlines) to a single space, trim
 *  (d) drop trailing/stray semicolons; tighten spacing around ( ) and ,
 *
 * Identical input → identical output. No randomness, no timestamps.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSql(raw) {
  if (raw == null) return '';
  const s = String(raw);
  const n = s.length;
  let out = '';
  let i = 0;
  let inStr = false;
  let quote = '';

  while (i < n) {
    const c = s[i];

    if (inStr) {
      out += c;
      if (c === quote) {
        // doubled quote is an escaped quote inside the literal ('' or "")
        if (s[i + 1] === quote) {
          out += s[i + 1];
          i += 2;
          continue;
        }
        inStr = false;
      }
      i++;
      continue;
    }

    // enter string literal
    if (c === "'" || c === '"') {
      inStr = true;
      quote = c;
      out += c;
      i++;
      continue;
    }

    // block comment /* ... */
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }

    // line comment -- ... EOL
    if (c === '-' && s[i + 1] === '-') {
      while (i < n && s[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    out += c.toLowerCase();
    i++;
  }

  out = out.replace(/;+/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/\s*([(),])\s*/g, '$1');
  return out;
}
