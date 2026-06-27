import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  gitStatus,
  gitBranches,
  gitLog,
  gitDiffApi,
  gitStage,
  gitStageAll,
  gitUnstage,
  gitUnstageAll,
  gitDiscard,
  gitCommit,
  gitInit,
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitMerge,
  gitFetch,
  gitPull,
  gitPush,
  gitResolve,
} from '../api';
import type { GitStatus, GitBranches, GitCommit, GitFileEntry } from '../types';
import { FileIcon } from './FileIcon';
import { CloneDialog } from './CloneDialog';
import {
  IconBranch,
  IconRefresh,
  IconArrowUp,
  IconArrowDown,
  IconPlus,
  IconCheck,
  IconTrash,
} from './icons';

const dirOf = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};
const baseOf = (p: string) => p.split('/').pop() ?? p;

function statusOf(f: GitFileEntry, group: 'staged' | 'work'): { letter: string; cls: string } {
  if (f.conflicted) return { letter: 'U', cls: 'u' };
  if (f.index === '?') return { letter: '?', cls: 'q' };
  const l = group === 'staged' ? f.index : f.work;
  const cls = l === 'A' ? 'a' : l === 'D' ? 'd' : l === 'R' || l === 'C' ? 'r' : 'm';
  return { letter: l, cls };
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
  let lanes: (string | null)[] = [];
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

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [tab, setTab] = useState<'changes' | 'log'>('changes');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchMenu, setBranchMenu] = useState(false);
  const [cloning, setCloning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const st = await gitStatus();
      setStatus(st);
      setGit({ repo: st.repo, branch: st.branch, ahead: st.ahead, behind: st.behind, changed: st.files.length });
      setGitFiles(st.files);
      if (st.repo) {
        setBranches(await gitBranches());
        setCommits(await gitLog(80));
      } else {
        setBranches(null);
        setCommits([]);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setGit, setGitFiles]);

  useEffect(() => {
    refresh();
  }, [refresh, projectRoot]);

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

  const openDiff = async (f: GitFileEntry, mode: 'working' | 'staged') => {
    try {
      openGitDiff(await gitDiffApi(f.path, mode));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const commit = () =>
    act(async () => {
      await gitCommit(message.trim());
      setMessage('');
    });

  const newBranch = () => {
    const name = prompt('New branch name:');
    setBranchMenu(false);
    if (name && name.trim()) act(() => gitCreateBranch(name.trim(), true));
  };

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
          <p>This project is not under version control.</p>
          <button className="primary" disabled={busy} onClick={() => act(gitInit)}>
            Initialize Repository
          </button>
          <button disabled={busy} onClick={() => setCloning(true)}>
            Clone Repository…
          </button>
          {error && <div className="git-error">{error}</div>}
        </div>
        {cloning && <CloneDialog parentDefault={dirOf(projectRoot) || projectRoot} onClose={() => setCloning(false)} />}
      </div>
    );
  }

  const files = status?.files ?? [];
  const conflicts = files.filter((f) => f.conflicted);
  const staged = files.filter((f) => !f.conflicted && f.index !== '.' && f.index !== '?');
  const unstaged = files.filter((f) => !f.conflicted && f.index !== '?' && f.work !== '.');
  const untracked = files.filter((f) => f.index === '?');

  const FileRow = ({ f, group }: { f: GitFileEntry; group: 'staged' | 'work' }) => {
    const s = statusOf(f, group);
    const mode = group === 'staged' ? 'staged' : 'working';
    return (
      <div className="git-file" onClick={() => openDiff(f, mode)} title={f.path}>
        <span className={'git-badge ' + s.cls}>{s.letter}</span>
        <FileIcon name={baseOf(f.path)} />
        <span className="git-file-name">{baseOf(f.path)}</span>
        <span className="git-file-dir">{dirOf(f.path)}</span>
        <span className="git-file-actions" onClick={(e) => e.stopPropagation()}>
          {group === 'staged' ? (
            <button className="icon-btn xs" title="Unstage" onClick={() => act(() => gitUnstage([f.path]))}>
              <IconArrowDown size={14} />
            </button>
          ) : (
            <>
              <button className="icon-btn xs" title="Stage" onClick={() => act(() => gitStage([f.path]))}>
                <IconPlus size={14} />
              </button>
              {f.index !== '?' && (
                <button
                  className="icon-btn xs danger"
                  title="Discard changes"
                  onClick={() => confirm(`Discard changes to ${f.path}?`) && act(() => gitDiscard([f.path]))}
                >
                  <IconTrash size={13} />
                </button>
              )}
            </>
          )}
        </span>
      </div>
    );
  };

  const Group = ({
    title,
    list,
    group,
    onAll,
    allLabel,
  }: {
    title: string;
    list: GitFileEntry[];
    group: 'staged' | 'work';
    onAll?: () => void;
    allLabel?: string;
  }) =>
    list.length === 0 ? null : (
      <div className="git-group">
        <div className="git-group-head">
          <span>
            {title} <span className="muted">{list.length}</span>
          </span>
          {onAll && (
            <button className="link" onClick={onAll}>
              {allLabel}
            </button>
          )}
        </div>
        {list.map((f) => (
          <FileRow key={group + ':' + f.path} f={f} group={group} />
        ))}
      </div>
    );

  return (
    <div className="git-panel">
      <div className="tw-header git-head">
        <button className="git-branch-btn" onClick={() => setBranchMenu((o) => !o)} title="Branches">
          <IconBranch size={15} />
          <span className="git-branch-name">{status?.branch ?? (status?.detached ? 'detached' : '—')}</span>
          {!!status?.ahead && <span className="git-ab">↑{status.ahead}</span>}
          {!!status?.behind && <span className="git-ab">↓{status.behind}</span>}
        </button>
        <div className="tw-actions">
          <button className="icon-btn" title="Fetch" disabled={busy} onClick={() => act(gitFetch)}>
            <IconRefresh size={15} />
          </button>
          <button className="icon-btn" title="Pull" disabled={busy} onClick={() => act(gitPull)}>
            <IconArrowDown size={15} />
          </button>
          <button className="icon-btn" title="Push" disabled={busy} onClick={() => act(() => gitPush())}>
            <IconArrowUp size={15} />
          </button>
        </div>

        {branchMenu && branches && (
          <>
            <div className="menu-overlay" onClick={() => setBranchMenu(false)} />
            <div className="git-branch-menu" role="menu">
              <div className="proj-menu-label">Branches</div>
              {branches.local.map((b) => (
                <div key={b.name} className={'git-branch-row' + (b.current ? ' current' : '')}>
                  <button
                    className="git-branch-pick"
                    disabled={busy}
                    onClick={() => {
                      setBranchMenu(false);
                      if (!b.current) act(() => gitCheckout(b.name));
                    }}
                  >
                    <span className="git-branch-check">{b.current ? <IconCheck size={14} /> : null}</span>
                    {b.name}
                  </button>
                  {!b.current && (
                    <span className="git-branch-row-actions">
                      <button
                        className="icon-btn xs"
                        title={`Merge ${b.name} into current`}
                        onClick={() => {
                          setBranchMenu(false);
                          act(() => gitMerge(b.name));
                        }}
                      >
                        <IconBranch size={13} />
                      </button>
                      <button
                        className="icon-btn xs danger"
                        title={`Delete ${b.name}`}
                        onClick={() => {
                          if (confirm(`Delete branch ${b.name}?`)) {
                            setBranchMenu(false);
                            act(() => gitDeleteBranch(b.name, false).catch(() => gitDeleteBranch(b.name, true)));
                          }
                        }}
                      >
                        <IconTrash size={13} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
              <div className="proj-menu-sep" />
              <button className="proj-menu-item" onClick={newBranch}>
                <IconPlus size={15} />
                <span className="proj-menu-item-name">New Branch…</span>
              </button>
            </div>
          </>
        )}
      </div>

      <div className="git-tabs">
        <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
          Changes
        </button>
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          Log
        </button>
        <button className="icon-btn" title="Refresh" disabled={busy} onClick={refresh} style={{ marginLeft: 'auto' }}>
          <IconRefresh size={15} />
        </button>
      </div>

      {error && <div className="git-error">{error}</div>}

      {tab === 'changes' ? (
        <>
          <div className="git-changes">
            {files.length === 0 && <div className="git-clean">Nothing to commit — working tree clean.</div>}

            {conflicts.length > 0 && (
              <div className="git-group">
                <div className="git-group-head">
                  <span className="conflict">
                    Merge Conflicts <span className="muted">{conflicts.length}</span>
                  </span>
                </div>
                {conflicts.map((f) => (
                  <div key={'c:' + f.path} className="git-file conflict" onClick={() => openDiff(f, 'working')} title={f.path}>
                    <span className="git-badge u">U</span>
                    <FileIcon name={baseOf(f.path)} />
                    <span className="git-file-name">{baseOf(f.path)}</span>
                    <span className="git-file-dir">{dirOf(f.path)}</span>
                    <span className="git-file-actions" onClick={(e) => e.stopPropagation()}>
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

            <Group title="Staged" list={staged} group="staged" onAll={() => act(gitUnstageAll)} allLabel="Unstage all" />
            <Group title="Changes" list={unstaged} group="work" onAll={() => act(gitStageAll)} allLabel="Stage all" />
            <Group title="Untracked" list={untracked} group="work" onAll={() => act(() => gitStage(untracked.map((f) => f.path)))} allLabel="Add all" />
          </div>

          <div className="git-commit">
            <textarea
              value={message}
              placeholder="Commit message  (Ctrl/Cmd+Enter)"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
              }}
            />
            <div className="git-commit-actions">
              <span className="muted">{staged.length} staged</span>
              <button className="primary" disabled={busy || !message.trim() || staged.length === 0} onClick={commit}>
                Commit
              </button>
            </div>
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
