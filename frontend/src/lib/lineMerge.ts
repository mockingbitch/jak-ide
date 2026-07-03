// Line-level diff of a single conflict's two sides (ours vs theirs), so the user
// can accept individual differing regions from either side (PhpStorm-style), not
// just the whole chunk. Pure + framework-free for unit testing.

export type MergeSegment =
  | { readonly kind: 'common'; readonly lines: string[] }
  | { readonly kind: 'change'; readonly ours: string[]; readonly theirs: string[] };

/** Which side(s) of a change segment to keep in the result. */
export interface SidePick {
  readonly ours: boolean;
  readonly theirs: boolean;
}

/** Split `ours`/`theirs` into common runs and divergent (change) runs via an LCS
 *  over lines. Common runs appear in both; change runs carry each side's lines. */
export function diffSegments(ours: string[], theirs: string[]): MergeSegment[] {
  const n = ours.length;
  const m = theirs.length;
  // dp[i][j] = LCS length of ours[i..] and theirs[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ours[i] === theirs[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: MergeSegment[] = [];
  let common: string[] = [];
  let curOurs: string[] = [];
  let curTheirs: string[] = [];
  const flushCommon = () => {
    if (common.length) {
      segs.push({ kind: 'common', lines: common });
      common = [];
    }
  };
  const flushChange = () => {
    if (curOurs.length || curTheirs.length) {
      segs.push({ kind: 'change', ours: curOurs, theirs: curTheirs });
      curOurs = [];
      curTheirs = [];
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ours[i] === theirs[j]) {
      flushChange();
      common.push(ours[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      flushCommon();
      curOurs.push(ours[i++]);
    } else {
      flushCommon();
      curTheirs.push(theirs[j++]);
    }
  }
  flushCommon();
  while (i < n) curOurs.push(ours[i++]);
  while (j < m) curTheirs.push(theirs[j++]);
  flushChange();
  return segs;
}

/** Assemble the resolved lines for one conflict from its segments + per-change picks
 *  (in change-segment order). Common lines are always kept; a change keeps ours
 *  and/or theirs (ours first) per its pick. */
export function assembleResolution(segs: MergeSegment[], picks: SidePick[]): string[] {
  const out: string[] = [];
  let k = 0;
  for (const s of segs) {
    if (s.kind === 'common') {
      out.push(...s.lines);
    } else {
      const p = picks[k++] ?? { ours: true, theirs: false };
      if (p.ours) out.push(...s.ours);
      if (p.theirs) out.push(...s.theirs);
    }
  }
  return out;
}
