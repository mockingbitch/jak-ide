import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';

const diff = { path: 'a.txt', mode: 'working' as const, base: 'x', modified: 'y', binary: false };

describe('editor aux views as tabs (regression: git diff no longer blocks opening files)', () => {
  beforeEach(() => {
    useStore.setState({
      tabs: [],
      activePath: null,
      gitDiff: null,
      gitBlame: null,
      gitHistory: null,
      mergeView: null,
      auxActive: false,
    });
  });

  it('opening a git diff focuses the aux view', () => {
    useStore.getState().openGitDiff(diff);
    expect(useStore.getState().auxActive).toBe(true);
    expect(useStore.getState().gitDiff?.path).toBe('a.txt');
  });

  it('opening a file while a diff is open shows the file but keeps the diff as a tab', () => {
    useStore.getState().openGitDiff(diff);
    useStore.getState().openTab({ path: 'b.txt', content: 'hi', dirty: false });
    expect(useStore.getState().auxActive).toBe(false); // the file is shown — the bug is fixed
    expect(useStore.getState().gitDiff).not.toBeNull(); // diff stays available as a tab
    expect(useStore.getState().activePath).toBe('b.txt');
  });

  it('focusAux re-opens the diff; closeAux removes it', () => {
    useStore.getState().openGitDiff(diff);
    useStore.getState().setActivePath('b.txt');
    expect(useStore.getState().auxActive).toBe(false);
    useStore.getState().focusAux();
    expect(useStore.getState().auxActive).toBe(true);
    useStore.getState().closeAux();
    expect(useStore.getState().auxActive).toBe(false);
    expect(useStore.getState().gitDiff).toBeNull();
  });
});
