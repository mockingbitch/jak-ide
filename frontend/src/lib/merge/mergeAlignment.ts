// Build the aligned 3-way merge model from the result (working) text.
//
// Approach: git already performed the 3-way merge, so the working file is a mix
// of auto-merged context (identical across ours/theirs — rendered 1:1) and
// conflict blocks delimited by markers. Each conflict block already contains the
// ours / theirs (and, with merge.conflictStyle=diff3, base) lines, so we can
// RECONSTRUCT each side pane from the markers alone — no cross-file diff needed,
// and every pane lines up by construction. Spacers (Monaco view zones) pad the
// shorter sides so a conflict occupies the same vertical span in all panes.

import type { LineRange, MergeHunk, MergeModel, PaneSpacers, Spacer } from './mergeTypes';

const OURS = '<<<<<<<';
const BASE = '|||||||';
const SEP = '=======';
const THEIRS = '>>>>>>>';

const range = (start: number, len: number): LineRange => ({ startLine: start, endLine: start + len - 1 });
const emptyRange = (at: number): LineRange => ({ startLine: at, endLine: at - 1 });

interface RawConflict {
  readonly kind: 'conflict';
  readonly ours: string[];
  readonly theirs: string[];
  readonly base: string[];
  readonly hasBase: boolean;
  /** Raw marker-block lines, exactly as they appear in the result text. */
  readonly block: string[];
}
interface RawEqual {
  readonly kind: 'equal';
  readonly lines: string[];
}
type RawSegment = RawConflict | RawEqual;

/** Split the result text into equal runs and conflict blocks (handles diff3 base
 *  and tolerates a malformed/truncated trailing block by treating it as text). */
function segment(text: string): RawSegment[] {
  const lines = text.split('\n');
  const segs: RawSegment[] = [];
  let equal: string[] = [];
  const flushEqual = () => {
    if (equal.length) {
      segs.push({ kind: 'equal', lines: equal });
      equal = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith(OURS)) {
      equal.push(lines[i++]);
      continue;
    }
    // Try to parse a full conflict block; bail to plain text if it never closes.
    const start = i;
    const block: string[] = [lines[i++]];
    const ours: string[] = [];
    while (i < lines.length && !lines[i].startsWith(BASE) && !lines[i].startsWith(SEP)) {
      ours.push(lines[i]);
      block.push(lines[i++]);
    }
    const base: string[] = [];
    let hasBase = false;
    if (i < lines.length && lines[i].startsWith(BASE)) {
      hasBase = true;
      block.push(lines[i++]);
      while (i < lines.length && !lines[i].startsWith(SEP)) {
        base.push(lines[i]);
        block.push(lines[i++]);
      }
    }
    const theirs: string[] = [];
    let closed = false;
    if (i < lines.length && lines[i].startsWith(SEP)) {
      block.push(lines[i++]);
      while (i < lines.length && !lines[i].startsWith(THEIRS)) {
        theirs.push(lines[i]);
        block.push(lines[i++]);
      }
      if (i < lines.length && lines[i].startsWith(THEIRS)) {
        block.push(lines[i++]);
        closed = true;
      }
    }
    if (closed) {
      flushEqual();
      segs.push({ kind: 'conflict', ours, theirs, base, hasBase, block });
    } else {
      // Malformed: rewind and treat the opening marker line as ordinary text.
      i = start;
      equal.push(lines[i++]);
    }
  }
  flushEqual();
  return segs;
}

/** Build the aligned model from the result (working) text. */
export function buildMergeModel(resultText: string): MergeModel {
  const segs = segment(resultText);
  const hunks: MergeHunk[] = [];
  const ours: string[] = [];
  const theirs: string[] = [];
  const base: string[] = [];
  const spacers: PaneSpacers = { ours: [], theirs: [], base: [], result: [] };
  // 1-based line cursors per pane.
  let rL = 1;
  let oL = 1;
  let tL = 1;
  let bL = 1;
  let conflictSeq = 0;
  let hasBase = false;

  const addSpacer = (list: Spacer[], afterLine: number, heightInLines: number) => {
    if (heightInLines > 0) list.push({ afterLine, heightInLines });
  };

  for (const seg of segs) {
    if (seg.kind === 'equal') {
      const n = seg.lines.length;
      hunks.push({
        id: `equal-${rL}`,
        type: 'equal',
        status: 'resolved',
        resultRange: range(rL, n),
        oursRange: range(oL, n),
        theirsRange: range(tL, n),
        baseRange: range(bL, n),
        oursLines: seg.lines,
        theirsLines: seg.lines,
        baseLines: seg.lines,
        resultLines: seg.lines,
      });
      ours.push(...seg.lines);
      theirs.push(...seg.lines);
      base.push(...seg.lines);
      rL += n;
      oL += n;
      tL += n;
      bL += n;
      continue;
    }

    hasBase = hasBase || seg.hasBase;
    const Ho = seg.ours.length;
    const Ht = seg.theirs.length;
    const Hb = seg.base.length;
    const Hr = seg.block.length; // includes marker lines

    const hunk: MergeHunk = {
      id: `conflict-${conflictSeq++}`,
      type: 'conflict',
      status: 'unresolved',
      resultRange: range(rL, Hr),
      oursRange: Ho ? range(oL, Ho) : emptyRange(oL),
      theirsRange: Ht ? range(tL, Ht) : emptyRange(tL),
      baseRange: Hb ? range(bL, Hb) : emptyRange(bL),
      oursLines: seg.ours,
      theirsLines: seg.theirs,
      baseLines: seg.base,
      resultLines: seg.block,
    };
    hunks.push(hunk);

    // Ours pane: <<<(1) above, then ours lines, then the rest of the block below.
    addSpacer(spacers.ours, oL - 1, 1);
    ours.push(...seg.ours);
    addSpacer(spacers.ours, oL - 1 + Ho, Hr - 1 - Ho);

    // Theirs pane: everything before theirs above, theirs lines, then >>>(1) below.
    const theirsAbove = Hr - Ht - 1;
    addSpacer(spacers.theirs, tL - 1, theirsAbove);
    theirs.push(...seg.theirs);
    addSpacer(spacers.theirs, tL - 1 + Ht, 1);

    // Base pane: <<<+ours+|||(if diff3) above, base lines, ===+theirs+>>> below.
    if (seg.hasBase) {
      addSpacer(spacers.base, bL - 1, 1 + Ho + 1);
      base.push(...seg.base);
      addSpacer(spacers.base, bL - 1 + Hb, 1 + Ht + 1);
    } else {
      // Non-diff3: base is unknown from markers — leave a full-height gap.
      addSpacer(spacers.base, bL - 1, Hr);
    }

    rL += Hr;
    oL += Ho;
    tL += Ht;
    bL += seg.hasBase ? Hb : 0;
  }

  const conflictHunks = hunks.filter((h) => h.type === 'conflict');
  return {
    hunks,
    oursText: ours.join('\n'),
    theirsText: theirs.join('\n'),
    baseText: base.join('\n'),
    resultText,
    spacers,
    conflictHunks,
    unresolvedCount: conflictHunks.length,
    hasBase,
  };
}
