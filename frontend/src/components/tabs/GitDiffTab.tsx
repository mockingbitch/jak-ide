import { DiffEditor } from '@monaco-editor/react';
import { useStore } from '../../store';
import { langFor, basename } from '../../lib/lang';
import { beforeMountTheme } from '../../lib/monacoSetup';
import { IconClose } from '../icons';
import type { DiffTab } from '../../types';

/** Read-only side-by-side git diff for one file. */
export function GitDiffTab({ tab, groupId }: { tab: DiffTab; groupId: string }) {
  const theme = useStore((s) => s.theme);
  const closeTab = useStore((s) => s.closeTab);
  const d = tab.diff;
  return (
    <>
      <div className="git-diff-bar">
        <span>
          Git diff — <b>{basename(d.path)}</b>{' '}
          <span className="muted">{d.mode === 'staged' ? 'HEAD ↔ Index' : 'HEAD ↔ Working tree'}</span>
        </span>
        <button className="icon-btn" title="Close diff" onClick={() => closeTab(tab.id, groupId)}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="monaco-wrap">
        <DiffEditor
          key={tab.id}
          original={d.base}
          modified={d.modified}
          language={langFor(d.path)}
          theme="jakide"
          beforeMount={beforeMountTheme}
          onMount={(_e, m) => m.editor.setTheme('jakide')}
          options={{
            readOnly: true,
            renderSideBySide: true,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: theme.fontSize,
            fontFamily: theme.fontFamily,
          }}
        />
      </div>
    </>
  );
}
