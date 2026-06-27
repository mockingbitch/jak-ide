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
}

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
