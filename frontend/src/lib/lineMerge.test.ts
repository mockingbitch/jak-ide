import { describe, it, expect } from 'vitest';
import { diffSegments, assembleResolution, type SidePick } from './lineMerge';

describe('diffSegments', () => {
  it('is all-common for identical sides', () => {
    expect(diffSegments(['a', 'b'], ['a', 'b'])).toEqual([{ kind: 'common', lines: ['a', 'b'] }]);
  });

  it('isolates a single changed line, keeping surrounding context common', () => {
    expect(diffSegments(['a', 'X', 'c'], ['a', 'Y', 'c'])).toEqual([
      { kind: 'common', lines: ['a'] },
      { kind: 'change', ours: ['X'], theirs: ['Y'] },
      { kind: 'common', lines: ['c'] },
    ]);
  });

  it('represents a pure insertion on theirs as an empty ours side', () => {
    expect(diffSegments(['a', 'b'], ['a', 'x', 'b'])).toEqual([
      { kind: 'common', lines: ['a'] },
      { kind: 'change', ours: [], theirs: ['x'] },
      { kind: 'common', lines: ['b'] },
    ]);
  });

  it('handles two separate changes with common between', () => {
    expect(diffSegments(['A', 'k', 'B'], ['a', 'k', 'b'])).toEqual([
      { kind: 'change', ours: ['A'], theirs: ['a'] },
      { kind: 'common', lines: ['k'] },
      { kind: 'change', ours: ['B'], theirs: ['b'] },
    ]);
  });
});

describe('assembleResolution', () => {
  const segs = diffSegments(['a', 'X', 'c'], ['a', 'Y', 'c']);

  it('keeps ours by default (context + ours line)', () => {
    const picks: SidePick[] = [{ ours: true, theirs: false }];
    expect(assembleResolution(segs, picks)).toEqual(['a', 'X', 'c']);
  });

  it('takes theirs for a change', () => {
    expect(assembleResolution(segs, [{ ours: false, theirs: true }])).toEqual(['a', 'Y', 'c']);
  });

  it('takes both (ours first) or neither', () => {
    expect(assembleResolution(segs, [{ ours: true, theirs: true }])).toEqual(['a', 'X', 'Y', 'c']);
    expect(assembleResolution(segs, [{ ours: false, theirs: false }])).toEqual(['a', 'c']);
  });
});
