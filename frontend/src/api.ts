import type {
  TreeNode,
  Shell,
  RecentProject,
  GitStatus,
  GitBranches,
  GitCommit,
  GitFileDiff,
  BlameLine,
  DockerStatus,
  DockerContainer,
  DockerImage,
  DockerContainerDetail,
  DbConnInfo,
  DbColumn,
  DbQueryResult,
} from './types';

async function jsonOrThrow(r: Response) {
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${r.status})`);
  }
  return r.json();
}

const POST = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const DELETE = (url: string) => fetch(url, { method: 'DELETE' });

export interface Health {
  ok: boolean;
  projectRoot: string;
  model: string;
  hasApiKey: boolean;
}

export const getHealth = (): Promise<Health> => fetch('/api/health').then(jsonOrThrow);

export const getTree = (): Promise<TreeNode> => fetch('/api/files/tree').then(jsonOrThrow);

// Native (Rust) index/search. File names resolve against the fuzzy index in the
// core, so "Go to file" no longer needs the full project tree held in the client.
export const searchFiles = (q: string, limit = 50): Promise<{ results: string[] }> =>
  fetch(`/api/search/files?q=${encodeURIComponent(q)}&limit=${limit}`).then(jsonOrThrow);

export interface TextHit {
  path: string;
  line: number;
  /** 1-based column of the first match (UTF-16 units), for editor navigation. */
  col: number;
  /** First-match span as UTF-16 offsets into `text`, for highlighting. */
  matchStart: number;
  matchEnd: number;
  text: string;
}

/** Content-search options shared by Find in Files search + replace. */
export interface FindOpts {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Comma/newline-separated globs to include; empty = all files. */
  include: string;
  /** Comma/newline-separated globs to exclude. */
  exclude: string;
}

const findParams = (q: string, o: FindOpts) =>
  new URLSearchParams({
    q,
    regex: String(o.regex),
    caseSensitive: String(o.caseSensitive),
    wholeWord: String(o.wholeWord),
    include: o.include,
    exclude: o.exclude,
  });

// `error` is set (with results: []) when the regex/glob is invalid — shown inline.
export const searchText = (q: string, o: FindOpts, limit = 500): Promise<{ results: TextHit[]; error?: string }> => {
  const p = findParams(q, o);
  p.set('limit', String(limit));
  return fetch(`/api/search/text?${p.toString()}`).then(jsonOrThrow);
};

/** Replace across the project. `files` restricts the rewrite to specific rel paths. */
export const replaceInFiles = (
  q: string,
  replacement: string,
  o: FindOpts,
  files?: string[]
): Promise<{ ok: boolean; filesChanged: number; replacements: number }> =>
  POST('/api/search/replace', { q, replacement, ...o, files }).then(jsonOrThrow);

export const getFile = (path: string): Promise<{ content: string; path: string }> =>
  fetch('/api/files/file?path=' + encodeURIComponent(path)).then(jsonOrThrow);
// Read-only fetch of a file OUTSIDE the project root (a go-to-definition target in a
// dependency / language-server stub). `absPath` must be absolute.
export const getExternalFile = (absPath: string): Promise<{ content: string; path: string }> =>
  fetch('/api/files/external?path=' + encodeURIComponent(absPath)).then(jsonOrThrow);

export interface SymbolItem {
  name: string;
  kind: string;
  line: number;
  col: number;
  /** Leading-whitespace columns of the declaration, for nested indentation in the UI. */
  indent: number;
}
// Heuristic document symbols (Go to Symbol). `content` is the live buffer so symbols
// reflect unsaved edits; `path` only selects the language ruleset by extension.
export const getSymbols = (path: string, content: string): Promise<{ symbols: SymbolItem[] }> =>
  POST('/api/symbols', { path, content }).then(jsonOrThrow);

// ---- Native code intelligence (Rust PHP indexer) ----
export interface IntelLocation {
  /** Project-relative posix path when external === false; absolute path otherwise. */
  path: string;
  external: boolean;
  line: number; // 1-based
  column: number; // 1-based, UTF-16 code units
  name: string;
  kind: string; // 'class' | 'interface' | 'trait' | 'enum' | 'function'
  /** Trimmed declaration line text. */
  preview: string;
  confidence: number; // 0..1
}
// Go to definition via the native index. `content` is the live buffer; `line`/`column`
// are 1-based Monaco coordinates (UTF-16 columns), passed through as-is.
export const intelDefinition = (path: string, content: string, line: number, column: number): Promise<{ locations: IntelLocation[] }> =>
  POST('/api/intel/definition', { path, content, line, column }).then(jsonOrThrow);

export interface IntelStatus {
  root: string;
  indexing: boolean;
  files: number;
  symbols: number;
  lastIndexMs: number | null;
}
export const intelStatus = (): Promise<IntelStatus> => fetch('/api/intel/status').then(jsonOrThrow);

export const saveFile = (path: string, content: string) =>
  POST('/api/files/file/save', { path, content }).then(jsonOrThrow);

export const createFileApi = (path: string, content = '') =>
  POST('/api/files/file/create', { path, content }).then(jsonOrThrow);

export const deleteFileApi = (path: string) =>
  POST('/api/files/file/delete', { path }).then(jsonOrThrow);

// File operations (rename doubles as move). The server rebuilds the fuzzy index.
export const renameFileApi = (path: string, newPath: string): Promise<{ ok: boolean; path: string }> =>
  POST('/api/files/rename', { path, newPath }).then(jsonOrThrow);

export const mkdirApi = (path: string) => POST('/api/files/mkdir', { path }).then(jsonOrThrow);

export const copyFileApi = (from: string, to: string): Promise<{ ok: boolean; path: string }> =>
  POST('/api/files/copy', { from, to }).then(jsonOrThrow);

export const runCommandApi = (command: string) =>
  POST('/api/run-command', { command }).then(jsonOrThrow);

export interface ApplyPayload {
  path: string;
  type?: 'edit' | 'create';
  hunks?: { search: string; replace: string }[];
  content?: string;
}

export const applyEditApi = (p: ApplyPayload): Promise<{ ok: boolean; content: string }> =>
  POST('/api/files/apply', p).then(jsonOrThrow);

export const getShells = (): Promise<{ shells: Shell[]; default: string }> =>
  fetch('/api/terminal/shells').then(jsonOrThrow);

export interface ProjectsInfo {
  current: string;
  name: string;
  recents: RecentProject[];
}
export const getProjects = (): Promise<ProjectsInfo> => fetch('/api/projects').then(jsonOrThrow);

export const openProjectApi = (path: string): Promise<{ ok: boolean; current: string; name: string }> =>
  POST('/api/projects/open', { path }).then(jsonOrThrow);

export interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  entries: { name: string; path: string }[];
}
export const browseDir = (path?: string): Promise<BrowseResult> =>
  fetch('/api/projects/browse' + (path ? '?path=' + encodeURIComponent(path) : '')).then(jsonOrThrow);

// ---- Git ----
export const gitStatus = (): Promise<GitStatus> => fetch('/api/git/status').then(jsonOrThrow);
export const gitBranches = (): Promise<GitBranches> => fetch('/api/git/branches').then(jsonOrThrow);
export const gitLog = (limit = 80, skip = 0, file?: string): Promise<GitCommit[]> =>
  fetch(`/api/git/log?limit=${limit}&skip=${skip}` + (file ? `&file=${encodeURIComponent(file)}` : '')).then(jsonOrThrow);
export const gitDiffApi = (path: string, mode: 'working' | 'staged'): Promise<GitFileDiff> =>
  fetch(`/api/git/diff?path=${encodeURIComponent(path)}&mode=${mode}`).then(jsonOrThrow);

export const gitInit = () => POST('/api/git/init', {}).then(jsonOrThrow);
export const gitClone = (url: string, parent: string, name?: string): Promise<{ ok: boolean; path: string }> =>
  POST('/api/git/clone', { url, parent, name }).then(jsonOrThrow);

export const gitStage = (paths: string[]) => POST('/api/git/stage', { paths }).then(jsonOrThrow);
export const gitDiscard = (paths: string[]) => POST('/api/git/discard', { paths }).then(jsonOrThrow);
export const gitCommit = (message: string, amend = false): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/commit', { message, amend }).then(jsonOrThrow);
/** PhpStorm-style: commit exactly the given (checked) files. */
export const gitCommitFiles = (message: string, paths: string[]): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/commit', { message, paths }).then(jsonOrThrow);

export const gitCreateBranch = (name: string, checkout = true, startPoint?: string) =>
  POST('/api/git/branch', { name, checkout, startPoint }).then(jsonOrThrow);
export const gitCheckout = (name: string) => POST('/api/git/checkout', { name }).then(jsonOrThrow);
export const gitCheckoutRemote = (remote: string) => POST('/api/git/checkout-remote', { remote }).then(jsonOrThrow);
export const gitRenameBranch = (oldName: string, newName: string) =>
  POST('/api/git/branch/rename', { oldName, newName }).then(jsonOrThrow);
export const gitDeleteBranch = (name: string, force = false) =>
  POST('/api/git/branch/delete', { name, force }).then(jsonOrThrow);
export const gitMerge = (name: string): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/merge', { name }).then(jsonOrThrow);

export const gitFetch = (): Promise<{ ok: boolean; output: string }> => POST('/api/git/fetch', {}).then(jsonOrThrow);
export const gitPull = (opts: { remote?: string; branch?: string; rebase?: boolean } = {}): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/pull', opts).then(jsonOrThrow);
export const gitPush = (setUpstream = false): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/push', { setUpstream }).then(jsonOrThrow);

export const gitBlame = (path: string): Promise<BlameLine[]> =>
  fetch(`/api/git/blame?path=${encodeURIComponent(path)}`).then(jsonOrThrow);
export const gitCommitDiff = (hash: string, path: string): Promise<GitFileDiff> =>
  fetch(`/api/git/commit-diff?hash=${encodeURIComponent(hash)}&path=${encodeURIComponent(path)}`).then(jsonOrThrow);
export const gitResolve = (path: string, side: 'ours' | 'theirs') =>
  POST('/api/git/resolve', { path, side }).then(jsonOrThrow);
export interface GitConflict {
  path: string;
  base: string;
  ours: string;
  theirs: string;
  working: string;
}
export const gitConflict = (path: string): Promise<GitConflict> =>
  fetch(`/api/git/conflict?path=${encodeURIComponent(path)}`).then(jsonOrThrow);
/** SSE URL for streaming clone progress (consumed with fetch + ReadableStream). */
export const gitCloneStreamUrl = (url: string, parent: string, name?: string) =>
  `/api/git/clone-stream?url=${encodeURIComponent(url)}&parent=${encodeURIComponent(parent)}` +
  (name ? `&name=${encodeURIComponent(name)}` : '');

export const getFonts = (): Promise<{ fonts: string[]; source: string }> =>
  fetch('/api/fonts').then(jsonOrThrow);

export interface AuthStatus {
  method: 'apikey' | 'oauth' | 'claude-code' | 'none';
  hasAuth: boolean;
  antInstalled: boolean;
  claudeInstalled?: boolean;
  claudeLoggedIn?: boolean;
}
export const getAuthStatus = (): Promise<AuthStatus> => fetch('/api/auth/status').then(jsonOrThrow);
// Login may return 200 or 400 (with {ok,error}); read the body either way.
export const authLogin = (): Promise<{ ok: boolean; error?: string }> =>
  POST('/api/auth/login', {}).then((r) => r.json());
export const authLogout = (): Promise<{ ok: boolean }> => POST('/api/auth/logout', {}).then(jsonOrThrow);

// ---- Docker tool window ----
export const dockerStatus = (): Promise<DockerStatus> => fetch('/api/docker/status').then(jsonOrThrow);
export const dockerContainers = (): Promise<DockerContainer[]> => fetch('/api/docker/containers').then(jsonOrThrow);
export const dockerImages = (): Promise<DockerImage[]> => fetch('/api/docker/images').then(jsonOrThrow);
export const dockerStartContainer = (id: string) => POST(`/api/docker/containers/${id}/start`, {}).then(jsonOrThrow);
export const dockerStopContainer = (id: string) => POST(`/api/docker/containers/${id}/stop`, {}).then(jsonOrThrow);
export const dockerRestartContainer = (id: string) => POST(`/api/docker/containers/${id}/restart`, {}).then(jsonOrThrow);
export const dockerRemoveContainer = (id: string) => DELETE(`/api/docker/containers/${id}`).then(jsonOrThrow);
export const dockerRemoveImage = (id: string) => DELETE(`/api/docker/images/${id}`).then(jsonOrThrow);
export const dockerInspectContainer = (id: string): Promise<DockerContainerDetail> =>
  fetch(`/api/docker/containers/${id}/inspect`).then(jsonOrThrow);

// ---- Database tool window ----
export const dbTest = (c: DbConnInfo): Promise<{ ok: boolean }> => POST('/api/db/test', c).then(jsonOrThrow);
export const dbTables = (c: DbConnInfo): Promise<string[]> => POST('/api/db/tables', c).then(jsonOrThrow);
export const dbColumns = (c: DbConnInfo, table: string): Promise<DbColumn[]> => POST('/api/db/columns', { ...c, table }).then(jsonOrThrow);
export const dbQuery = (c: DbConnInfo, sql: string): Promise<DbQueryResult> => POST('/api/db/query', { ...c, sql }).then(jsonOrThrow);
