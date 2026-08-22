// core/diff.mjs
// Deterministic line-level diff (LCS) of approved vs current SQL, for the
// drift receipt. Pure — returns data, never DOM.

/**
 * @param {string} approved  the SQL as approved (from the nest)
 * @param {string} current   the current compiled SQL (from the manifest)
 * @returns {{t:'ctx'|'del'|'add', s:string}[]}
 */
export function lineDiff(approved, current) {
  const a = splitLines(approved);
  const b = splitLines(current);

  // Longest common subsequence table over lines.
  const m = a.length;
  const nn = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(nn + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = nn - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < nn) {
    if (a[i] === b[j]) {
      out.push({ t: 'ctx', s: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: 'del', s: a[i] });
      i++;
    } else {
      out.push({ t: 'add', s: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ t: 'del', s: a[i++] });
  while (j < nn) out.push({ t: 'add', s: b[j++] });
  return out;
}

function splitLines(str) {
  return String(str == null ? '' : str)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, idx, arr) => !(l === '' && (idx === 0 || idx === arr.length - 1)));
}
