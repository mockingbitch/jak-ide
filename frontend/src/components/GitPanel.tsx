import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  gitStatus,
  gitLog,
  gitDiffApi,
  gitDiscard,
  gitCommitFiles,
  gitInit,
  gitResolve,
  gitConflict,
  gitFetch,
  gitPull,
  gitPush,
} from '../api';
import type { GitStatus, GitCommit, GitFileEntry } from '../types';
import { FileIcon } from './FileIcon';
import { CloneDialog } from './CloneDialog';
import { BranchMenu } from './BranchMenu';
import { IconBranch, IconRefresh, IconArrowUp, IconArrowDown, IconTrash, IconChevronDown, IconCheck } from './icons';

const dirOf = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};
const baseOf = (p: string) => p.split('/').pop() ?? p;

function statusOf(f: GitFileEntry): { letter: string; cls: string; label: string } {
  if (f.conflicted) return { letter: 'U', cls: 'u', label: 'Conflicted' };
  if (f.index === '?') return { letter: '?', cls: 'q', label: 'Untracked' };
  const l = f.work !== '.' ? f.work : f.index;
  const cls = l === 'A' ? 'a' : l === 'D' ? 'd' : l === 'R' || l === 'C' ? 'r' : 'm';
  const label = l === 'A' ? 'Added' : l === 'D' ? 'Deleted' : l === 'R' ? 'Renamed' : l === 'C' ? 'Copied' : 'Modified';
  return { letter: l, cls, label };
}

// ---- commit graph (lane assignment) ----
const GRAPH_COLORS = ['#4d9fff', '#5fb865', '#e5c07b', '#c678dd', '#56b6c2', '#e06c75', '#d19a66', '#98c379'];
const LANE = 14;
const ROW_H = 50;

interface GraphRow {
  commit: GitCommit;
  col: number;
  lanesIn: (string | null)[];
  lanesOut: (string | null)[];
}

