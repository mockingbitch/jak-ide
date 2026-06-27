import type {
  TreeNode,
  Shell,
  RecentProject,
  GitStatus,
  GitBranches,
  GitCommit,
  GitFileDiff,
  BlameLine,
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

export interface Health {
  ok: boolean;
  projectRoot: string;
  model: string;
  hasApiKey: boolean;
}

export const getHealth = (): Promise<Health> => fetch('/api/health').then(jsonOrThrow);

export const getTree = (): Promise<TreeNode> => fetch('/api/files/tree').then(jsonOrThrow);

export const getFile = (path: string): Promise<{ content: string; path: string }> =>
  fetch('/api/files/file?path=' + encodeURIComponent(path)).then(jsonOrThrow);

export const saveFile = (path: string, content: string) =>
  POST('/api/files/file/save', { path, content }).then(jsonOrThrow);

export const createFileApi = (path: string, content = '') =>
  POST('/api/files/file/create', { path, content }).then(jsonOrThrow);

export const deleteFileApi = (path: string) =>
  POST('/api/files/file/delete', { path }).then(jsonOrThrow);

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
export const gitStageAll = () => POST('/api/git/stage', { all: true }).then(jsonOrThrow);
export const gitUnstage = (paths: string[]) => POST('/api/git/unstage', { paths }).then(jsonOrThrow);
export const gitUnstageAll = () => POST('/api/git/unstage', { all: true }).then(jsonOrThrow);
export const gitDiscard = (paths: string[]) => POST('/api/git/discard', { paths }).then(jsonOrThrow);
export const gitCommit = (message: string, amend = false): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/commit', { message, amend }).then(jsonOrThrow);

export const gitCreateBranch = (name: string, checkout = true) =>
  POST('/api/git/branch', { name, checkout }).then(jsonOrThrow);
export const gitCheckout = (name: string) => POST('/api/git/checkout', { name }).then(jsonOrThrow);
export const gitDeleteBranch = (name: string, force = false) =>
  POST('/api/git/branch/delete', { name, force }).then(jsonOrThrow);
export const gitMerge = (name: string): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/merge', { name }).then(jsonOrThrow);

export const gitFetch = (): Promise<{ ok: boolean; output: string }> => POST('/api/git/fetch', {}).then(jsonOrThrow);
export const gitPull = (): Promise<{ ok: boolean; output: string }> => POST('/api/git/pull', {}).then(jsonOrThrow);
export const gitPush = (setUpstream = false): Promise<{ ok: boolean; output: string }> =>
  POST('/api/git/push', { setUpstream }).then(jsonOrThrow);

export const gitBlame = (path: string): Promise<BlameLine[]> =>
  fetch(`/api/git/blame?path=${encodeURIComponent(path)}`).then(jsonOrThrow);
export const gitCommitDiff = (hash: string, path: string): Promise<GitFileDiff> =>
  fetch(`/api/git/commit-diff?hash=${encodeURIComponent(hash)}&path=${encodeURIComponent(path)}`).then(jsonOrThrow);
export const gitResolve = (path: string, side: 'ours' | 'theirs') =>
  POST('/api/git/resolve', { path, side }).then(jsonOrThrow);
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
