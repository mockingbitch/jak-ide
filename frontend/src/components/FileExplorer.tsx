import { useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode, GitFileEntry } from '../types';
import { useStore, activeFileTab } from '../store';
import { useGitViewStore } from '../lib/gitViewStore';
import { getTree, getFile, gitLog, gitDiffApi } from '../api';
import { flattenTree, topLevelDirs, ancestorDirs } from '../lib/fileTree';
import { useFileOps } from '../hooks/useFileOps';
import { FileIcon } from './FileIcon';
import { IconPlus, IconRefresh, IconChevronRight, IconChevronDown, IconFolderOpen } from './icons';

const ROW_H = 24; // fixed row height — the virtualizer maps scroll offset → row index
const OVERSCAN = 8;
const dirOf = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};

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

/** Inline rename field. Commits once (Enter or blur), cancels on Escape. */
function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const done = useRef(false);
  const commit = (v: string) => {
    if (done.current) return;
    done.current = true;
    onCommit(v);
  };
  return (
    <input
      className="tree-rename"
      defaultValue={initial}
      autoFocus
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  );
}

export function FileExplorer() {
  const tree = useStore((s) => s.tree);
  const setTree = useStore((s) => s.setTree);
  const openTab = useStore((s) => s.openTab);
  const activePath = useStore((s) => activeFileTab(s)?.path ?? null);
  const gitFiles = useStore((s) => s.gitFiles);
  const repo = useStore((s) => s.git.repo);
  const openGitDiff = useStore((s) => s.openGitDiff);
  const openGitHistory = useStore((s) => s.openGitHistory);
  const setAnnotate = useGitViewStore((s) => s.setAnnotate);

  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const seeded = useRef(false);
  const revealedFor = useRef<string | null>(null); // last activePath we auto-scrolled to

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);

  const refresh = () => getTree().then(setTree).catch((e) => console.error(e));
  const ops = useFileOps(refresh);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tree) {
      seeded.current = false;
      return;
    }
    if (!seeded.current) {
      setExpanded(topLevelDirs(tree));
      seeded.current = true;
    }
  }, [tree]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

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

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  // Auto-reveal the active file: expand its ancestor dirs so the row exists…
  useEffect(() => {
    if (!activePath) return;
    const anc = ancestorDirs(activePath);
    if (anc.length === 0) return;
    setExpanded((prev) => {
      let next: Set<string> | null = null;
      for (const d of anc)
        if (!prev.has(d)) (next ??= new Set(prev)).add(d);
      return next ?? prev; // no-op set skips the re-render when already expanded
    });
  }, [activePath]);

  // …then scroll it into view once the tree reflects the expansion. Keyed on the
  // active path (via revealedFor) so a manual scroll or unrelated expand/collapse
  // doesn't yank the view back to the active file.
  useEffect(() => {
    if (!activePath || revealedFor.current === activePath) return;
    const idx = rows.findIndex((r) => r.node.path === activePath);
    if (idx === -1) return; // ancestors not expanded yet — wait for rows to update
    revealedFor.current = activePath;
    const el = scrollRef.current;
    if (!el) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top; // above the viewport → align to top
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [activePath, rows]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const openFile = async (path: string): Promise<boolean> => {
    try {
      const f = await getFile(path);
      openTab({ path: f.path, content: f.content, dirty: false });
      return true;
    } catch (e) {
      alert((e as Error).message);
      return false;
    }
  };

  const showHistory = async (p: string) => {
    try {
      openGitHistory({ path: p, commits: await gitLog(100, 0, p) });
    } catch (e) {
      alert((e as Error).message);
    }
  };
  // Open the file and turn on the inline blame gutter (PhpStorm "Annotate").
  const annotate = async (p: string) => {
    if (await openFile(p)) setAnnotate(p, true);
  };
  const showDiff = async (p: string) => {
    try {
      openGitDiff(await gitDiffApi(p, 'working'));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  const act = (fn: () => void) => {
    setMenu(null);
    fn();
  };
  const ctxDir = menu ? (menu.node.type === 'dir' ? menu.node.path : dirOf(menu.node.path)) : '';

  return (
    <div className="explorer">
      <div className="tw-header">
        <span className="tw-title">Project</span>
        <div className="tw-actions">
          <button className="icon-btn" title="New file" onClick={() => ops.newFile('')}>
            <IconPlus size={16} />
          </button>
          <button className="icon-btn" title="New folder" onClick={() => ops.newFolder('')}>
            <IconFolderOpen size={15} />
          </button>
          <button className="icon-btn" title="Refresh" onClick={refresh}>
            <IconRefresh size={15} />
          </button>
        </div>
      </div>

      <div className="tree" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {tree && rows.length === 0 && <div className="empty-tree">Empty project.</div>}
        <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
          {visible.map(({ node, depth }, i) => {
            const top = (start + i) * ROW_H;
            const style = { position: 'absolute' as const, top, left: 0, right: 0, height: ROW_H, paddingLeft: 8 + depth * 12 };
            const onContext = (e: React.MouseEvent) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, node });
            };
            const dragProps = {
              draggable: renaming !== node.path,
              onDragStart: (e: React.DragEvent) => e.dataTransfer.setData('text/plain', node.path),
              onDragOver: node.type === 'dir' ? (e: React.DragEvent) => e.preventDefault() : undefined,
              onDrop:
                node.type === 'dir'
                  ? (e: React.DragEvent) => {
                      e.preventDefault();
                      const src = e.dataTransfer.getData('text/plain');
                      if (src) ops.move(src, node.path);
                    }
                  : undefined,
            };
            const nameEl =
              renaming === node.path ? (
                <RenameInput
                  initial={node.name}
                  onCommit={(v) => {
                    setRenaming(null);
                    ops.rename(node.path, v);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : null;

            if (node.type === 'dir') {
              const isOpen = expanded.has(node.path);
              const changed = changedDirs.has(node.path);
              return (
                <div key={node.path} className="row dir" style={style} onClick={() => toggle(node.path)} onContextMenu={onContext} {...dragProps}>
                  <span className="caret">{isOpen ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
                  <FileIcon dir open={isOpen} name={node.name} />
                  {nameEl ?? <span className={'row-name' + (changed ? ' git-dir-changed' : '')}>{node.name}</span>}
                  {!nameEl && changed && <span className="row-git-dot" />}
                </div>
              );
            }
            const stt = statusMap.get(node.path);
            return (
              <div
                key={node.path}
                className={'row file' + (activePath === node.path ? ' active' : '')}
                style={style}
                onClick={() => openFile(node.path)}
                onContextMenu={onContext}
                {...dragProps}
              >
                <span className="caret" />
                <FileIcon name={node.name} />
                {nameEl ?? <span className={'row-name' + (stt ? ' git-' + stt.cls : '')}>{node.name}</span>}
                {!nameEl && stt && <span className={'row-git git-badge ' + stt.cls}>{stt.letter}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {menu && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => act(() => ops.newFile(ctxDir))}>New File…</button>
            <button onClick={() => act(() => ops.newFolder(ctxDir))}>New Folder…</button>
            <div className="ctx-sep" />
            <button onClick={() => act(() => setRenaming(menu.node.path))}>Rename…</button>
            <button onClick={() => act(() => ops.setClipboard({ path: menu.node.path, op: 'cut' }))}>Cut</button>
            <button onClick={() => act(() => ops.setClipboard({ path: menu.node.path, op: 'copy' }))}>Copy</button>
            {ops.clipboard && menu.node.type === 'dir' && (
              <button onClick={() => act(() => ops.paste(menu.node.path))}>Paste</button>
            )}
            {repo && menu.node.type === 'file' && (
              <>
                <div className="ctx-sep" />
                <button onClick={() => act(() => showDiff(menu.node.path))}>Show Diff</button>
                <button onClick={() => act(() => showHistory(menu.node.path))}>Show History</button>
                <button onClick={() => act(() => annotate(menu.node.path))}>Annotate with Git Blame</button>
              </>
            )}
            <div className="ctx-sep" />
            <button className="danger" onClick={() => act(() => ops.del(menu.node.path))}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
