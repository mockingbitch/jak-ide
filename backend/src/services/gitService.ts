import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { PROJECT_ROOT } from '../config';
import { resolveSafe } from '../security/paths';

/**
 * Git integration via the native `git` binary (spawned, never shelled out).
 * - Works offline (no extra npm dependency; git is assumed installed).
 * - Non-blocking: every call is async; the HTTP layer stays responsive.
 * - Never hangs on credentials or editors (GIT_TERMINAL_PROMPT=0, GIT_EDITOR=true).
 * - Reads PROJECT_ROOT live, so it follows the active project (switch-aware).
 */

export class GitError extends Error {
  code: number;
  stderr: string;
  constructor(message: string, code: number, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

const MAX_BUFFER = 64 * 1024 * 1024; // guard against pathological output

function run(args: string[], opts: { input?: string; cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd ?? PROJECT_ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // never block waiting for username/password
        GIT_EDITOR: 'true', // merge/commit/pull never open an interactive editor
        GIT_PAGER: 'cat',
      },
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > MAX_BUFFER && !killed) {
        killed = true;
        child.kill();
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      const msg =
        e.code === 'ENOENT' ? 'git is not installed or not on PATH' : `Failed to run git: ${e.message}`;
      reject(new GitError(msg, -1, ''));
    });
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    if (opts.input != null) {
      child.stdin.end(opts.input);
    }
  });
}

/** Run git and return stdout, throwing GitError on a non-zero exit. */
async function git(args: string[], opts?: { input?: string; cwd?: string }): Promise<string> {
  const r = await run(args, opts);
  if (r.code !== 0) {
    throw new GitError(r.stderr.trim() || r.stdout.trim() || `git ${args[0]} exited ${r.code}`, r.code, r.stderr);
  }
  return r.stdout;
}

// ---------------------------------------------------------------------------
// Repository state
// ---------------------------------------------------------------------------

