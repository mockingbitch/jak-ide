import { describe, it, expect } from 'vitest';
import { parseConflicts } from './conflicts';

describe('parseConflicts', () => {
  it('parses a standard 2-way conflict block', () => {
    const text = 'a\n<<<<<<< HEAD\nOURS\n=======\nTHEIRS\n>>>>>>> feature\nb\n';
    const blocks = parseConflicts(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].ours).toEqual(['OURS']);
    expect(blocks[0].theirs).toEqual(['THEIRS']);
    expect(blocks[0].base).toEqual([]);
  });

  it('parses a diff3 block with a base section', () => {
    const text = '<<<<<<< HEAD\nO\n||||||| base\nB\n=======\nT\n>>>>>>> x\n';
    const [blk] = parseConflicts(text);
    expect(blk.ours).toEqual(['O']);
    expect(blk.base).toEqual(['B']);
    expect(blk.theirs).toEqual(['T']);
  });

  it('finds multiple conflicts and returns none for clean text', () => {
    expect(parseConflicts('nothing here\n')).toEqual([]);
    const two = '<<<<<<< a\n1\n=======\n2\n>>>>>>> b\nx\n<<<<<<< a\n3\n=======\n4\n>>>>>>> b\n';
    expect(parseConflicts(two)).toHaveLength(2);
  });
});