function computeGraph(commits: GitCommit[]): { rows: GraphRow[]; lanes: number } {
  const lanes: (string | null)[] = [];
  let maxLanes = 1;
  const rows: GraphRow[] = [];
  for (const c of commits) {
    const lanesIn = lanes.slice();
    let col = lanes.indexOf(c.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(null);
      }
      lanes[col] = c.hash;
    }
    for (let i = 0; i < lanes.length; i++) if (i !== col && lanes[i] === c.hash) lanes[i] = null;
    if (c.parents.length === 0) {
      lanes[col] = null;
    } else {
      lanes[col] = c.parents[0];
      for (let p = 1; p < c.parents.length; p++) {
        let pc = lanes.indexOf(c.parents[p]);
        if (pc === -1) {
          pc = lanes.indexOf(null);
          if (pc === -1) {
            pc = lanes.length;
            lanes.push(null);
          }
          lanes[pc] = c.parents[p];
        }
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    maxLanes = Math.max(maxLanes, lanesIn.length, lanes.length);
    rows.push({ commit: c, col, lanesIn, lanesOut: lanes.slice() });
  }
  return { rows, lanes: Math.min(maxLanes, 8) };
}

function GraphCell({ row, lanes }: { row: GraphRow; lanes: number }) {
  const x = (c: number) => c * LANE + LANE / 2;
  const mid = ROW_H / 2;
  const color = (c: number) => GRAPH_COLORS[c % GRAPH_COLORS.length];
  const segs: JSX.Element[] = [];
  row.lanesOut.forEach((hash, j) => {
    if (!hash) return;
    const inIdx = row.lanesIn.indexOf(hash);
    if (inIdx !== -1) segs.push(<line key={'o' + j} x1={x(inIdx)} y1={0} x2={x(j)} y2={ROW_H} stroke={color(j)} strokeWidth={1.5} />);
    else segs.push(<line key={'o' + j} x1={x(row.col)} y1={mid} x2={x(j)} y2={ROW_H} stroke={color(j)} strokeWidth={1.5} />);
  });
  row.lanesIn.forEach((hash, i) => {
    if (hash === row.commit.hash)
      segs.push(<line key={'i' + i} x1={x(i)} y1={0} x2={x(row.col)} y2={mid} stroke={color(row.col)} strokeWidth={1.5} />);
  });
  return (
    <svg className="git-graph" width={lanes * LANE} height={ROW_H}>
      {segs}
      <circle cx={x(row.col)} cy={mid} r={3.6} fill={color(row.col)} stroke="var(--bg-2)" strokeWidth={1.5} />
    </svg>
  );
}

export function GitPanel() {
  const projectRoot = useStore((s) => s.projectRoot);
  const setGit = useStore((s) => s.setGit);
  const setGitFiles = useStore((s) => s.setGitFiles);
  const openGitDiff = useStore((s) => s.openGitDiff);
  const openMergeView = useStore((s) => s.openMergeView);
  const gitRefreshSeq = useStore((s) => s.gitRefreshSeq);

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [tab, setTab] = useState<'changes' | 'log'>('changes');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchMenu, setBranchMenu] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const prevPaths = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const st = await gitStatus();
      setStatus(st);
      setGit({ repo: st.repo, branch: st.branch, ahead: st.ahead, behind: st.behind, changed: st.files.length, detached: st.detached });
      setGitFiles(st.files);
      setCommits(st.repo ? await gitLog(80) : []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setGit, setGitFiles]);

  useEffect(() => {
    refresh();
  }, [refresh, projectRoot, gitRefreshSeq]);

  // Reconcile commit selection when the file list changes: new files default
  // to checked, files the user unchecked stay unchecked.
  useEffect(() => {
    const committable = (status?.files ?? []).filter((f) => !f.conflicted);
    setSelected((prev) => {
      const next = new Set<string>();
      for (const f of committable) if (!prevPaths.current.has(f.path) || prev.has(f.path)) next.add(f.path);
      return next;
    });
    prevPaths.current = new Set(committable.map((f) => f.path));
  }, [status]);

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDiff = async (f: GitFileEntry) => {
    try {
      openGitDiff(await gitDiffApi(f.path, 'working'));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openMerge = async (p: string) => {
    try {
      openMergeView(await gitConflict(p));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = (p: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const toggleGroup = (list: GitFileEntry[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      list.forEach((f) => (on ? n.add(f.path) : n.delete(f.path)));
      return n;
    });

  const commit = () =>
    act(async () => {
      const paths: string[] = [];
      for (const f of status?.files ?? [])
        if (selected.has(f.path)) {
          paths.push(f.path);
          if (f.orig) paths.push(f.orig);
        }
      await gitCommitFiles(message.trim(), paths);
      setMessage('');
    });

  const graph = useMemo(() => computeGraph(commits), [commits]);

  // --- not a git repo -----------------------------------------------------
  if (status && !status.repo) {
    return (
      <div className="git-panel">
        <div className="tw-header">
          <span className="tw-title">Version Control</span>
          <button className="icon-btn" title="Refresh" onClick={refresh}>
            <IconRefresh size={15} />
          </button>
        </div>
        <div className="git-empty">
          <div className="git-empty-icon">
            <IconBranch size={26} />
          </div>
          <p>This project is not under version control yet.</p>
          <div className="git-empty-actions">
            <button className="primary" disabled={busy} onClick={() => act(gitInit)}>
              Initialize Repository
            </button>
            <button disabled={busy} onClick={() => setCloning(true)}>
              Clone Repository…
            </button>
          </div>
          {error && <div className="git-error">{error}</div>}
        </div>
        {cloning && <CloneDialog parentDefault={dirOf(projectRoot) || projectRoot} onClose={() => setCloning(false)} />}
      </div>
    );
  }

  const files = status?.files ?? [];
  const conflicts = files.filter((f) => f.conflicted);
  const changes = files.filter((f) => !f.conflicted && f.index !== '?');
  const untracked = files.filter((f) => f.index === '?');
  const selectedCount = [...changes, ...untracked].filter((f) => selected.has(f.path)).length;

  const FileRow = ({ f }: { f: GitFileEntry }) => {
    const s = statusOf(f);
    return (
      <div className="git-file" onClick={() => openDiff(f)} title={f.path}>
        <input
          type="checkbox"
          className="git-check"
          checked={selected.has(f.path)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(f.path)}
        />
        <span className={'git-badge ' + s.cls} title={s.label} aria-label={s.label}>
          {s.letter}
        </span>
        <FileIcon name={baseOf(f.path)} />
        <span className="git-file-name">{baseOf(f.path)}</span>
        <span className="git-file-dir">{dirOf(f.path)}</span>
        <span className="git-file-actions" onClick={(e) => e.stopPropagation()}>
          {f.index !== '?' && (
            <button
              className="icon-btn xs danger"
              title="Discard changes"
              onClick={() => confirm(`Discard changes to ${f.path}?`) && act(() => gitDiscard([f.path]))}
            >
              <IconTrash size={13} />
            </button>
          )}
        </span>
      </div>
    );
  };

  const Group = ({ title, list }: { title: string; list: GitFileEntry[] }) => {
    if (list.length === 0) return null;
    const sel = list.filter((f) => selected.has(f.path)).length;
    const all = sel === list.length;
    const some = sel > 0 && !all;
    return (
      <div className="git-group">
        <div className="git-group-head">
          <label className="git-group-check">
            <input
              type="checkbox"
              className="git-check"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = some;
              }}
              onChange={() => toggleGroup(list, !all)}
            />
            {title} <span className="git-count">{list.length}</span>
          </label>
        </div>
        {list.map((f) => (
          <FileRow key={f.path} f={f} />
        ))}
      </div>
    );
  };

  return (
    <div className="git-panel">
      <div className="tw-header git-head">
        <button
          className="git-branch-btn"
          onClick={() => setBranchMenu((o) => !o)}
          title="Switch / manage branches"
          aria-haspopup="menu"
          aria-expanded={branchMenu}
        >
          <IconBranch size={15} />
          <span className="git-branch-name">{status?.branch ?? (status?.detached ? 'detached' : '—')}</span>
          {!!status?.ahead && <span className="git-ab up" title={`${status.ahead} commit(s) ahead of upstream`}>↑{status.ahead}</span>}
          {!!status?.behind && <span className="git-ab down" title={`${status.behind} commit(s) behind upstream`}>↓{status.behind}</span>}
          <IconChevronDown size={13} className="git-branch-caret" />
        </button>
        <div className="tw-actions git-sync">
          <button className="icon-btn" title="Fetch" disabled={busy} onClick={() => act(gitFetch)}>
            <IconRefresh size={15} />
          </button>
          <button className="icon-btn" title="Pull" disabled={busy} onClick={() => act(gitPull)}>
            <IconArrowDown size={15} />
          </button>
          <button
            className="icon-btn"
            title={status?.upstream == null ? 'Push (publish branch)' : 'Push'}
            disabled={busy}
            onClick={() => act(() => gitPush(status?.upstream == null))}
          >
            <IconArrowUp size={15} />
          </button>
        </div>
        {branchMenu && (
          <>
            <div className="menu-overlay" onClick={() => setBranchMenu(false)} />
            <div className="branch-menu-pop">
              <BranchMenu onClose={() => setBranchMenu(false)} />
            </div>
          </>
        )}
      </div>

      <div className="git-tabs">
        <div className="git-seg" role="tablist" aria-label="Version control view">
          <button
            role="tab"
            aria-selected={tab === 'changes'}
            className={'git-seg-btn' + (tab === 'changes' ? ' active' : '')}
            onClick={() => setTab('changes')}
          >
            Changes
            {files.length > 0 && <span className="git-seg-count">{files.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'log'}
            className={'git-seg-btn' + (tab === 'log' ? ' active' : '')}
            onClick={() => setTab('log')}
          >
            Log
          </button>
        </div>
        <button className="icon-btn" title="Refresh" disabled={busy} onClick={refresh}>
          <IconRefresh size={15} />
        </button>
      </div>

      {error && <div className="git-error">{error}</div>}

      {tab === 'changes' ? (
        <>
          <div className="git-changes">
            {files.length === 0 && (
              <div className="git-clean">
                <IconCheck size={22} />
                <span>Nothing to commit — working tree clean.</span>
              </div>
            )}

            {conflicts.length > 0 && (
              <div className="git-group">
                <div className="git-group-head">
                  <span className="conflict">
                    Merge Conflicts <span className="git-count">{conflicts.length}</span>
                  </span>
                </div>
                {conflicts.map((f) => (
                  <div key={'c:' + f.path} className="git-file conflict" onClick={() => openDiff(f)} title={f.path}>
                    <span className="git-badge u">U</span>
                    <FileIcon name={baseOf(f.path)} />
                    <span className="git-file-name">{baseOf(f.path)}</span>
                    <span className="git-file-dir">{dirOf(f.path)}</span>
                    <span className="git-file-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="link" title="3-way merge editor" onClick={() => openMerge(f.path)}>
                        Merge
                      </button>
                      <button className="link" title="Take current branch's version" onClick={() => act(() => gitResolve(f.path, 'ours'))}>
                        Ours
                      </button>
                      <button className="link" title="Take incoming version" onClick={() => act(() => gitResolve(f.path, 'theirs'))}>
                        Theirs
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Group title="Changes" list={changes} />
            <Group title="Unversioned Files" list={untracked} />
          </div>

          <div className="git-commit">
            <textarea
              value={message}
              placeholder="Commit message  (Ctrl/Cmd+Enter)"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  (e.metaKey || e.ctrlKey) &&
                  !(busy || !message.trim() || selectedCount === 0 || conflicts.length > 0)
                )
                  commit();
              }}
            />
            <div className="git-commit-actions">
              <span className="muted">{selectedCount} selected</span>
              <button
                className="primary"
                disabled={busy || !message.trim() || selectedCount === 0 || conflicts.length > 0}
                onClick={commit}
              >
                Commit
              </button>
            </div>
            {conflicts.length > 0 && <div className="git-hint">Resolve conflicts before committing.</div>}
          </div>
        </>
      ) : (
        <div className="git-log">
          {graph.rows.map((r) => (
            <div key={r.commit.hash} className="git-commit-row" title={r.commit.hash}>
              <GraphCell row={r} lanes={graph.lanes} />
              <div className="git-commit-body">
                <div className="git-commit-subject">
                  {r.commit.refs && <span className="git-refs">{r.commit.refs.split(', ')[0]}</span>}
                  {r.commit.subject}
                </div>
                <div className="git-commit-meta">
                  <span className="git-commit-hash">{r.commit.short}</span>
                  {r.commit.author} · {new Date(r.commit.date).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          {commits.length === 0 && <div className="git-clean">No commits yet.</div>}
        </div>
      )}

      {cloning && <CloneDialog parentDefault={dirOf(projectRoot) || projectRoot} onClose={() => setCloning(false)} />}
    </div>
  );
}
