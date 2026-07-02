import { describe, it, expect } from 'vitest';
import { newGroup, mapGroup, closeOne, closeManyIn, collapseEmptyGroups } from './editorGroups';
import type { EditorGroup, FileTab } from '../types';

const file = (id: string): FileTab => ({ id, kind: 'file', path: id, title: id, content: '', dirty: false });
const group = (id: string, ids: string[], activeTabId: string | null): EditorGroup => ({
  id,
  tabs: ids.map(file),
  activeTabId,
  size: 1,
});

describe('closeOne', () => {
  it('promotes the neighbour when the active tab is closed', () => {
    const g = closeOne(group('g', ['a', 'b', 'c'], 'b'), 'b');
    expect(g.tabs.map((t) => t.id)).toEqual(['a', 'c']);
    expect(g.activeTabId).toBe('c'); // tab that slid into b's slot
  });
});

describe('closeManyIn', () => {
  it('keeps the target active for Close Others', () => {
    const g = closeManyIn(group('g', ['a', 'b', 'c'], 'a'), new Set(['a', 'c']));
    expect(g.tabs.map((t) => t.id)).toEqual(['b']);
    expect(g.activeTabId).toBe('b');
  });

  it('leaves the active tab untouched when it survives', () => {
    const g = closeManyIn(group('g', ['a', 'b', 'c'], 'a'), new Set(['c']));
    expect(g.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(g.activeTabId).toBe('a');
  });

  it('nulls the active tab when the group is fully cleared', () => {
    const g = closeManyIn(group('g', ['a', 'b'], 'a'), new Set(['a', 'b']));
    expect(g.tabs).toHaveLength(0);
    expect(g.activeTabId).toBeNull();
  });

  it('is a no-op when nothing matches', () => {
    const src = group('g', ['a'], 'a');
    expect(closeManyIn(src, new Set(['z']))).toBe(src);
  });
});

describe('collapseEmptyGroups', () => {
  it('drops an emptied non-final group and repoints the active group', () => {
    const r = collapseEmptyGroups([group('g1', ['a'], 'a'), group('g2', [], null)], 'g2');
    expect(r.groups.map((g) => g.id)).toEqual(['g1']);
    expect(r.activeGroupId).toBe('g1');
  });

  it('keeps a single empty group rather than removing everything', () => {
    const r = collapseEmptyGroups([group('g1', [], null)], 'g1');
    expect(r.groups).toHaveLength(1);
    expect(r.activeGroupId).toBe('g1');
  });
});

describe('newGroup / mapGroup', () => {
  it('newGroup builds a sized, id-stamped group', () => {
    expect(newGroup(3)).toEqual({ id: 'group-3', tabs: [], activeTabId: null, size: 1 });
  });
  it('mapGroup only rewrites the matching group', () => {
    const gs = [group('g1', ['a'], 'a'), group('g2', ['b'], 'b')];
    const out = mapGroup(gs, 'g2', (g) => ({ ...g, activeTabId: null }));
    expect(out[0]).toBe(gs[0]); // untouched reference
    expect(out[1].activeTabId).toBeNull();
  });
});
