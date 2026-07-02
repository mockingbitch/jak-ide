import { create } from 'zustand';
import { openProjectApi, getTree, getProjects } from './api';
import type {
  TreeNode,
  ChatMessage,
  Selection,
  Cursor,
  OpenFile,
  Shell,
  TerminalTab,
  RecentProject,
  GitFileDiff,
  GitFileEntry,
  GitCommit,
  EditorTab,
  EditorGroup,
  FileTab,
} from './types';
import { basename } from './lib/lang';
import { newGroup, mapGroup, closeOne, closeManyIn, collapseEmptyGroups } from './lib/editorGroups';
import { DEFAULT_THEME, type ThemeSetting } from './theme';

export interface Layout {
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  leftW: number;
  rightW: number;
  bottomH: number;
  leftView: 'project' | 'git' | 'search';
  bottomView: 'terminal' | 'run' | 'problems' | 'docker' | 'database';
}

const DEFAULT_LAYOUT: Layout = {
  leftOpen: true,
  rightOpen: true,
  bottomOpen: true,
  leftW: 260,
  rightW: 400,
  bottomH: 240,
  leftView: 'project',
  bottomView: 'terminal',
};

const CLAMP = {
  leftW: [160, 640],
  rightW: [260, 760],
  bottomH: [120, 760],
} as const;

const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, v));

const PERSIST_KEY = 'jakide.ui';

interface Persisted {
  theme?: ThemeSetting;
  layout?: Layout;
  terminalShell?: string | null;
}

function loadPersisted(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}');
  } catch {
    return {};
  }
}

const persisted = loadPersisted();

// ---- editor group/tab helpers ----
const GROUP_MIN_SIZE = 0.2;
const RESIZE_K = 0.004; // px → flex-grow weight (relative units; ratio is what matters)

const activeGroupOf = (s: State): EditorGroup => s.groups.find((g) => g.id === s.activeGroupId) ?? s.groups[0];

// Open (or refresh + activate) an aux tab in the active group.
function openAux(s: State, tab: EditorTab): Pick<State, 'groups'> {
  return {
    groups: mapGroup(s.groups, s.activeGroupId, (g) => {
      const exists = g.tabs.some((t) => t.id === tab.id);
      const tabs = exists ? g.tabs.map((t) => (t.id === tab.id ? tab : t)) : [...g.tabs, tab];
      return { ...g, tabs, activeTabId: tab.id };
    }),
  };
}

// Apply fn to every FILE tab matching `path`, across all groups (a file open in two
// groups stays in sync — they share one Monaco model anyway).
function updateFileTabs(s: State, path: string, fn: (t: FileTab) => FileTab): Pick<State, 'groups'> {
  return {
    groups: s.groups.map((g) => ({
      ...g,
      tabs: g.tabs.map((t) => (t.kind === 'file' && t.path === path ? fn(t) : t)),
    })),
  };
}

interface State {
  tree: TreeNode | null;
  // Editor area = one or more side-by-side groups; each holds an ordered list of tabs.
  groups: EditorGroup[];
  activeGroupId: string;
  groupSeq: number;
  selection: Selection | null;
  cursor: Cursor | null;
  messages: ChatMessage[];
  hasApiKey: boolean;
  model: string;
  projectRoot: string;
  recents: RecentProject[];
  git: { repo: boolean; branch: string | null; ahead: number; behind: number; changed: number; detached: boolean };
  gitFiles: GitFileEntry[];
  gitRefreshSeq: number; // bumped to ask git consumers (App, GitPanel) to re-fetch
  auth: {
    method: 'apikey' | 'oauth' | 'claude-code' | 'none';
    hasAuth: boolean;
    antInstalled: boolean;
    claudeInstalled?: boolean;
    claudeLoggedIn?: boolean;
  };
  authBusy: boolean; // a sign-in is in progress (shared across all entry points)
  // Context window used by the current chat, derived from the latest turn's
  // reported prompt+output tokens; null until the first usage event arrives.
  contextUsage: { used: number; window: number } | null;
  shells: Shell[];
  terminalShell: string | null;
  fonts: string[];
  theme: ThemeSetting;
  layout: Layout;

