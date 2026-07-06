// Pure resolution logic for a single conflict hunk. The view turns the returned
// lines into a Monaco edit (so undo/redo and dirty state come for free); tests
// use applyHunkToText to exercise the same logic without an editor.

import { buildMergeModel } from './mergeAlignment';
import type { HunkAction, MergeHunk } from './mergeTypes';

/** The lines that should replace a conflict's marker block for a whole-hunk action. */
export function resolutionLines(hunk: MergeHunk, action: HunkAction): string[] {
  switch (action) {
    case 'ours':
      return [...hunk.oursLines];
    case 'theirs':
      return [...hunk.theirsLines];
    case 'both':
      return [...hunk.oursLines, ...hunk.theirsLines];
    case 'both-reverse':
      return [...hunk.theirsLines, ...hunk.oursLines];
    case 'base':
      return [...hunk.baseLines];
  }
}

/** Replace `hunk`'s marker block (its resultRange) within `resultText` with
 *  `lines`, returning the new full text. Used for both whole-hunk actions and
 *  line-level "apply selected". */
export function applyResolution(resultText: string, hunk: MergeHunk, lines: string[]): string {
  const all = resultText.split('\n');
  const from = hunk.resultRange.startLine - 1; // 0-based
  const count = hunk.resultRange.endLine - hunk.resultRange.startLine + 1;
  all.splice(from, count, ...lines);
  return all.join('\n');
}

/** Convenience for tests: apply a whole-hunk action to the full text. */
export function applyHunkToText(resultText: string, hunk: MergeHunk, action: HunkAction): string {
  return applyResolution(resultText, hunk, resolutionLines(hunk, action));
}

/** Next conflict index for F7 (+1) / Shift+F7 (-1), wrapping around. Returns 0
 *  for an empty list. */
export function nextConflictIndex(idx: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (idx + delta + count) % count;
}

/** True when the text still contains an UNRESOLVED conflict — the save guard.
 *  Uses the same parser as the model (a real `<<<<<<< … >>>>>>>` block), so it
 *  never false-positives on legitimate content that merely starts with marker
 *  characters (e.g. an RST/Markdown `=======` heading underline or a `>>>>>>>`
 *  blockquote), which a bare per-line prefix check would wrongly flag. */
export function hasUnresolvedConflicts(text: string): boolean {
  return buildMergeModel(text).unresolvedCount > 0;
}
