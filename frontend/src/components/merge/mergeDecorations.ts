// Decoration + marker-geometry helpers for the merge view. Pure: they return
// Monaco IModelDeltaDecoration objects (plain-range literals), so they need no
// Monaco instance and are unit-testable.

import type { editor } from 'monaco-editor';
import type { MergeHunk, MergeModel, MergeSide } from '../../lib/merge/mergeTypes';

/** Sub-regions of a conflict's marker block, in RESULT (working) line numbers. */
export interface MarkerRegions {
  oursStart: number;
  oursEnd: number;
  baseStart: number | null;
  baseEnd: number | null;
  theirsStart: number;
  theirsEnd: number;
  /** The four marker lines (some may coincide/absent). */
  markerLines: number[];
}

/** Locate ours/base/theirs sub-ranges within a conflict hunk's result block by
 *  scanning its raw lines for the markers (robust to diff3 / 2-way). */
export function markerRegions(hunk: MergeHunk): MarkerRegions {
  const S = hunk.resultRange.startLine; // line of `<<<<<<<`
  const lines = hunk.resultLines;
  let baseIdx = -1;
  let sepIdx = -1;
  let endIdx = lines.length - 1;
  for (let i = 1; i < lines.length; i++) {
    if (baseIdx < 0 && lines[i].startsWith('|||||||')) baseIdx = i;
    else if (sepIdx < 0 && lines[i].startsWith('=======')) sepIdx = i;
    else if (lines[i].startsWith('>>>>>>>')) {
      endIdx = i;
      break;
    }
  }
  const oursEndIdx = (baseIdx >= 0 ? baseIdx : sepIdx) - 1;
  const markerLines = [S, S + endIdx];
  if (baseIdx >= 0) markerLines.push(S + baseIdx);
  if (sepIdx >= 0) markerLines.push(S + sepIdx);
  return {
    oursStart: S + 1,
    oursEnd: S + Math.max(0, oursEndIdx),
    baseStart: baseIdx >= 0 ? S + baseIdx + 1 : null,
    baseEnd: baseIdx >= 0 ? S + sepIdx - 1 : null,
    theirsStart: S + sepIdx + 1,
    theirsEnd: S + endIdx - 1,
    markerLines,
  };
}

const whole = (startLineNumber: number, endLineNumber: number, className: string): editor.IModelDeltaDecoration | null =>
  endLineNumber < startLineNumber
    ? null
    : { range: { startLineNumber, startColumn: 1, endLineNumber, endColumn: 1 }, options: { isWholeLine: true, className } };

/** Decorations for the RESULT editor: colour each conflict's ours/base/theirs
 *  regions + dim the marker lines; ring the current conflict. */
export function resultDecorations(model: MergeModel, currentId: string | null): editor.IModelDeltaDecoration[] {
  const out: editor.IModelDeltaDecoration[] = [];
  for (const h of model.conflictHunks) {
    const cur = h.id === currentId ? ' merge-cur' : '';
    const r = markerRegions(h);
    push(out, whole(r.oursStart, r.oursEnd, 'merge-ours' + cur));
    if (r.baseStart != null && r.baseEnd != null) push(out, whole(r.baseStart, r.baseEnd, 'merge-base' + cur));
    push(out, whole(r.theirsStart, r.theirsEnd, 'merge-theirs' + cur));
    for (const m of r.markerLines) push(out, whole(m, m, 'merge-marker' + cur));
  }
  return out;
}

/** Decorations for a readonly side pane (ours/theirs/base): highlight its
 *  conflict regions and glyph-margin an accept arrow at each conflict start. */
export function sideDecorations(
  model: MergeModel,
  side: Exclude<MergeSide, 'result'>,
  currentId: string | null
): editor.IModelDeltaDecoration[] {
  const cls = side === 'ours' ? 'merge-ours' : side === 'theirs' ? 'merge-theirs' : 'merge-base';
  const glyph = side === 'ours' ? 'merge-glyph-ours' : side === 'theirs' ? 'merge-glyph-theirs' : '';
  const out: editor.IModelDeltaDecoration[] = [];
  for (const h of model.conflictHunks) {
    const cur = h.id === currentId ? ' merge-cur' : '';
    const rng = side === 'ours' ? h.oursRange : side === 'theirs' ? h.theirsRange : h.baseRange;
    push(out, whole(rng.startLine, rng.endLine, cls + cur));
    if (glyph && rng.endLine >= rng.startLine) {
      out.push({
        range: { startLineNumber: rng.startLine, startColumn: 1, endLineNumber: rng.startLine, endColumn: 1 },
        options: { glyphMarginClassName: glyph, glyphMarginHoverMessage: { value: side === 'ours' ? 'Accept ours →' : '← Accept theirs' } },
      });
    }
  }
  return out;
}

function push<T>(arr: T[], v: T | null) {
  if (v) arr.push(v);
}
