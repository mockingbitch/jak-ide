export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'done' | 'error'; summary?: string }
  | { kind: 'change'; path: string; created?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content?: string; // user turns store plain text
  parts?: MessagePart[]; // assistant turns store ordered text/tool parts
  thinking?: string;
  streaming?: boolean;
  images?: { previewUrl: string; name: string }[]; // attachment thumbnails echoed on a user turn
  startedAt?: number; // ms epoch when this assistant turn began (for the live elapsed timer)
  durationMs?: number; // wall time once finished
  tokens?: number; // output tokens reported by the engine (CLI-style counter)
}

/** Server-sent events streamed from POST /api/ai/chat. */
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; summary?: string }
  | { type: 'file_change'; path: string; before: string; after: string; created: boolean }
  | { type: 'usage'; outputTokens: number; inputTokens?: number; contextWindow?: number }
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

// ---- Editor tabs (generalized: a file, or a git diff/history/merge view) ----
// Blame is no longer a tab — it renders inline in the editor (see useGitAnnotate).
export type TabKind = 'file' | 'diff' | 'history' | 'merge';

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
export type EditorTab = FileTab | DiffTab | HistoryTab | MergeTab;

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

export interface DockerStatus {
  installed: boolean;
  running: boolean;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string; // "running" | "exited" | "created" | "paused" | "restarting" | "dead" | ...
  status: string; // human string, e.g. "Up 2 days"
  ports: string;
  createdAt: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  createdSince: string;
}

/** Summarized `docker inspect` output — the fields the panel shows, not the
 *  full ~200-key blob Docker returns. */
export interface DockerContainerDetail {
  id: string;
  name: string;
  image: string;
  command: string;
  created: string;
  state: string;
  startedAt: string;
  finishedAt: string;
  restartCount: number;
  platform: string;
  ipAddress: string;
  ports: readonly string[];
  mounts: readonly string[];
  env: readonly string[];
  labels: readonly string[];
  networks: readonly string[];
}

export type DbEngine = 'mysql' | 'postgres' | 'sqlite';

/** Connection info sent to the backend per-request — never persisted server-side. */
export interface DbConnInfo {
  engine: DbEngine;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database: string; // for sqlite, the file path
}

/** A saved connection profile (Database tool window). The password is stored
 *  encrypted (see lib/secretStore.ts); `encrypted` says whether it actually is —
 *  false outside Electron, where there's no OS keychain to encrypt against. */
export interface DbConnectionProfile {
  id: string;
  name: string;
  engine: DbEngine;
  host?: string;
  port?: number;
  user?: string;
  database: string;
  password: string;
  encrypted: boolean;
}

export interface DbColumn {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  affected: number | null;
}
