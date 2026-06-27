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
  BlameLine,
  GitCommit,
} from './types';
import { DEFAULT_THEME, type ThemeSetting } from './theme';

export interface Layout {
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  leftW: number;
  rightW: number;
  bottomH: number;
  leftView: 'project' | 'git';
}

const DEFAULT_LAYOUT: Layout = {
  leftOpen: true,
  rightOpen: true,
  bottomOpen: true,
  leftW: 260,
  rightW: 400,
  bottomH: 240,
  leftView: 'project',
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

interface State {
  tree: TreeNode | null;
  tabs: OpenFile[];
  activePath: string | null;
  selection: Selection | null;
  cursor: Cursor | null;
  messages: ChatMessage[];
  hasApiKey: boolean;
  model: string;
  projectRoot: string;
  recents: RecentProject[];
  git: { repo: boolean; branch: string | null; ahead: number; behind: number; changed: number; detached: boolean };
  gitFiles: GitFileEntry[];
  gitDiff: GitFileDiff | null;
  gitBlame: { path: string; lines: BlameLine[] } | null;
  gitHistory: { path: string; commits: GitCommit[] } | null;
  mergeView: { path: string; base: string; ours: string; theirs: string; working: string } | null;
  gitRefreshSeq: number; // bumped to ask git consumers (App, GitPanel) to re-fetch
  auth: {
    method: 'apikey' | 'oauth' | 'claude-code' | 'none';
    hasAuth: boolean;
    antInstalled: boolean;
    claudeInstalled?: boolean;
    claudeLoggedIn?: boolean;
  };
  authBusy: boolean; // a sign-in is in progress (shared across all entry points)
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

  openTab: (file: OpenFile) => void;
  closeTab: (path: string) => void;
  setActivePath: (path: string | null) => void;
  setContent: (path: string, content: string) => void;
  refreshTab: (path: string, content: string) => void;
  applyAiChange: (path: string, content: string) => void;
  markSaved: (path: string) => void;

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
  closeGitDiff: () => void;
  openGitBlame: (b: { path: string; lines: BlameLine[] }) => void;
  closeGitBlame: () => void;
  openGitHistory: (h: { path: string; commits: GitCommit[] }) => void;
  closeGitHistory: () => void;
  openMergeView: (m: { path: string; base: string; ours: string; theirs: string; working: string }) => void;
  closeMergeView: () => void;
  bumpGitRefresh: () => void;

  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  selectLeftView: (view: 'project' | 'git') => void;
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
  tabs: [],
  activePath: null,
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
  gitDiff: null,
  gitBlame: null,
  gitHistory: null,
  mergeView: null,
  gitRefreshSeq: 0,
  auth: { method: 'none', hasAuth: false, antInstalled: false },
  authBusy: false,
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

  openTab: (file) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === file.path);
      if (existing) {
        // Re-activate; refresh content only if there are no unsaved edits.
        const tabs = existing.dirty ? s.tabs : s.tabs.map((t) => (t.path === file.path ? file : t));
        return { tabs, activePath: file.path };
      }
      return { tabs: [...s.tabs, file], activePath: file.path };
    }),

  closeTab: (path) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path);
      if (idx === -1) return {};
      const tabs = s.tabs.filter((t) => t.path !== path);
      let activePath = s.activePath;
      if (s.activePath === path) {
        const next = tabs[idx] ?? tabs[idx - 1] ?? null;
        activePath = next?.path ?? null;
      }
      return { tabs, activePath };
    }),

  setActivePath: (activePath) => set({ activePath }),

  setContent: (path, content) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content, dirty: true } : t)) })),

  // Force an open tab's content (used by Revert — caller intends to discard the buffer).
  refreshTab: (path, content) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content, dirty: false } : t)) })),

  // Reflect an AI edit in an open tab, but NEVER clobber unsaved user edits.
  applyAiChange: (path, content) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.path === path);
      if (!tab || tab.dirty) return {};
      return { tabs: s.tabs.map((t) => (t.path === path ? { ...t, content, dirty: false } : t)) };
    }),

  markSaved: (path) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty: false } : t)) })),

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
    set({
      tabs: [],
      activePath: null,
      selection: null,
      cursor: null,
      changes: {},
      tree: null,
      terminals: [],
      activeTerminalId: null,
      gitDiff: null,
      gitBlame: null,
      gitHistory: null,
      mergeView: null,
      gitFiles: [],
      git: { repo: false, branch: null, ahead: 0, behind: 0, changed: 0, detached: false },
    }),

  setGit: (git) => set({ git }),
  setGitFiles: (gitFiles) => set({ gitFiles }),
  // The editor-area git views are mutually exclusive.
  openGitDiff: (gitDiff) => set({ gitDiff, gitBlame: null, gitHistory: null, mergeView: null }),
  closeGitDiff: () => set({ gitDiff: null }),
  openGitBlame: (gitBlame) => set({ gitBlame, gitDiff: null, gitHistory: null, mergeView: null }),
  closeGitBlame: () => set({ gitBlame: null }),
  openGitHistory: (gitHistory) => set({ gitHistory, gitDiff: null, gitBlame: null, mergeView: null }),
  closeGitHistory: () => set({ gitHistory: null }),
  openMergeView: (mergeView) => set({ mergeView, gitDiff: null, gitBlame: null, gitHistory: null }),
  closeMergeView: () => set({ mergeView: null }),
  bumpGitRefresh: () => set((s) => ({ gitRefreshSeq: s.gitRefreshSeq + 1 })),
  setAuth: (auth) => set({ auth }),
  setAuthBusy: (authBusy) => set({ authBusy }),

  setShells: (shells, def) =>
    set((s) => ({ shells, terminalShell: s.terminalShell ?? def })),
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
  resizeLeft: (delta) =>
    set((s) => ({ layout: { ...s.layout, leftW: clamp(s.layout.leftW + delta, CLAMP.leftW) } })),
  resizeRight: (delta) =>
    set((s) => ({ layout: { ...s.layout, rightW: clamp(s.layout.rightW + delta, CLAMP.rightW) } })),
  resizeBottom: (delta) =>
    set((s) => ({ layout: { ...s.layout, bottomH: clamp(s.layout.bottomH + delta, CLAMP.bottomH) } })),
}));

/** Helper: the currently active open file (or null). */
export function activeFile(): OpenFile | null {
  const s = useStore.getState();
  return s.tabs.find((t) => t.path === s.activePath) ?? null;
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
