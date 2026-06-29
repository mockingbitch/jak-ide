import { useEffect, useState } from 'react';
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react';
import { useStore } from '../../store';
import { saveFile, deleteFileApi } from '../../api';
import { langFor, basename } from '../../lib/lang';
import { beforeMountTheme } from '../../lib/monacoSetup';
import { registerEditor, unregisterEditor } from '../../lib/editorRegistry';
import { MarkdownPreview } from '../MarkdownPreview';
import { FileIcon } from '../FileIcon';
import { IconChevronRight } from '../icons';
import type { FileTab } from '../../types';

type MdView = 'edit' | 'split' | 'preview';
// Remember the markdown view per path across tab switches (FileEditorTab remounts
// when you switch away to a non-file tab).
const mdMemory = new Map<string, MdView>();

/** Path breadcrumb shown under the tab bar (folders › … › file). */
function Breadcrumbs({ path }: { path: string }) {
  const segs = path.split('/').filter(Boolean);
  return (
    <div className="breadcrumbs">
      {segs.map((seg, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {i > 0 && (
            <span className="crumb-sep">
              <IconChevronRight size={13} />
            </span>
          )}
          <span className={'crumb' + (i === segs.length - 1 ? ' file' : '')}>
            {i === segs.length - 1 && <FileIcon name={seg} />}
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The Monaco editor for a file tab, plus the AI-change review bar and markdown split. */
export function FileEditorTab({ tab, groupId }: { tab: FileTab; groupId: string }) {
  const theme = useStore((s) => s.theme);
  const setContent = useStore((s) => s.setContent);
  const setSelection = useStore((s) => s.setSelection);
  const setCursor = useStore((s) => s.setCursor);
  const setActiveGroup = useStore((s) => s.setActiveGroup);
  const changes = useStore((s) => s.changes);
  const clearChange = useStore((s) => s.clearChange);
  const refreshTab = useStore((s) => s.refreshTab);
  const closeTab = useStore((s) => s.closeTab);

  const change = changes[tab.path];
  const ext = tab.path.split('.').pop()?.toLowerCase();
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const [mdView, setMdViewState] = useState<MdView>(() => mdMemory.get(tab.path) ?? 'split');
  const setMdView = (v: MdView) => {
    mdMemory.set(tab.path, v);
    setMdViewState(v);
  };

  // Re-sync the remembered md view when the active file tab changes (no remount on file→file).
  useEffect(() => {
    setMdViewState(mdMemory.get(tab.path) ?? 'split');
  }, [tab.path]);

  useEffect(() => () => unregisterEditor(groupId), [groupId]);

  const revertChange = async () => {
    if (!change) return;
    try {
      if (change.created) {
        await deleteFileApi(tab.path);
        closeTab(tab.path);
      } else {
        await saveFile(tab.path, change.before);
        refreshTab(tab.path, change.before);
      }
      clearChange(tab.path);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onMount: OnMount = (editor, m) => {
    m.editor.setTheme('jakide');
    registerEditor(groupId, editor);
    editor.onDidFocusEditorWidget(() => setActiveGroup(groupId));
    editor.onDidChangeCursorSelection((ev) => {
      const model = editor.getModel();
      const sel = ev.selection;
      setCursor({ line: sel.positionLineNumber, col: sel.positionColumn });
      if (!model || sel.isEmpty()) {
        setSelection(null);
        return;
      }
      setSelection({ text: model.getValueInRange(sel), startLine: sel.startLineNumber, endLine: sel.endLineNumber });
    });
  };

  const editorOptions = {
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    minimap: { enabled: !isMarkdown },
    automaticLayout: true,
    tabSize: 2,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection' as const,
  };

  const codeEditor = (
    <Editor
      path={tab.path}
      language={langFor(tab.path)}
      value={tab.content}
      theme="jakide"
      keepCurrentModel /* a file can be open in two groups; never let unmount dispose the shared model — useEditorChrome GCs by cross-group refcount */
      beforeMount={beforeMountTheme}
      onMount={onMount}
      onChange={(v) => setContent(tab.path, v ?? '')}
      options={editorOptions}
    />
  );

  return (
    <>
      <Breadcrumbs path={tab.path} />
      {change && (
        <div className="diff-bar">
          <span>
            ✦ AI changed <b>{basename(tab.path)}</b> — review the diff
          </span>
          <span className="diff-btns">
            <button onClick={() => clearChange(tab.path)}>Keep</button>
            <button className="danger" onClick={revertChange}>
              Revert
            </button>
          </span>
        </div>
      )}
      {!change && isMarkdown && (
        <div className="editor-toolbar">
          <div className="view-toggle">
            {(['edit', 'split', 'preview'] as const).map((v) => (
              <button key={v} className={mdView === v ? 'active' : ''} onClick={() => setMdView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="monaco-wrap">
        {change ? (
          <DiffEditor
            key={tab.path}
            original={change.before}
            modified={tab.content}
            language={langFor(tab.path)}
            theme="jakide"
            beforeMount={beforeMountTheme}
            onMount={(_e, m) => m.editor.setTheme('jakide')}
            options={{
              readOnly: true,
              renderSideBySide: false,
              fontSize: theme.fontSize,
              fontFamily: theme.fontFamily,
              automaticLayout: true,
              minimap: { enabled: false },
            }}
          />
        ) : isMarkdown ? (
          <div className="md-area">
            {mdView !== 'preview' && <div className="md-pane">{codeEditor}</div>}
            {mdView === 'split' && <div className="md-divider" />}
            {mdView !== 'edit' && (
              <div className="md-pane md-scroll">
                <MarkdownPreview content={tab.content} />
              </div>
            )}
          </div>
        ) : (
          codeEditor
        )}
      </div>
    </>
  );
}
