import { describe, it, expect } from 'vitest';
import { buildMergeModel } from './mergeAlignment';
import { applyHunkToText, applyResolution, hasUnresolvedConflicts, resolutionLines } from './mergeActions';

const src = ['keep', '<<<<<<< HEAD', 'ours a', 'ours b', '=======', 'theirs a', '>>>>>>> feat', 'tail'].join('\n');
const model = buildMergeModel(src);
const conflict = model.conflictHunks[0];

describe('resolutionLines', () => {
  it('accept ours / theirs / both / both-reverse', () => {
    expect(resolutionLines(conflict, 'ours')).toEqual(['ours a', 'ours b']);
    expect(resolutionLines(conflict, 'theirs')).toEqual(['theirs a']);
    expect(resolutionLines(conflict, 'both')).toEqual(['ours a', 'ours b', 'theirs a']);
    expect(resolutionLines(conflict, 'both-reverse')).toEqual(['theirs a', 'ours a', 'ours b']);
  });
});

describe('applyHunkToText', () => {
  it('accept ours removes the markers and keeps only ours lines', () => {
    const out = applyHunkToText(src, conflict, 'ours');
    expect(out.split('\n')).toEqual(['keep', 'ours a', 'ours b', 'tail']);
    expect(hasUnresolvedConflicts(out)).toBe(false);
  });

  it('accept theirs keeps only theirs lines', () => {
    const out = applyHunkToText(src, conflict, 'theirs');
    expect(out.split('\n')).toEqual(['keep', 'theirs a', 'tail']);
  });

  it('accept both keeps ours then theirs, no markers', () => {
    const out = applyHunkToText(src, conflict, 'both');
    expect(out.split('\n')).toEqual(['keep', 'ours a', 'ours b', 'theirs a', 'tail']);
    expect(hasUnresolvedConflicts(out)).toBe(false);
  });

  it('accepting an empty side (add/delete conflict) removes the block with no stray blank line', () => {
    // Local-delete / remote-add: ours side is empty.
    const del = ['line A', '<<<<<<< HEAD', '=======', 'new line', '>>>>>>> branch', 'line B'].join('\n');
    const m = buildMergeModel(del);
    const out = applyHunkToText(del, m.conflictHunks[0], 'ours'); // ours = []
    expect(out.split('\n')).toEqual(['line A', 'line B']); // NOT ['line A','','line B']
    // At EOF (block is the last content) an empty accept must not leave a trailing blank line.
    const eof = ['head', '<<<<<<< HEAD', '=======', 'x', '>>>>>>> b'].join('\n');
    const m2 = buildMergeModel(eof);
    expect(applyHunkToText(eof, m2.conflictHunks[0], 'ours').split('\n')).toEqual(['head']);
  });

  it('resolving one of two conflicts leaves the other intact and re-parseable', () => {
    const two = [
      '<<<<<<< HEAD',
      'o1',
      '=======',
      't1',
      '>>>>>>> x',
      'mid',
      '<<<<<<< HEAD',
      'o2',
      '=======',
      't2',
      '>>>>>>> x',
    ].join('\n');
    const m = buildMergeModel(two);
    // Resolve the FIRST conflict; the second must still parse afterwards.
    const afterFirst = applyHunkToText(two, m.conflictHunks[0], 'ours');
    const m2 = buildMergeModel(afterFirst);
    expect(m2.conflictHunks).toHaveLength(1);
    expect(m2.conflictHunks[0].oursLines).toEqual(['o2']);
    expect(hasUnresolvedConflicts(afterFirst)).toBe(true);
    // Resolve the remaining one → fully clean.
    const clean = applyHunkToText(afterFirst, m2.conflictHunks[0], 'theirs');
    expect(hasUnresolvedConflicts(clean)).toBe(false);
  });
});

describe('applyResolution (line-level)', () => {
  it('replaces the block with arbitrary chosen lines', () => {
    const out = applyResolution(src, conflict, ['ours a', 'theirs a']);
    expect(out.split('\n')).toEqual(['keep', 'ours a', 'theirs a', 'tail']);
  });
  it('empty resolution deletes the block entirely', () => {
    const out = applyResolution(src, conflict, []);
    expect(out.split('\n')).toEqual(['keep', 'tail']);
  });
});

describe('hasUnresolvedConflicts', () => {
  it('is true only for a real, complete conflict block', () => {
    expect(hasUnresolvedConflicts('a\nb')).toBe(false);
    expect(hasUnresolvedConflicts(src)).toBe(true); // a full <<< … >>> block
  });

  it('does NOT false-positive on content lines that merely start with marker chars', () => {
    // RST/Markdown setext heading underline — a lone ======= is not a conflict.
    expect(hasUnresolvedConflicts('Configuration\n=============\n\nRun it.')).toBe(false);
    // Lone / unclosed markers are plain text, not an unresolved conflict.
    expect(hasUnresolvedConflicts('<<<<<<< not closed')).toBe(false);
    expect(hasUnresolvedConflicts('>>>>>>> blockquote deep')).toBe(false);
    expect(hasUnresolvedConflicts('||||||| ascii art')).toBe(false);
  });
});
