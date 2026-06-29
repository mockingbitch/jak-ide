import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, activeFileTab, activeGroup } from './store';
import type { GitFileDiff } from './types';

const diff: GitFileDiff = { path: 'a.txt', mode: 'working', base: 'x', modified: 'y', binary: false };
const st = () => useStore.getState();
const openFile = (path: string, content = '') => st().openTab({ path, content, dirty: false });

beforeEach(() => {
  useStore.setState({
    groups: [{ id: 'group-1', tabs: [], activeTabId: null, size: 1 }],
    activeGroupId: 'group-1',
    groupSeq: 1,
    changes: {},
    selection: null,
    cursor: null,
  });
});

describe('tabs (file)', () => {
  it('opens, activates and de-dupes file tabs by path', () => {
    openFile('a.ts', 'A');
    openFile('b.ts', 'B');
    openFile('a.ts', 'A2'); // reopen
    const g = activeGroup(st());
    expect(g.tabs.map((t) => t.id)).toEqual(['a.ts', 'b.ts']);
    expect(g.activeTabId).toBe('a.ts');
    expect(activeFileTab(st())?.path).toBe('a.ts');
  });

  it('setContent marks dirty; markSaved clears; applyAiChange never clobbers a dirty buffer', () => {
    openFile('a.ts', 'A');
    st().setContent('a.ts', 'edited');
    expect(activeFileTab(st())?.dirty).toBe(true);
    st().applyAiChange('a.ts', 'ai'); // dirty → ignored
    expect(activeFileTab(st())?.content).toBe('edited');
    st().markSaved('a.ts');
    st().applyAiChange('a.ts', 'ai'); // clean → applied
    expect(activeFileTab(st())?.content).toBe('ai');
  });
});

describe('aux views are real tabs (regression: a git diff no longer blocks opening files)', () => {
  it('opens a diff as a tab and keeps it when a file is opened afterwards', () => {
    st().openGitDiff(diff);
    expect(activeGroup(st()).activeTabId).toBe('diff:a.txt:working');
    openFile('b.txt', 'hi');
    const g = activeGroup(st());
    expect(g.activeTabId).toBe('b.txt'); // the file shows — bug fixed
    expect(g.tabs.some((t) => t.kind === 'diff')).toBe(true); // diff stays as a tab
    expect(activeFileTab(st())?.path).toBe('b.txt');
  });
});

describe('groups & split', () => {
  it('splitGroup creates a second group seeded with the active tab and focuses it', () => {
    openFile('a.ts', 'A');
    st().splitGroup();
    const s = st();
    expect(s.groups).toHaveLength(2);
    expect(s.activeGroupId).toBe('group-2');
    expect(s.groups[1].tabs.map((t) => t.id)).toEqual(['a.ts']);
  });

  it('moveTab transfers a tab to another group and collapses the emptied source', () => {
    openFile('a.ts');
    openFile('b.ts');
    st().splitGroup(); // group-2 seeded with active 'b.ts'
    st().setActiveGroup('group-1');
    st().moveTab('a.ts', 'group-1', 'group-2');
    const s = st();
    // group-1 had a.ts + b.ts; moving a.ts leaves b.ts
    expect(s.groups.find((g) => g.id === 'group-1')?.tabs.map((t) => t.id)).toEqual(['b.ts']);
    expect(s.groups.find((g) => g.id === 'group-2')?.tabs.map((t) => t.id)).toContain('a.ts');
    expect(s.activeGroupId).toBe('group-2');
  });

  it('closing the last tab of a non-final group collapses that group', () => {
    openFile('a.ts');
    st().splitGroup(); // group-2 with a.ts, active
    st().closeTab('a.ts', 'group-2');
    expect(st().groups).toHaveLength(1);
    expect(st().activeGroupId).toBe('group-1');
  });
});

describe('closeTab', () => {
  it('picks a neighbor as the new active tab', () => {
    openFile('a.ts');
    openFile('b.ts');
    openFile('c.ts');
    st().setActiveTab('group-1', 'b.ts');
    st().closeTab('b.ts', 'group-1');
    expect(activeGroup(st()).activeTabId).toBe('c.ts');
  });

  it('without a groupId closes the tab in every group (e.g. file deleted)', () => {
    openFile('a.ts');
    st().splitGroup();
    st().closeTab('a.ts'); // no groupId
    // both groups emptied → collapse to a single empty group
    expect(st().groups).toHaveLength(1);
    expect(activeGroup(st()).tabs).toHaveLength(0);
  });
});

describe('reconciliation (U8)', () => {
  it('renameTab rewrites path/id/title and the active id', () => {
    openFile('old.ts', 'X');
    st().renameTab('old.ts', 'sub/new.ts');
    const t = activeFileTab(st());
    expect(t?.path).toBe('sub/new.ts');
    expect(t?.id).toBe('sub/new.ts');
    expect(t?.title).toBe('new.ts');
  });

  it('closeTabsUnder closes everything beneath a directory prefix', () => {
    openFile('src/a.ts');
    openFile('src/b.ts');
    openFile('README.md');
    st().closeTabsUnder('src');
    expect(activeGroup(st()).tabs.map((t) => t.path)).toEqual(['README.md']);
  });
});

describe('review fixes', () => {
  it('reopening a file dirty in another group reuses the buffer (no divergent duplicate)', () => {
    openFile('a.ts', 'A');
    st().splitGroup(); // group-2 active, holds a clone of a.ts
    st().setActiveGroup('group-1');
    st().setContent('a.ts', 'EDIT'); // dirty, synced across groups
    st().setActiveGroup('group-2');
    st().openTab({ path: 'a.ts', content: 'DISK', dirty: false }); // reopen from "disk"
    const g2 = st().groups.find((g) => g.id === 'group-2')!;
    const inst = g2.tabs.filter((t) => t.id === 'a.ts');
    expect(inst).toHaveLength(1); // not duplicated
    expect(inst[0].kind === 'file' && inst[0].content).toBe('EDIT'); // dirty buffer preserved
    expect(inst[0].kind === 'file' && inst[0].dirty).toBe(true);
  });

  it('renameTab rebases an aux (diff) tab’s path and id, not just file tabs', () => {
    st().openGitDiff(diff); // id diff:a.txt:working
    st().renameTab('a.txt', 'b.txt');
    const t = activeGroup(st()).tabs.find((tb) => tb.kind === 'diff')!;
    expect(t.path).toBe('b.txt');
    expect(t.id).toBe('diff:b.txt:working');
  });
});

describe('resetWorkspace', () => {
  it('returns to a single fresh empty group', () => {
    openFile('a.ts');
    st().splitGroup();
    st().resetWorkspace();
    expect(st().groups).toHaveLength(1);
    expect(activeGroup(st()).tabs).toHaveLength(0);
  });
});