  // multiple terminal sessions (tabs)
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  termSeq: number;

  // AI-made changes pending Keep/Revert (path -> baseline before the edits; created = file is new)
  changes: Record<string, { before: string; created?: boolean }>;

  setTree: (t: TreeNode) => void;

  // ---- editor tabs & groups ----
  openTab: (file: OpenFile) => void;
  closeTab: (tabId: string, groupId?: string) => void;
  closeMany: (tabIds: string[], groupId: string) => void; // Close Others / to the Right / All
  setActiveTab: (groupId: string, tabId: string) => void;
  setActiveGroup: (groupId: string) => void;
  splitGroup: () => void;
  closeGroup: (groupId: string) => void;
  resizeGroup: (index: number, delta: number) => void;
  moveTab: (tabId: string, fromGroupId: string, toGroupId: string, index?: number) => void;
  setContent: (path: string, content: string) => void;
  refreshTab: (path: string, content: string) => void;
  applyAiChange: (path: string, content: string) => void;
  markSaved: (path: string) => void;
  renameTab: (oldPath: string, newPath: string) => void;
  closeTabsUnder: (prefix: string) => void;

  setSelection: (s: Selection | null) => void;
  setCursor: (c: Cursor | null) => void;
  setMessages: (m: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setMeta: (m: { hasApiKey: boolean; model: string; projectRoot?: string }) => void;
  setProjects: (current: string, recents: RecentProject[]) => void;
  resetWorkspace: () => void;
  folderPickerOpen: boolean;
  openFolderPicker: () => void;
  closeFolderPicker: () => void;
  switchProject: (dir: string) => Promise<void>;
  setAuth: (a: State['auth']) => void;
  setAuthBusy: (b: boolean) => void;
  setContextUsage: (used: number, window?: number) => void;
  clearContextUsage: () => void;

  setShells: (shells: Shell[], def: string) => void;
  setTerminalShell: (path: string) => void;
  setFonts: (fonts: string[]) => void;

  addTerminal: (shellPath: string) => void;
  addTerminalIfNone: (shellPath: string) => void;
  closeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;

  recordChange: (path: string, before: string, created?: boolean) => void;
  clearChange: (path: string) => void;
  clearAllChanges: () => void;

  setTheme: (patch: Partial<ThemeSetting>) => void;

  setGit: (g: State['git']) => void;
  setGitFiles: (files: GitFileEntry[]) => void;
  openGitDiff: (d: GitFileDiff) => void;
  openGitHistory: (h: { path: string; commits: GitCommit[] }) => void;
  openMergeView: (m: { path: string; base: string; ours: string; theirs: string; working: string }) => void;
  setMergeResult: (tabId: string, result: string) => void;
  bumpGitRefresh: () => void;

  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  selectLeftView: (view: 'project' | 'git' | 'search') => void;
  selectBottomView: (view: 'terminal' | 'run' | 'problems' | 'docker' | 'database') => void;
  resizeLeft: (delta: number) => void;
  resizeRight: (delta: number) => void;
  resizeBottom: (delta: number) => void;
}

function appendTerminal(s: State, shellPath: string) {
  const base = shellPath.split('/').pop() || 'shell';
  const seq = s.termSeq + 1;
  const sameBase = s.terminals.filter((t) => (t.shellPath.split('/').pop() || '') === base).length;
  const id = `term-${seq}`;
  const title = sameBase === 0 ? base : `${base} ${seq}`; // seq is monotonic → no title collisions after closes
  return { termSeq: seq, terminals: [...s.terminals, { id, shellPath, title }], activeTerminalId: id };
}

export const useStore = create<State>((set, get) => ({
  tree: null,
  groups: [newGroup(1)],
  activeGroupId: 'group-1',
  groupSeq: 1,
  selection: null,
  cursor: null,
  messages: [],
  hasApiKey: false,
  model: '',
  projectRoot: '',
  recents: [],
  folderPickerOpen: false,
  git: { repo: false, branch: null, ahead: 0, behind: 0, changed: 0, detached: false },
  gitFiles: [],
  gitRefreshSeq: 0,
  auth: { method: 'none', hasAuth: false, antInstalled: false },
  authBusy: false,
  contextUsage: null,
  shells: [],
  terminalShell: persisted.terminalShell ?? null,
  fonts: [],
  theme: { ...DEFAULT_THEME, ...(persisted.theme ?? {}) },
  layout: { ...DEFAULT_LAYOUT, ...(persisted.layout ?? {}) },

  terminals: [],
  activeTerminalId: null,
  termSeq: 0,

  changes: {},

  setTree: (tree) => set({ tree }),

  // Open (or re-activate) a file as a tab in the active group. Refresh content only
  // when there are no unsaved edits, so we never clobber a dirty buffer.
  openTab: (file) =>
    set((s) => {
      // A file may already be open in another group (split). All instances of a path
      // are kept in sync by updateFileTabs, so reuse the existing buffer rather than
      // the just-loaded disk payload — never clobber an unsaved edit, never diverge.
      const existing = s.groups.flatMap((g) => g.tabs).find((t): t is FileTab => t.kind === 'file' && t.path === file.path);
      const dirty = existing ? existing.dirty : file.dirty;
      const content = existing ? (existing.dirty ? existing.content : file.content) : file.content;
      const make = (): FileTab => ({ id: file.path, kind: 'file', path: file.path, title: basename(file.path), content, dirty });
      const groups = s.groups.map((g) => {
        // 1) sync every existing instance to the resolved content/dirty
        let tabs = g.tabs.map((t) => (t.kind === 'file' && t.path === file.path ? { ...t, content, dirty } : t));
        // 2) ensure the active group holds (and activates) the tab
        if (g.id === s.activeGroupId && !tabs.some((t) => t.id === file.path)) tabs = [...tabs, make()];
        return g.id === s.activeGroupId ? { ...g, tabs, activeTabId: file.path } : { ...g, tabs };
      });
      return { groups, activeGroupId: s.activeGroupId };
    }),

  closeTab: (tabId, groupId) =>
    set((s) => {
      const groups = s.groups.map((g) => (groupId == null || g.id === groupId ? closeOne(g, tabId) : g));
      return collapseEmptyGroups(groups, s.activeGroupId);
    }),

  // Bulk close within one group (Close Others / Close to the Right / Close All).
  closeMany: (tabIds, groupId) =>
    set((s) => {
      const kill = new Set(tabIds);
      const groups = s.groups.map((g) => (g.id === groupId ? closeManyIn(g, kill) : g));
      return collapseEmptyGroups(groups, s.activeGroupId);
    }),

  setActiveTab: (groupId, tabId) =>
    set((s) => ({ activeGroupId: groupId, groups: mapGroup(s.groups, groupId, (g) => ({ ...g, activeTabId: tabId })) })),

  setActiveGroup: (activeGroupId) => set({ activeGroupId }),

  // Split Right: open a second group seeded with a clone of the active tab, focus it.
  splitGroup: () =>
    set((s) => {
      const src = activeGroupOf(s);
      const active = src.tabs.find((t) => t.id === src.activeTabId);
      if (!active) return {}; // nothing to put in a new group — don't create an empty column
      const seq = s.groupSeq + 1;
      const ng = newGroup(seq, [{ ...active }], active.id);
      const idx = s.groups.findIndex((g) => g.id === src.id);
      const groups = [...s.groups.slice(0, idx + 1), ng, ...s.groups.slice(idx + 1)];
      return { groups, groupSeq: seq, activeGroupId: ng.id };
    }),

  closeGroup: (groupId) =>
    set((s) => {
      if (s.groups.length <= 1) return {};
      const groups = s.groups.filter((g) => g.id !== groupId);
      const activeGroupId = groups.some((g) => g.id === s.activeGroupId)
        ? s.activeGroupId
        : groups[groups.length - 1].id;
      return { groups, activeGroupId };
    }),

  resizeGroup: (index, delta) =>
    set((s) => {
      if (index < 0 || index + 1 >= s.groups.length) return {};
      const groups = s.groups.map((g, i) => {
        if (i === index) return { ...g, size: Math.max(GROUP_MIN_SIZE, g.size + delta * RESIZE_K) };
        if (i === index + 1) return { ...g, size: Math.max(GROUP_MIN_SIZE, g.size - delta * RESIZE_K) };
        return g;
      });
      return { groups };
    }),

  // Move a tab from one group to another (drag-drop). Collapses an emptied source group.
  moveTab: (tabId, fromGroupId, toGroupId, index) =>
    set((s) => {
      if (fromGroupId === toGroupId) {
        // reorder within a group
        return {
          groups: mapGroup(s.groups, fromGroupId, (g) => {
            const from = g.tabs.findIndex((t) => t.id === tabId);
            if (from === -1) return g;
            const tabs = [...g.tabs];
            const [moved] = tabs.splice(from, 1);
            tabs.splice(index ?? tabs.length, 0, moved);
            return { ...g, tabs };
          }),
        };
      }
      const src = s.groups.find((g) => g.id === fromGroupId);
      const tab = src?.tabs.find((t) => t.id === tabId);
      if (!tab) return {};
      let groups = s.groups.map((g) => {
        if (g.id === fromGroupId) return closeOne(g, tabId);
        if (g.id === toGroupId) {
          const exists = g.tabs.some((t) => t.id === tabId);
          const tabs = exists ? g.tabs : [...g.tabs.slice(0, index ?? g.tabs.length), tab, ...g.tabs.slice(index ?? g.tabs.length)];
          return { ...g, tabs, activeTabId: tabId };
        }
        return g;
      });
      let activeGroupId = toGroupId;
      if (groups.length > 1) {
        const kept = groups.filter((g) => g.tabs.length > 0);
        if (kept.length < groups.length && kept.length > 0) groups = kept;
        if (!groups.some((g) => g.id === activeGroupId)) activeGroupId = groups[groups.length - 1].id;
      }
      return { groups, activeGroupId };
    }),

  setContent: (path, content) => set((s) => updateFileTabs(s, path, (t) => ({ ...t, content, dirty: true }))),

  // Force an open tab's content (used by Revert — caller intends to discard the buffer).
  refreshTab: (path, content) => set((s) => updateFileTabs(s, path, (t) => ({ ...t, content, dirty: false }))),

  // Reflect an AI edit in an open tab, but NEVER clobber unsaved user edits.
  applyAiChange: (path, content) => set((s) => updateFileTabs(s, path, (t) => (t.dirty ? t : { ...t, content, dirty: false }))),

  markSaved: (path) => set((s) => updateFileTabs(s, path, (t) => ({ ...t, dirty: false }))),

  // Follow a disk rename/move: rebase the path/id/title of EVERY tab (file and the
  // aux diff/blame/history/merge views) whose path matches the renamed file, or sits
  // beneath the renamed directory. Leaving aux tabs on the old path would point their
  // saves/refreshes at a file that no longer exists.
  renameTab: (oldPath, newPath) =>
    set((s) => {
      const remap = (p: string): string | null =>
        p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : null;
      const rebase = (t: EditorTab): EditorTab => {
        const np = remap(t.path);
        if (!np) return t;
        const bn = basename(np);
        switch (t.kind) {
          case 'file':
            return { ...t, id: np, path: np, title: bn };
          case 'diff':
            return { ...t, id: `diff:${np}:${t.diff.mode}`, path: np, title: `Diff: ${bn}` };
          case 'history':
            return { ...t, id: `history:${np}`, path: np, title: `History: ${bn}` };
          case 'merge':
            return { ...t, id: `merge:${np}`, path: np, title: `Merge: ${bn}` };
        }
      };
      return {
        groups: s.groups.map((g) => {
          const before = g.tabs.find((t) => t.id === g.activeTabId);
          const tabs = g.tabs.map(rebase);
          const activeTabId = before ? rebase(before).id : g.activeTabId;
          return { ...g, tabs, activeTabId };
        }),
      };
    }),

  // Close every tab whose file lives under `prefix` (after a directory delete/move).
  closeTabsUnder: (prefix) =>
    set((s) => {
      const under = (p: string) => p === prefix || p.startsWith(prefix + '/');
      const groups = s.groups.map((g) => {
        const tabs = g.tabs.filter((t) => !under(t.path));
        const activeTabId = g.tabs.some((t) => t.id === g.activeTabId && under(t.path))
          ? (tabs[tabs.length - 1]?.id ?? null)
          : g.activeTabId;
        return { ...g, tabs, activeTabId };
      });
      return { groups };
    }),

  setSelection: (selection) => set({ selection }),
  setCursor: (cursor) => set({ cursor }),
  setMessages: (m) =>
    set((s) => ({ messages: typeof m === 'function' ? (m as (p: ChatMessage[]) => ChatMessage[])(s.messages) : m })),
  setMeta: ({ hasApiKey, model, projectRoot }) =>
    set(projectRoot !== undefined ? { hasApiKey, model, projectRoot } : { hasApiKey, model }),
  setProjects: (current, recents) => set({ projectRoot: current, recents }),
  openFolderPicker: () => set({ folderPickerOpen: true }),
  closeFolderPicker: () => set({ folderPickerOpen: false }),
  // Shared project switch: point backend at `dir`, reset the workspace, reload tree + recents.
  switchProject: async (dir) => {
    await openProjectApi(dir);
    get().resetWorkspace();
    set({ folderPickerOpen: false });
    try {
      set({ tree: await getTree() });
    } catch {
      /* empty / unreadable project */
    }
    try {
      const p = await getProjects();
      get().setProjects(p.current, p.recents);
    } catch {
      /* ignore */
    }
  },
  resetWorkspace: () =>
    set((s) => ({
      groups: [newGroup(s.groupSeq + 1)],
      activeGroupId: `group-${s.groupSeq + 1}`,
      groupSeq: s.groupSeq + 1,
      selection: null,
      cursor: null,
      changes: {},
      tree: null,
      terminals: [],
      activeTerminalId: null,
      gitFiles: [],
      git: { repo: false, branch: null, ahead: 0, behind: 0, changed: 0, detached: false },
      contextUsage: null,
    })),

  setGit: (git) => set({ git }),
  setGitFiles: (gitFiles) => set({ gitFiles }),
  openGitDiff: (d) =>
    set((s) => openAux(s, { id: `diff:${d.path}:${d.mode}`, kind: 'diff', path: d.path, title: `Diff: ${basename(d.path)}`, diff: d })),
  openGitHistory: (h) =>
    set((s) => openAux(s, { id: `history:${h.path}`, kind: 'history', path: h.path, title: `History: ${basename(h.path)}`, commits: h.commits })),
  openMergeView: (m) =>
    set((s) =>
      openAux(s, {
        id: `merge:${m.path}`,
        kind: 'merge',
        path: m.path,
        title: `Merge: ${basename(m.path)}`,
        merge: { base: m.base, ours: m.ours, theirs: m.theirs, working: m.working },
        result: m.working,
      })
    ),
  setMergeResult: (tabId, result) =>
    set((s) => ({
      groups: s.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === tabId && t.kind === 'merge' ? { ...t, result } : t)),
      })),
    })),
  bumpGitRefresh: () => set((s) => ({ gitRefreshSeq: s.gitRefreshSeq + 1 })),
  setAuth: (auth) => set({ auth }),
  setAuthBusy: (authBusy) => set({ authBusy }),
  setContextUsage: (used, window) => set((s) => ({ contextUsage: { used, window: window ?? s.contextUsage?.window ?? 200_000 } })),
  clearContextUsage: () => set({ contextUsage: null }),

  setShells: (shells, def) => set((s) => ({ shells, terminalShell: s.terminalShell ?? def })),
  setTerminalShell: (path) => set({ terminalShell: path }),
  setFonts: (fonts) => set({ fonts }),

  addTerminal: (shellPath) => set((s) => appendTerminal(s, shellPath)),
  // Idempotent: reads live state inside set() so StrictMode's double-effect can't create two.
  addTerminalIfNone: (shellPath) => set((s) => (s.terminals.length > 0 ? {} : appendTerminal(s, shellPath))),
  closeTerminal: (id) =>
    set((s) => {
      const idx = s.terminals.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      const terminals = s.terminals.filter((t) => t.id !== id);
      let activeTerminalId = s.activeTerminalId;
      if (s.activeTerminalId === id) {
        activeTerminalId = (terminals[idx] ?? terminals[idx - 1] ?? null)?.id ?? null;
      }
      return { terminals, activeTerminalId };
    }),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),

  recordChange: (path, before, created) =>
    set((s) => (s.changes[path] ? {} : { changes: { ...s.changes, [path]: { before, created } } })),
  clearChange: (path) =>
    set((s) => {
      if (!s.changes[path]) return {};
      const next = { ...s.changes };
      delete next[path];
      return { changes: next };
    }),
  clearAllChanges: () => set({ changes: {} }),

  setTheme: (patch) => set((s) => ({ theme: { ...s.theme, ...patch } })),

  toggleLeft: () => set((s) => ({ layout: { ...s.layout, leftOpen: !s.layout.leftOpen } })),
  toggleRight: () => set((s) => ({ layout: { ...s.layout, rightOpen: !s.layout.rightOpen } })),
  toggleBottom: () => set((s) => ({ layout: { ...s.layout, bottomOpen: !s.layout.bottomOpen } })),
  selectLeftView: (view) =>
    set((s) => {
      const sameAndOpen = s.layout.leftOpen && s.layout.leftView === view;
      return { layout: { ...s.layout, leftView: view, leftOpen: !sameAndOpen } };
    }),
  selectBottomView: (view) =>
    set((s) => {
      const sameAndOpen = s.layout.bottomOpen && s.layout.bottomView === view;
      return { layout: { ...s.layout, bottomView: view, bottomOpen: !sameAndOpen } };
    }),
  resizeLeft: (delta) => set((s) => ({ layout: { ...s.layout, leftW: clamp(s.layout.leftW + delta, CLAMP.leftW) } })),
  resizeRight: (delta) => set((s) => ({ layout: { ...s.layout, rightW: clamp(s.layout.rightW + delta, CLAMP.rightW) } })),
  resizeBottom: (delta) => set((s) => ({ layout: { ...s.layout, bottomH: clamp(s.layout.bottomH + delta, CLAMP.bottomH) } })),
}));

/** The active group, or the first one. */
export const activeGroup = (s: State): EditorGroup => s.groups.find((g) => g.id === s.activeGroupId) ?? s.groups[0];

/** The active tab of the active group iff it is a file (else null). */
export function activeFileTab(s: State): FileTab | null {
  const g = activeGroup(s);
  const t = g?.tabs.find((tt) => tt.id === g.activeTabId);
  return t && t.kind === 'file' ? t : null;
}

/** Helper: the currently active open file (or null). */
export function activeFile(): FileTab | null {
  return activeFileTab(useStore.getState());
}

// Persist UI prefs (theme, layout, chosen shell) — cheap small write.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useStore.subscribe((s) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ theme: s.theme, layout: s.layout, terminalShell: s.terminalShell })
      );
    } catch {
      /* ignore quota / privacy mode */
    }
  }, 150);
});
