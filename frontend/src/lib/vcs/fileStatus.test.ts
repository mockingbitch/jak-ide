import { describe, it, expect } from 'vitest';
import { classify } from './fileStatus';
import type { GitFileEntry } from '../../types';

const f = (index: string, work: string, conflicted = false): GitFileEntry => ({
  path: 'a.ts',
  index,
  work,
  conflicted,
});

describe('classify (porcelain v2 X/Y letters)', () => {
  it('unstaged modified (.M)', () => {
    const c = classify(f('.', 'M'));
    expect(c).toMatchObject({ status: 'modified', staged: false, hasUnstaged: true, badge: 'M' });
  });

  it('staged modified (M.)', () => {
    const c = classify(f('M', '.'));
    expect(c).toMatchObject({ status: 'modified', staged: true, hasUnstaged: false, badge: 'M' });
  });

  it('staged AND unstaged (MM) — both flags set', () => {
    const c = classify(f('M', 'M'));
    expect(c.staged).toBe(true);
    expect(c.hasUnstaged).toBe(true);
  });

  it('added (A.), deleted (D.), renamed (R.)', () => {
    expect(classify(f('A', '.')).status).toBe('added');
    expect(classify(f('D', '.')).status).toBe('deleted');
    expect(classify(f('R', '.')).status).toBe('renamed');
  });

  it('untracked (??) and conflicted', () => {
    expect(classify(f('?', '?')).status).toBe('untracked');
    expect(classify(f('U', 'U', true)).status).toBe('conflicted');
    expect(classify(f('U', 'U', true)).badge).toBe('U');
  });
});
