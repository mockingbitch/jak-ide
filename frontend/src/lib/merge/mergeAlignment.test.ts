import { describe, it, expect } from 'vitest';
import { buildMergeModel } from './mergeAlignment';

// Marker blocks are built with real newlines so line counts are exact.
const twoWay = [
  'line 1',
  'line 2',
  '<<<<<<< HEAD',
  'ours a',
  'ours b',
  '=======',
  'theirs a',
  '>>>>>>> feature',
  'line 3',
].join('\n');

const diff3 = [
  'top',
  '<<<<<<< HEAD',
  'ours 1',
  '||||||| base',
  'base 1',
  'base 2',
  '=======',
  'theirs 1',
  'theirs 2',
  'theirs 3',
  '>>>>>>> other',
  'bottom',
].join('\n');

describe('buildMergeModel — 2-way markers', () => {
  const m = buildMergeModel(twoWay);

  it('finds exactly one conflict with correct sides', () => {
    expect(m.conflictHunks).toHaveLength(1);
    expect(m.unresolvedCount).toBe(1);
    const c = m.conflictHunks[0];
    expect(c.oursLines).toEqual(['ours a', 'ours b']);
    expect(c.theirsLines).toEqual(['theirs a']);
    expect(c.baseLines).toEqual([]);
    expect(m.hasBase).toBe(false);
  });

  it('reconstructs each side pane (conflict shown as that side)', () => {
    expect(m.oursText.split('\n')).toEqual(['line 1', 'line 2', 'ours a', 'ours b', 'line 3']);
    expect(m.theirsText.split('\n')).toEqual(['line 1', 'line 2', 'theirs a', 'line 3']);
    expect(m.resultText).toBe(twoWay);
  });

  it('marks equal context hunks as resolved', () => {
    const equal = m.hunks.filter((h) => h.type === 'equal');
    expect(equal.every((h) => h.status === 'resolved')).toBe(true);
    // 'line 1','line 2' before + 'line 3' after = two equal hunks.
    expect(equal).toHaveLength(2);
  });

  it('spacers make the conflict occupy the same span in every pane', () => {
    // Result block height = 5 (<<<, ours a, ours b, ===, theirs a, >>>) = 6 lines.
    const Hr = 6;
    const conflict = m.conflictHunks[0];
    const blockLen = conflict.resultLines.length;
    expect(blockLen).toBe(Hr);
    // ours pane: 2 real lines + spacers must total Hr.
    const oursSpacerH = m.spacers.ours.reduce((s, z) => s + z.heightInLines, 0);
    expect(conflict.oursLines.length + oursSpacerH).toBe(Hr);
    const theirsSpacerH = m.spacers.theirs.reduce((s, z) => s + z.heightInLines, 0);
    expect(conflict.theirsLines.length + theirsSpacerH).toBe(Hr);
  });
});

describe('buildMergeModel — diff3 base', () => {
  const m = buildMergeModel(diff3);

  it('extracts base lines and flags hasBase', () => {
    expect(m.hasBase).toBe(true);
    const c = m.conflictHunks[0];
    expect(c.oursLines).toEqual(['ours 1']);
    expect(c.baseLines).toEqual(['base 1', 'base 2']);
    expect(c.theirsLines).toEqual(['theirs 1', 'theirs 2', 'theirs 3']);
  });

  it('reconstructs the base pane', () => {
    expect(m.baseText.split('\n')).toEqual(['top', 'base 1', 'base 2', 'bottom']);
  });

  it('base-pane spacers keep the conflict aligned', () => {
    const c = m.conflictHunks[0];
    const baseSpacerH = m.spacers.base.reduce((s, z) => s + z.heightInLines, 0);
    expect(c.baseLines.length + baseSpacerH).toBe(c.resultLines.length);
  });
});

describe('buildMergeModel — real git output', () => {
  it('parses default git markers (<<<<<<< HEAD / >>>>>>> branch)', () => {
    const real = ['line1', '<<<<<<< HEAD', 'OURS change', '=======', 'THEIRS change', '>>>>>>> feat', 'line3'].join('\n');
    const m = buildMergeModel(real);
    expect(m.conflictHunks).toHaveLength(1);
    expect(m.conflictHunks[0].oursLines).toEqual(['OURS change']);
    expect(m.conflictHunks[0].theirsLines).toEqual(['THEIRS change']);
    expect(m.hasBase).toBe(false);
  });

  it('parses real diff3 base marker with a commit hash suffix (||||||| <hash>)', () => {
    const real = [
      'line1',
      '<<<<<<< HEAD',
      'OURS change',
      '||||||| 9752d37',
      'shared',
      '=======',
      'THEIRS change',
      '>>>>>>> feat',
      'line3',
    ].join('\n');
    const m = buildMergeModel(real);
    expect(m.hasBase).toBe(true);
    expect(m.conflictHunks[0].baseLines).toEqual(['shared']);
    expect(m.baseText.split('\n')).toEqual(['line1', 'shared', 'line3']);
  });
});

describe('buildMergeModel — edge cases', () => {
  it('clean text with no markers is one equal hunk, zero conflicts', () => {
    const m = buildMergeModel('a\nb\nc');
    expect(m.conflictHunks).toHaveLength(0);
    expect(m.unresolvedCount).toBe(0);
    expect(m.oursText).toBe('a\nb\nc');
    expect(m.theirsText).toBe('a\nb\nc');
  });

  it('a malformed (unclosed) marker is treated as plain text, not a conflict', () => {
    const m = buildMergeModel('a\n<<<<<<< HEAD\nours only\nno separator ever');
    expect(m.conflictHunks).toHaveLength(0);
  });

  it('handles two conflicts in one file', () => {
    const src = [
      'a',
      '<<<<<<< HEAD',
      'o1',
      '=======',
      't1',
      '>>>>>>> x',
      'b',
      '<<<<<<< HEAD',
      'o2',
      '=======',
      't2',
      '>>>>>>> x',
      'c',
    ].join('\n');
    const m = buildMergeModel(src);
    expect(m.conflictHunks).toHaveLength(2);
    expect(m.conflictHunks[0].oursLines).toEqual(['o1']);
    expect(m.conflictHunks[1].theirsLines).toEqual(['t2']);
    // conflict result ranges must be in ascending, non-overlapping order.
    expect(m.conflictHunks[0].resultRange.endLine).toBeLessThan(m.conflictHunks[1].resultRange.startLine);
  });
});
