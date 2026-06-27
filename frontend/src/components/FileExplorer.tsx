import { useEffect, useMemo, useState } from 'react';
import type { TreeNode, GitFileEntry } from '../types';
import { useStore } from '../store';
import { getTree, getFile, createFileApi, deleteFileApi, gitLog, gitBlame, gitDiffApi } from '../api';
import { FileIcon } from './FileIcon';
import { IconPlus, IconRefresh, IconChevronRight, IconChevronDown } from './icons';

/** Display status letter + colour class for a changed file. */
function statusFor(f: GitFileEntry): { letter: string; cls: string } {
  if (f.conflicted) return { letter: 'U', cls: 'u' };
  if (f.index === '?') return { letter: '?', cls: 'q' };
  const l = f.work !== '.' ? f.work : f.index;
  const cls = l === 'A' ? 'a' : l === 'D' ? 'd' : l === 'R' || l === 'C' ? 'r' : 'm';
  return { letter: l, cls };
}

interface CtxMenu {
  x: number;
  y: number;
  node: TreeNode;
}

export function FileExplorer() {
  const tree = useStore((s) => s.tree);
  const setTree = useStore((s) => s.setTree);
  const openTab = useStore((s) => s.openTab);
  const activePath = useStore((s) => s.activePath);
  const gitFiles = useStore((s) => s.gitFiles);
  const repo = useStore((s) => s.git.repo);
  const openGitDiff = useStore((s) => s.openGitDiff);
  const openGitBlame = useStore((s) => s.openGitBlame);
  const openGitHistory = useStore((s) => s.openGitHistory);

  const [menu, setMenu] = useState<CtxMenu | null>(null);

  const refresh = () => getTree().then(setTree).catch((e) => console.error(e));
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // path -> status, and the set of directories containing a change (for folder dots)
  const { statusMap, changedDirs } = useMemo(() => {
    const map = new Map<string, { letter: string; cls: string }>();
    const dirs = new Set<string>();
    for (const f of gitFiles) {
      map.set(f.path, statusFor(f));
      const parts = f.path.split('/');
      parts.pop();
      let acc = '';
      for (const p of parts) {
        acc = acc ? acc + '/' + p : p;
        dirs.add(acc);
      }
    }
    return { statusMap: map, changedDirs: dirs };
  }, [gitFiles]);

  const openFile = async (path: string) => {
    try {
      const f = await getFile(path);
      openTab({ path: f.path, content: f.content, dirty: false });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const newFile = async () => {
    const path = prompt('New file path (relative to project root):');
    if (!path) return;
    try {
      await createFileApi(path);
      await refresh();
      await openFile(path);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // ---- context-menu actions ----
  const showHistory = async (p: string) => {
    try {
      openGitHistory({ path: p, commits: await gitLog(100, 0, p) });
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const showBlame = async (p: string) => {
    try {
      openGitBlame({ path: p, lines: await gitBlame(p) });
    } catch (e) {
      alert('Blame failed: ' + (e as Error).message);
    }
  };
  const showDiff = async (p: string) => {
    try {
      openGitDiff(await gitDiffApi(p, 'working'));
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const del = async (p: string) => {
    if (!confirm('Delete ' + p + '?')) return;
    try {
      await deleteFileApi(p);
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="explorer">
      <div className="tw-header">
        <span className="tw-title">Project</span>
        <div className="tw-actions">
          <button className="icon-btn" title="New file" onClick={newFile}>
            <IconPlus size={16} />
          </button>
          <button className="icon-btn" title="Refresh" onClick={refresh}>
            <IconRefresh size={15} />
          </button>
        </div>
      </div>
      <div className="tree">
        {tree?.children?.map((c) => (
          <Node
            key={c.path}
            node={c}
            depth={0}
            onOpen={openFile}
            activePath={activePath}
            statusMap={statusMap}
            changedDirs={changedDirs}
            onContext={(e, node) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, node });
            }}
          />
        ))}
        {tree && (tree.children?.length ?? 0) === 0 && <div className="empty-tree">Empty project.</div>}
      </div>

      {menu && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            {repo && menu.node.type === 'file' && (
              <>
                <button onClick={() => { showDiff(menu.node.path); setMenu(null); }}>Show Diff</button>
                <button onClick={() => { showHistory(menu.node.path); setMenu(null); }}>Show History</button>
                <button onClick={() => { showBlame(menu.node.path); setMenu(null); }}>Annotate / Blame</button>
                <div className="ctx-sep" />
              </>
            )}
            <button className="danger" onClick={() => { del(menu.node.path); setMenu(null); }}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Node({
  node,
  depth,
  onOpen,
  activePath,
  statusMap,
  changedDirs,
  onContext,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (p: string) => void;
  activePath: string | null;
  statusMap: Map<string, { letter: string; cls: string }>;
  changedDirs: Set<string>;
  onContext: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const [openDir, setOpenDir] = useState(depth < 1);
  const pad = { paddingLeft: 8 + depth * 12 };

  if (node.type === 'dir') {
    const changed = changedDirs.has(node.path);
    return (
      <div>
        <div className="row dir" style={pad} onClick={() => setOpenDir((o) => !o)} onContextMenu={(e) => onContext(e, node)}>
          <span className="caret">{openDir ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
          <FileIcon dir open={openDir} name={node.name} />
          <span className={'row-name' + (changed ? ' git-dir-changed' : '')}>{node.name}</span>
          {changed && <span className="row-git-dot" />}
        </div>
        {openDir &&
          node.children?.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              onOpen={onOpen}
              activePath={activePath}
              statusMap={statusMap}
              changedDirs={changedDirs}
              onContext={onContext}
            />
          ))}
      </div>
    );
  }

  const st = statusMap.get(node.path);
  return (
    <div
      className={'row file' + (activePath === node.path ? ' active' : '')}
      style={pad}
      onClick={() => onOpen(node.path)}
      onContextMenu={(e) => onContext(e, node)}
    >
      <span className="caret" />
      <FileIcon name={node.name} />
      <span className={'row-name' + (st ? ' git-' + st.cls : '')}>{node.name}</span>
      {st && <span className={'row-git git-badge ' + st.cls}>{st.letter}</span>}
    </div>
  );
}
