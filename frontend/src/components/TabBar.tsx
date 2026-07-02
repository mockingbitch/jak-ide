import { useState } from 'react';
import { useStore } from '../store';
import { basename } from '../lib/lang';
import { FileIcon } from './FileIcon';
import { IconClose, IconSplit } from './icons';
import type { EditorGroup } from '../types';

const DND_MIME = 'application/x-jakide-tab';

interface TabMenu {
  x: number;
  y: number;
  tabId: string;
  index: number;
}

/** The tab strip for one editor group. Tabs are draggable between groups (U4) and
 *  have a right-click menu: Close / Close Others / Close to the Right / Close All. */
export function TabBar({ group, isActiveGroup }: { group: EditorGroup; isActiveGroup: boolean }) {
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeMany = useStore((s) => s.closeMany);
  const splitGroup = useStore((s) => s.splitGroup);
  const moveTab = useStore((s) => s.moveTab);
  const [menu, setMenu] = useState<TabMenu | null>(null);

  // Close the given tab ids, confirming once if any hold unsaved edits.
  const close = (ids: string[]) => {
    if (ids.length === 0) return;
    const kill = new Set(ids);
    const dirty = group.tabs.filter((t) => kill.has(t.id) && t.kind === 'file' && t.dirty);
    if (dirty.length > 0) {
      const msg =
        dirty.length === 1
          ? `Discard unsaved changes to ${basename(dirty[0].path)}?`
          : `Discard unsaved changes to ${dirty.length} file(s)?`;
      if (!confirm(msg)) return;
    }
    closeMany(ids, group.id);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    try {
      const { tabId, fromGroupId } = JSON.parse(raw) as { tabId: string; fromGroupId: string };
      moveTab(tabId, fromGroupId, group.id);
    } catch {
      /* ignore malformed payload */
    }
  };

  const act = (fn: () => void) => {
    setMenu(null);
    fn();
  };
  const otherIds = (tabId: string) => group.tabs.filter((t) => t.id !== tabId).map((t) => t.id);
  const rightIds = (index: number) => group.tabs.slice(index + 1).map((t) => t.id);
  const allIds = () => group.tabs.map((t) => t.id);

  return (
    <div className="tabbar" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {group.tabs.length === 0 && <span className="tab placeholder">No open files</span>}
      {group.tabs.map((t, i) => {
        const active = isActiveGroup && t.id === group.activeTabId;
        const label = t.kind === 'file' ? basename(t.path) : t.title;
        return (
          <div
            key={t.id}
            className={'tab' + (active ? ' active' : '') + (t.id === group.activeTabId ? ' current' : '')}
            onMouseDown={() => setActiveTab(group.id, t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setActiveTab(group.id, t.id);
              setMenu({ x: e.clientX, y: e.clientY, tabId: t.id, index: i });
            }}
            title={t.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MIME, JSON.stringify({ tabId: t.id, fromGroupId: group.id }));
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            <FileIcon name={basename(t.path)} />
            <span className="tab-name">{label}</span>
            <span className="tab-dirty">{t.kind === 'file' && t.dirty ? '●' : ''}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${label}`}
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                close([t.id]);
              }}
            >
              <IconClose size={13} />
            </button>
          </div>
        );
      })}
      <span className="tabbar-spacer" />
      <button
        type="button"
        className="icon-btn tabbar-split"
        title="Split editor right"
        aria-label="Split editor right"
        onClick={splitGroup}
      >
        <IconSplit size={15} />
      </button>

      {menu && (
        <>
          <div
            className="menu-overlay"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => act(() => close([menu.tabId]))}>Close</button>
            <button disabled={group.tabs.length <= 1} onClick={() => act(() => close(otherIds(menu.tabId)))}>
              Close Others
            </button>
            <button disabled={menu.index >= group.tabs.length - 1} onClick={() => act(() => close(rightIds(menu.index)))}>
              Close to the Right
            </button>
            <div className="ctx-sep" />
            <button onClick={() => act(() => close(allIds()))}>Close All</button>
          </div>
        </>
      )}
    </div>
  );
}
