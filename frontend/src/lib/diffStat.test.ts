import { describe, it, expect } from 'vitest';
import { diffStat } from './diffStat';

describe('diffStat', () => {
  it('reports nothing for identical text', () => {
    expect(diffStat('a\nb\nc', 'a\nb\nc')).toEqual({ additions: 0, deletions: 0 });
  });

  it('counts a new (created) file as all additions', () => {
    expect(diffStat('', 'a\nb\nc')).toEqual({ additions: 3, deletions: 0 });
  });

  it('counts a fully deleted file as all deletions', () => {
    expect(diffStat('a\nb', '')).toEqual({ additions: 0, deletions: 2 });
  });

  it('counts a pure insertion', () => {
    expect(diffStat('a\nc', 'a\nb\nc')).toEqual({ additions: 1, deletions: 0 });
  });

  it('counts a modified line as one add + one delete', () => {
    expect(diffStat('a\nb\nc', 'a\nB\nc')).toEqual({ additions: 1, deletions: 1 });
  });

  it('counts a pure deletion', () => {
    expect(diffStat('a\nb\nc', 'a\nc')).toEqual({ additions: 0, deletions: 1 });
  });

  it('handles a mix of insert + modify', () => {
    // a b c  ->  a X b c Y : keep a,b,c (lcs=3); add X and Y
    expect(diffStat('a\nb\nc', 'a\nX\nb\nc\nY')).toEqual({ additions: 2, deletions: 0 });
  });
});
