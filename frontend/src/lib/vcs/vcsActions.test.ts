import { describe, it, expect } from 'vitest';
import { fileActions } from './vcsActions';
import type { GitFileEntry } from '../../types';

const f = (index: string, work: string, conflicted = false): GitFileEntry => ({
  path: 'a.ts',
  index,
  work,
  conflicted,
});
const ids = (e: GitFileEntry) => fileActions(e).map((i) => i.id);

describe('fileActions availability', () => {
  it('unstaged modified: Stage + Rollback, no Unstage', () => {
    const a = ids(f('.', 'M'));
    expect(a).toContain('stage');
    expect(a).toContain('rollback');
    expect(a).not.toContain('unstage');
  });

  it('staged modified: Unstage, no Stage', () => {
    const a = ids(f('M', '.'));
    expect(a).toContain('unstage');
    expect(a).not.toContain('stage');
  });

  it('staged + unstaged (MM): both Stage and Unstage', () => {
    const a = ids(f('M', 'M'));
    expect(a).toContain('stage');
    expect(a).toContain('unstage');
  });

  it('untracked: Add to VCS, no Rollback', () => {
    const items = fileActions(f('?', '?'));
    expect(items.find((i) => i.id === 'stage')?.label).toBe('Add to VCS');
    expect(items.map((i) => i.id)).not.toContain('rollback');
  });

  it('conflicted: Resolve + Mark Resolved', () => {
    const a = ids(f('U', 'U', true));
    expect(a).toContain('resolve');
    expect(a).toContain('stage');
  });

  it('rollback is flagged danger (must confirm)', () => {
    const rb = fileActions(f('.', 'M')).find((i) => i.id === 'rollback');
    expect(rb?.danger).toBe(true);
  });

  it('always offers diff, history, annotate, copy path', () => {
    const a = ids(f('.', 'M'));
    expect(a).toEqual(expect.arrayContaining(['diff', 'history', 'annotate', 'copyPath', 'copyRelPath']));
  });

  it('offers Open File for a modified file but NOT for a deleted one', () => {
    expect(ids(f('.', 'M'))).toContain('open');
    expect(ids(f('D', '.'))).not.toContain('open'); // staged delete
    expect(ids(f('.', 'D'))).not.toContain('open'); // unstaged delete
  });
});
