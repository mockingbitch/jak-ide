import { describe, it, expect } from 'vitest';
import { groupHitsByFile } from './findGroup';
import type { TextHit } from '../api';

const hit = (path: string, line: number): TextHit => ({ path, line, col: 1, matchStart: 0, matchEnd: 1, text: 'x' });

describe('groupHitsByFile', () => {
  it('groups by file preserving first-seen file order and hit order', () => {
    const groups = groupHitsByFile([hit('b.ts', 3), hit('a.ts', 1), hit('b.ts', 9), hit('a.ts', 2)]);
    expect(groups.map((g) => g.path)).toEqual(['b.ts', 'a.ts']);
    expect(groups[0].hits.map((h) => h.line)).toEqual([3, 9]);
    expect(groups[1].hits.map((h) => h.line)).toEqual([1, 2]);
  });

  it('returns an empty array for no hits', () => {
    expect(groupHitsByFile([])).toEqual([]);
  });
});
