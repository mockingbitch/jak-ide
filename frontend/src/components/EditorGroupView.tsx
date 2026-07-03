import { useStore } from '../store';
import { TabBar } from './TabBar';
import { FileEditorTab } from './tabs/FileEditorTab';
import { GitDiffTab } from './tabs/GitDiffTab';
import { HistoryTab } from './tabs/HistoryTab';
import { ExternalFileTab } from './tabs/ExternalFileTab';
import type { EditorGroup, EditorTab } from '../types';

function renderBody(tab: EditorTab, groupId: string) {
  switch (tab.kind) {
    case 'file':
      return <FileEditorTab tab={tab} groupId={groupId} />;
    case 'diff':
      return <GitDiffTab tab={tab} groupId={groupId} />;
    case 'history':
      return <HistoryTab tab={tab} groupId={groupId} />;
    case 'external':
      return <ExternalFileTab tab={tab} groupId={groupId} />;
  }
}

/** One editor group (column): its tab strip + the active tab's body. */
export function EditorGroupView({ group, isActive }: { group: EditorGroup; isActive: boolean }) {
  const setActiveGroup = useStore((s) => s.setActiveGroup);
  const active = group.tabs.find((t) => t.id === group.activeTabId) ?? null;
  return (
    <div
      className={'editor-group' + (isActive ? ' active' : '')}
      style={{ flex: `${group.size} 1 0`, minWidth: 0 }}
      onMouseDown={() => !isActive && setActiveGroup(group.id)}
    >
      <TabBar group={group} isActiveGroup={isActive} />
      {active ? (
        renderBody(active, group.id)
      ) : (
        <div className="monaco-wrap">
          <div className="editor-empty">Open a file from the Project tool window to start editing.</div>
        </div>
      )}
    </div>
  );
}