export async function isRepo(): Promise<boolean> {
  const r = await run(['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export async function init(): Promise<void> {
  await git(['init']);
}

export interface GitFileEntry {
  path: string;
  orig?: string; // rename source
  index: string; // staged status letter (X) or '.' / '?'
  work: string; // working-tree status letter (Y) or '.' / '?'
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

export async function status(): Promise<GitStatus> {
  if (!(await isRepo())) {
    return { repo: false, branch: null, upstream: null, ahead: 0, behind: 0, detached: false, files: [] };
  }
  const out = await git(['status', '--porcelain=v2', '--branch', '-z']);
  return parseStatusV2(out);
}

function parseStatusV2(out: string): GitStatus {
  const tokens = out.split('\0');
  const files: GitFileEntry[] = [];
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let detached = false;

  for (let i = 0; i < tokens.length; i++) {
    const rec = tokens[i];
    if (!rec) continue;
    if (rec.startsWith('# ')) {
      const [, key, ...rest] = rec.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.head') {
        branch = val === '(detached)' ? null : val;
        detached = val === '(detached)';
      } else if (key === 'branch.upstream') {
        upstream = val;
      } else if (key === 'branch.ab') {
        const m = val.match(/\+(\d+)\s+-(\d+)/);
        if (m) {
          ahead = Number(m[1]);
          behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = rec[0];
    if (type === '1') {
      const f = rec.split(' ');
      files.push({ path: f.slice(8).join(' '), index: f[1][0], work: f[1][1], conflicted: false });
    } else if (type === '2') {
      const f = rec.split(' ');
      const orig = tokens[++i]; // rename source is the next NUL field
      files.push({ path: f.slice(9).join(' '), orig, index: f[1][0], work: f[1][1], conflicted: false });
    } else if (type === 'u') {
      const f = rec.split(' ');
      files.push({ path: f.slice(10).join(' '), index: f[1][0], work: f[1][1], conflicted: true });
    } else if (type === '?') {
      files.push({ path: rec.slice(2), index: '?', work: '?', conflicted: false });
    }
  }
  return { repo: true, branch, upstream, ahead, behind, detached, files };
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export interface BranchInfo {
  name: string;
  current: boolean;
  sha: string;
  upstream: string | null;
}

export async function branches(): Promise<{ current: string | null; local: BranchInfo[]; remote: string[] }> {
  const fmt = '%(HEAD)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)';
  const out = await git(['for-each-ref', `--format=${fmt}`, 'refs/heads']);
  const local: BranchInfo[] = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [head, name, sha, upstream] = line.split('\0');
      return { name, current: head === '*', sha, upstream: upstream || null };
    });
  const remoteOut = await git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes']);
  // Keep only real remote branches (skip the 'origin' / '*/HEAD' symrefs).
  const remote = remoteOut.split('\n').filter((b) => b && b.includes('/') && !b.endsWith('/HEAD'));
  const current = local.find((b) => b.current)?.name ?? null;
  return { current, local, remote };
}

export async function createBranch(name: string, checkout = true, startPoint?: string): Promise<void> {
  const args = checkout ? ['checkout', '-b', name] : ['branch', name];
  if (startPoint) args.push(startPoint);
  await git(args);
}

export async function checkout(name: string): Promise<void> {
  await git(['checkout', name]);
}

/** Check out a remote branch (e.g. 'origin/foo') as a local tracking branch. */
export async function checkoutRemote(remote: string): Promise<void> {
  await git(['checkout', '--track', remote]);
}

export async function renameBranch(oldName: string, newName: string): Promise<void> {
  await git(['branch', '-m', oldName, newName]);
}

export async function deleteBranch(name: string, force = false): Promise<void> {
  await git(['branch', force ? '-D' : '-d', name]);
}

export async function merge(name: string): Promise<string> {
  // A merge that ends in conflicts is a normal, recoverable outcome (not an
  // error): return its output so the UI can refresh and show the conflicts to
  // resolve, rather than surfacing a red failure.
  const r = await run(['merge', '--no-edit', name]);
  if (r.code !== 0) {
    const out = r.stdout + r.stderr;
    if (/CONFLICT|Automatic merge failed|fix conflicts/i.test(out)) return out;
    throw new GitError(r.stderr.trim() || r.stdout.trim() || 'merge failed', r.code, r.stderr);
  }
  return r.stdout;
}

// ---------------------------------------------------------------------------
// Staging, commit, discard
// ---------------------------------------------------------------------------

export async function stage(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await git(['add', '--', ...paths]);
}
export async function stageAll(): Promise<void> {
  await git(['add', '-A']);
}
export async function unstage(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await git(['reset', '-q', 'HEAD', '--', ...paths]);
}
export async function unstageAll(): Promise<void> {
  await git(['reset', '-q', 'HEAD']);
}

/** Discard working-tree changes for tracked files (revert to HEAD). */
export async function discard(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await git(['checkout', 'HEAD', '--', ...paths]);
}

/** Resolve a merge conflict by taking one side, then stage the file. */
export async function resolve(file: string, side: 'ours' | 'theirs'): Promise<void> {
  await git(['checkout', `--${side}`, '--', file]);
  await git(['add', '--', file]);
}

export interface Conflict {
  path: string;
  base: string; // stage 1 (merge base) — '' for add/add
  ours: string; // stage 2 (current branch)
  theirs: string; // stage 3 (incoming)
  working: string; // working-tree file, with conflict markers
}

/** The three conflict stages of a file plus the working copy, for a 3-way merge UI. */
export async function conflict(file: string): Promise<Conflict> {
  const [base, ours, theirs] = await Promise.all([showAt(':1', file), showAt(':2', file), showAt(':3', file)]);
  let working = '';
  try {
    const abs = resolveSafe(file);
    if (await fs.pathExists(abs)) working = await fs.readFile(abs, 'utf8');
  } catch {
    working = '';
  }
  return { path: file, base, ours, theirs, working };
}

export async function commit(message: string, amend = false): Promise<string> {
  const args = ['commit', '-m', message];
  if (amend) args.push('--amend');
  return git(args);
}

/**
 * Commit exactly the given files (PhpStorm-style checkbox commit). Stages the
 * listed paths (so untracked ones are included) then does a partial commit of
 * just those paths — other staged changes are left untouched.
 */
export async function commitFiles(message: string, paths: string[]): Promise<string> {
  if (!paths.length) throw new GitError('No files selected to commit', 1, '');
  // Stage only paths that still exist on disk. A staged rename's source (orig)
  // no longer exists — `git add` would fail on it, and it is already in the
  // index — but it must stay in the commit pathspec so the rename is recorded.
  const toAdd = paths.filter((p) => {
    try {
      return fs.existsSync(resolveSafe(p));
    } catch {
      return false;
    }
  });
  if (toAdd.length) await git(['add', '--', ...toAdd]);
  return git(['commit', '-m', message, '--', ...paths]);
}

// ---------------------------------------------------------------------------
// Diff — returns before/after text for a side-by-side viewer (Monaco DiffEditor)
// ---------------------------------------------------------------------------

/** Contents of `file` at a git ref (e.g. 'HEAD', ':0' for index). '' if absent. */
async function showAt(ref: string, file: string): Promise<string> {
  const r = await run(['show', `${ref}:${file}`]);
  return r.code === 0 ? r.stdout : '';
}

export interface FileDiff {
  path: string;
  mode: 'working' | 'staged' | 'commit';
  base: string;
  modified: string;
  binary: boolean;
  title?: string;
}

export async function diffFile(file: string, mode: 'working' | 'staged'): Promise<FileDiff> {
  const base = await showAt('HEAD', file);
  let modified = '';
  if (mode === 'staged') {
    modified = await showAt(':0', file); // index version
  } else {
    // working tree: read the file from disk (path-safe), '' if it was deleted
    try {
      const abs = resolveSafe(file);
      if (await fs.pathExists(abs)) modified = await fs.readFile(abs, 'utf8');
    } catch {
      modified = '';
    }
  }
  const binary = base.includes('\0') || modified.includes('\0');
  return { path: file, mode, base, modified, binary };
}

/** Diff a file as introduced by a specific commit (parent ↔ commit). */
export async function commitDiff(hash: string, file: string): Promise<FileDiff> {
  const base = await showAt(`${hash}^`, file); // '' for the root commit
  const modified = await showAt(hash, file);
  return {
    path: file,
    mode: 'commit',
    base,
    modified,
    binary: base.includes('\0') || modified.includes('\0'),
    title: `${hash.slice(0, 7)} ↔ parent`,
  };
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

/** `git blame --porcelain` parsed into per-line attribution. */
export async function blame(file: string): Promise<BlameLine[]> {
  const out = await git(['blame', '--porcelain', '--', file]);
  const lines = out.split('\n');
  const meta = new Map<string, { author: string; date: string; summary: string }>();
  const result: BlameLine[] = [];
  let cur: { hash: string; finalLine: number } | null = null;
  for (const l of lines) {
    const hdr = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (hdr) {
      cur = { hash: hdr[1], finalLine: Number(hdr[2]) };
      if (!meta.has(hdr[1])) meta.set(hdr[1], { author: '', date: '', summary: '' });
      continue;
    }
    if (!cur) continue;
    const m = meta.get(cur.hash)!;
    if (l.startsWith('author ')) m.author = l.slice(7);
    else if (l.startsWith('author-time ')) m.date = new Date(Number(l.slice(12)) * 1000).toISOString();
    else if (l.startsWith('summary ')) m.summary = l.slice(8);
    else if (l[0] === '\t') {
      result.push({
        line: cur.finalLine,
        hash: cur.hash,
        short: cur.hash.slice(0, 7),
        author: m.author,
        date: m.date,
        summary: m.summary,
        code: l.slice(1),
      });
      cur = null;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// History (paginated; safe for large repos)
// ---------------------------------------------------------------------------

export interface Commit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  refs: string;
  subject: string;
}

const US = '\x1f'; // unit separator between fields

export async function log(opts: { limit?: number; skip?: number; file?: string } = {}): Promise<Commit[]> {
  const { limit = 80, skip = 0, file } = opts;
  const args = [
    'log',
    `--pretty=format:%H${US}%h${US}%P${US}%an${US}%aI${US}%D${US}%s`,
    '-z',
    '-n',
    String(limit),
    `--skip=${skip}`,
  ];
  if (file) args.push('--follow', '--', file);
  const out = await git(args);
  return out
    .split('\0')
    .filter(Boolean)
    .map((rec) => {
      const [hash, short, parents, author, date, refs, subject] = rec.split(US);
      return {
        hash,
        short,
        parents: parents ? parents.split(' ') : [],
        author,
        email: '',
        date,
        refs: refs || '',
        subject: subject || '',
      };
    });
}

// ---------------------------------------------------------------------------
// Remote operations (fail fast offline / on missing credentials)
// ---------------------------------------------------------------------------

export async function fetch(): Promise<string> {
  return git(['fetch', '--all', '--prune']);
}
export async function pull(): Promise<string> {
  return git(['pull', '--no-edit']);
}
export async function push(setUpstream = false): Promise<string> {
  if (setUpstream) {
    const branch = (await git(['branch', '--show-current'])).trim();
    return git(['push', '-u', 'origin', branch]);
  }
  return git(['push']);
}

export async function remotes(): Promise<{ name: string; url: string }[]> {
  const out = await run(['remote', '-v']);
  if (out.code !== 0) return [];
  const seen = new Map<string, string>();
  for (const line of out.stdout.split('\n').filter(Boolean)) {
    const [name, rest] = line.split('\t');
    if (name && rest) seen.set(name, rest.split(' ')[0]);
  }
  return [...seen].map(([name, url]) => ({ name, url }));
}

// ---------------------------------------------------------------------------
// Clone (into a parent dir; caller then switches the project to the result)
// ---------------------------------------------------------------------------

export function repoNameFromUrl(url: string): string {
  const tail = url.replace(/\/$/, '').split('/').pop() || 'repo';
  return tail.replace(/\.git$/i, '') || 'repo';
}

/** Low-level spawn for callers that need to stream output (e.g. clone progress over SSE). */
export function spawnGit(args: string[], cwd?: string) {
  return spawn('git', args, {
    cwd: cwd ?? PROJECT_ROOT,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_PAGER: 'cat' },
  });
}

export async function clone(url: string, parentDir: string, name?: string): Promise<string> {
  const target = path.join(path.resolve(parentDir), name || repoNameFromUrl(url));
  await fs.ensureDir(path.dirname(target));
  // cwd is irrelevant since target is absolute; this blocks until done (see notes).
  await git(['clone', '--', url, target], { cwd: path.dirname(target) });
  return target;
}
