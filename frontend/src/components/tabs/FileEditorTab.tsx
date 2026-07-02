import { useEffect, useState } from 'react';
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { useStore } from '../../store';
import { useGitViewStore } from '../../lib/gitViewStore';
import { useGitAnnotate } from '../../hooks/useGitAnnotate';
import { useCurrentLineBlame } from '../../hooks/useCurrentLineBlame';
import { useImplementations } from '../../hooks/useImplementations';
import { saveFile, deleteFileApi, gitLog } from '../../api';
import { langFor, basename } from '../../lib/lang';
import { beforeMountTheme, LINE_NUMBERS_MIN_CHARS, OVERFLOW_WIDGETS_OPTIONS } from '../../lib/monacoSetup';
import { registerEditor, unregisterEditor } from '../../lib/editorRegistry';
import { MarkdownPreview } from '../MarkdownPreview';
import { FileIcon } from '../FileIcon';
import { IconChevronRight, IconAnnotate, IconHistory } from '../icons';
import type { FileTab } from '../../types';

type MdView = 'edit' | 'split' | 'preview';
// Remember the markdown view per path across tab switches (FileEditorTab remounts
// when you switch away to a non-file tab).
const mdMemory = new Map<string, MdView>();

/** Path breadcrumb shown under the tab bar (folders › … › file), plus the
 *  markdown view-toggle / git Annotate & History actions on the same line
 *  (the path scrolls independently so the actions never get pushed off). */
function Breadcrumbs({ path, actions }: { path: string; actions?: React.ReactNode }) {
  const segs = path.split('/').filter(Boolean);
  return (
    <div className="breadcrumbs">
      <div className="crumb-list">
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
      {actions && <div className="breadcrumb-actions">{actions}</div>}
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

  const repo = useStore((s) => s.git.repo);
  const openGitHistory = useStore((s) => s.openGitHistory);
  const annotated = useGitViewStore((s) => s.annotated.has(tab.path));
  const toggleAnnotate = useGitViewStore((s) => s.toggleAnnotate);

  // The live editor instance for this tab (set on mount) — drives inline blame.
  const [ed, setEd] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null);

  const change = changes[tab.path];
  const ext = tab.path.split('.').pop()?.toLowerCase();
  const isMarkdown = ext === 'md' || ext === 'markdown';

  // Inline git annotation (PhpStorm "Annotate"), disabled while the AI-change diff shows.
  useGitAnnotate(ed, tab.path, repo && annotated && !change);
  // GitLens-style current-line blame, right in the code — off when the full-file
  // annotate column is on (redundant then) or while the AI-change diff shows.
  useCurrentLineBlame(change ? null : ed, tab.path, repo && !annotated);
  // PhpStorm-style "implemented by" gutter markers on interface/class declarations.
  useImplementations(change ? null : ed, tab.path);

  const showHistory = async () => {
    try {
      openGitHistory({ path: tab.path, commits: await gitLog(100, 0, tab.path) });
    } catch (e) {
      alert((e as Error).message);
    }
  };
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
    setEd(editor);
    // PhpStorm gesture: right-click in the editor → toggle the inline blame gutter.
    editor.addAction({
      id: 'jakide.toggleGitBlame',
      label: 'Annotate with Git Blame',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.6,
      run: (edi) => {
        const p = edi.getModel()?.uri.path.replace(/^\/+/, '');
        if (p) useGitViewStore.getState().toggleAnnotate(p);
      },
    });
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
    ...OVERFLOW_WIDGETS_OPTIONS,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    minimap: { enabled: !isMarkdown },
    automaticLayout: true,
    tabSize: 2,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection' as const,
    glyphMargin: true, // hosts the "implemented by" gutter markers (useImplementations)
    lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS, // narrower gutter (~20px instead of Monaco's 40px default)
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

  const toolbarActions = !change && (isMarkdown || repo) && (
    <>
      {isMarkdown && (
        <div className="view-toggle">
          {(['edit', 'split', 'preview'] as const).map((v) => (
            <button key={v} className={mdView === v ? 'active' : ''} onClick={() => setMdView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      )}
      {repo && (
        <div className="editor-git-actions">
          <button
            className={'ed-git-btn' + (annotated ? ' active' : '')}
            title="Annotate with Git Blame — inline per-line author/date"
            aria-pressed={annotated}
            onClick={() => toggleAnnotate(tab.path)}
          >
            <IconAnnotate size={15} />
            Annotate
          </button>
          <button className="ed-git-btn" title="Show file history" onClick={showHistory}>
            <IconHistory size={15} />
            History
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <Breadcrumbs path={tab.path} actions={toolbarActions} />
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
              ...OVERFLOW_WIDGETS_OPTIONS,
              readOnly: true,
              renderSideBySide: false,
              fontSize: theme.fontSize,
              fontFamily: theme.fontFamily,
              automaticLayout: true,
              minimap: { enabled: false },
              lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS,
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
