export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'done' | 'error'; summary?: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content?: string; // user turns store plain text
  parts?: MessagePart[]; // assistant turns store ordered text/tool parts
  thinking?: string;
  streaming?: boolean;
  images?: { previewUrl: string; name: string }[]; // attachment thumbnails echoed on a user turn
}

/** Server-sent events streamed from POST /api/ai/chat. */
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; summary?: string }
  | { type: 'file_change'; path: string; before: string; after: string; created: boolean }
  | { type: 'error'; error: string };

export interface Selection {
  text: string;
  startLine: number;
  endLine: number;
}

export interface Cursor {
  line: number;
  col: number;
}

export interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
}

// ---- Editor tabs (generalized: a file, or a git diff/blame/history/merge view) ----
export type TabKind = 'file' | 'diff' | 'blame' | 'history' | 'merge';

interface TabBase {
  readonly id: string; // stable identity; file tabs use their path, aux tabs use `${kind}:${path}`
  readonly kind: TabKind;
  readonly path: string;
  readonly title: string;
}
export interface FileTab extends TabBase {
  kind: 'file';
  content: string;
  dirty: boolean;
}
export interface DiffTab extends TabBase {
  kind: 'diff';
  diff: GitFileDiff;
}
export interface BlameTab extends TabBase {
  kind: 'blame';
  lines: BlameLine[];
}
export interface HistoryTab extends TabBase {
  kind: 'history';
  commits: GitCommit[];
}
export interface MergeData {
  base: string;
  ours: string;
  theirs: string;
  working: string;
}
export interface MergeTab extends TabBase {
  kind: 'merge';
  merge: MergeData;
  result: string; // editable 3-way merge result, survives tab switches
}
export type EditorTab = FileTab | DiffTab | BlameTab | HistoryTab | MergeTab;

/** One editor group (column) in the split layout. */
export interface EditorGroup {
  readonly id: string;
  tabs: EditorTab[];
  activeTabId: string | null;
  size: number; // flex-grow weight within the editor row
}

export interface Shell {
  name: string;
  path: string;
}

export interface RecentProject {
  path: string;
  name: string;
}

// ---- Git ----
export interface GitFileEntry {
  path: string;
  orig?: string;
  index: string; // staged status letter (X), '.' unchanged, '?' untracked
  work: string; // working-tree status letter (Y)
  conflicted: boolean;
}
export interface GitStatus {
  repo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  files: GitFileEntry[];
}
export interface BranchInfo {
  name: string;
  current: boolean;
  sha: string;
  upstream: string | null;
}
export interface GitBranches {
  current: string | null;
  local: BranchInfo[];
  remote: string[];
}
export interface GitCommit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  refs: string;
  subject: string;
}
export interface GitFileDiff {
  path: string;
  mode: 'working' | 'staged' | 'commit';
  base: string;
  modified: string;
  binary: boolean;
  title?: string;
}

export interface BlameLine {
  line: number;
  hash: string;
  short: string;
  author: string;
  date: string;
  summary: string;
  code: string;
}

export interface TerminalTab {
  id: string;
  shellPath: string;
  title: string;
}
