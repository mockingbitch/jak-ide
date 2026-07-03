// Line-level added/removed counts between two texts (git --numstat-ish), used to
// annotate AI file edits in the chat "changed files" list. Kept pure + framework
// -free so it stays unit-testable.

export interface DiffStat {
  readonly additions: number;
  readonly deletions: number;
}

// Above this the O(n·m) LCS table gets too big (~2000×2000 lines) — fall back to a
// cheap order-insensitive multiset delta so we never allocate a huge array.
const MAX_LCS_CELLS = 4_000_000;

const splitLines = (s: string): string[] => (s === '' ? [] : s.split('\n'));

/** Added/removed line counts turning `before` into `after`. */
export function diffStat(before: string, after: string): DiffStat {
  if (before === after) return { additions: 0, deletions: 0 };
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length === 0) return { additions: b.length, deletions: 0 };
  if (b.length === 0) return { additions: 0, deletions: a.length };
  return a.length * b.length > MAX_LCS_CELLS ? multisetStat(a, b) : lcsStat(a, b);
}

// Longest-common-subsequence over lines → the unchanged count; the rest are
// additions (in `b`) / deletions (in `a`). Two rolling Int32 rows keep memory O(m).
function lcsStat(a: string[], b: string[]): DiffStat {
  const n = a.length;
  const m = b.length;
  let prev = new Int32Array(m + 1);
  let curr = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  const lcs = prev[m];
  return { additions: m - lcs, deletions: n - lcs };
}

// Order-insensitive fallback: a line present more often in `b` counts as an addition,
// more often in `a` as a deletion. Cheaper (O(n+m)) but ignores moves.
function multisetStat(a: string[], b: string[]): DiffStat {
  const count = new Map<string, number>();
  for (const l of a) count.set(l, (count.get(l) ?? 0) + 1);
  for (const l of b) count.set(l, (count.get(l) ?? 0) - 1);
  let additions = 0;
  let deletions = 0;
  for (const c of count.values()) {
    if (c < 0) additions -= c;
    else deletions += c;
  }
  return { additions, deletions };
}
