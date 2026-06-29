import { useStore } from '../store';
import { basename } from '../lib/lang';
import { FileIcon } from './FileIcon';
import { IconClose, IconSplit } from './icons';
import type { EditorGroup, EditorTab } from '../types';

const DND_MIME = 'application/x-jakide-tab';

/** The tab strip for one editor group. Tabs are draggable between groups (U4). */
export function TabBar({ group, isActiveGroup }: { group: EditorGroup; isActiveGroup: boolean }) {
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const splitGroup = useStore((s) => s.splitGroup);
  const moveTab = useStore((s) => s.moveTab);

  const onClose = (e: React.MouseEvent, t: EditorTab) => {
    e.stopPropagation();
    if (t.kind === 'file' && t.dirty && !confirm(`Discard unsaved changes to ${basename(t.path)}?`)) return;
    closeTab(t.id, group.id);
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

  return (
    <div
      className="tabbar"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {group.tabs.length === 0 && <span className="tab placeholder">No open files</span>}
      {group.tabs.map((t) => {
        const active = isActiveGroup && t.id === group.activeTabId;
        const label = t.kind === 'file' ? basename(t.path) : t.title;
        return (
          <div
            key={t.id}
            className={'tab' + (active ? ' active' : '') + (t.id === group.activeTabId ? ' current' : '')}
            onMouseDown={() => setActiveTab(group.id, t.id)}
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
              onClick={(e) => onClose(e, t)}
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
    </div>
  );
}
