import { describe, it, expect } from 'vitest';
import { resolveMergeShortcut, type KeyState } from './useMergeShortcuts';
import { nextConflictIndex } from '../../lib/merge/mergeActions';

const key = (over: Partial<KeyState>): KeyState => ({
  key: '',
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...over,
});

describe('resolveMergeShortcut', () => {
  it('F7 → next, Shift+F7 → prev (both owned)', () => {
    expect(resolveMergeShortcut(key({ key: 'F7' }))).toEqual({ action: 'next', owned: true });
    expect(resolveMergeShortcut(key({ key: 'F7', shiftKey: true }))).toEqual({ action: 'prev', owned: true });
  });

  it('Alt+O/T/B/R map to accept ours/theirs/both and mark resolved', () => {
    expect(resolveMergeShortcut(key({ key: 'o', altKey: true }))?.action).toBe('acceptOurs');
    expect(resolveMergeShortcut(key({ key: 'T', altKey: true }))?.action).toBe('acceptTheirs'); // case-insensitive
    expect(resolveMergeShortcut(key({ key: 'b', altKey: true }))?.action).toBe('acceptBoth');
    expect(resolveMergeShortcut(key({ key: 'r', altKey: true }))?.action).toBe('markResolved');
  });

  it('Ctrl/Cmd+S → save (owned)', () => {
    expect(resolveMergeShortcut(key({ key: 's', ctrlKey: true }))).toEqual({ action: 'save', owned: true });
    expect(resolveMergeShortcut(key({ key: 's', metaKey: true }))).toEqual({ action: 'save', owned: true });
  });

  it('Escape → focusResult but NOT owned (bubbles to Monaco)', () => {
    expect(resolveMergeShortcut(key({ key: 'Escape' }))).toEqual({ action: 'focusResult', owned: false });
  });

  it('unrelated keys return null so global shortcuts still fire', () => {
    expect(resolveMergeShortcut(key({ key: 'p', metaKey: true }))).toBeNull(); // Cmd+P (file finder)
    expect(resolveMergeShortcut(key({ key: 'a' }))).toBeNull();
  });
});

describe('nextConflictIndex (F7 navigation)', () => {
  it('wraps forward and backward', () => {
    expect(nextConflictIndex(0, 1, 3)).toBe(1);
    expect(nextConflictIndex(2, 1, 3)).toBe(0); // wrap forward
    expect(nextConflictIndex(0, -1, 3)).toBe(2); // wrap backward
  });
  it('is safe for an empty conflict list', () => {
    expect(nextConflictIndex(0, 1, 0)).toBe(0);
  });
});
