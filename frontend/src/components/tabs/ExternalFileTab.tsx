import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { useStore } from '../../store';
import { langFor } from '../../lib/lang';
import { beforeMountTheme, LINE_NUMBERS_MIN_CHARS, OVERFLOW_WIDGETS_OPTIONS } from '../../lib/monacoSetup';
import { registerEditor, unregisterEditor } from '../../lib/editorRegistry';
import { FileIcon } from '../FileIcon';
import type { ExternalTab } from '../../types';

const base = (p: string) => p.split('/').pop() ?? p;

/** Read-only editor for a file OUTSIDE the project root — a go-to-definition target
 *  in a dependency or language-server stub. Not tracked by git or the LSP (its model
 *  uses an `ext:` scheme, which useLsp skips). Re-reveals whenever `tab.reveal` is a
 *  new object (i.e. the user re-navigates to it). */
export function ExternalFileTab({ tab, groupId }: { tab: ExternalTab; groupId: string }) {
  const theme = useStore((s) => s.theme);
  const setActiveGroup = useStore((s) => s.setActiveGroup);
  const edRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  useEffect(() => () => unregisterEditor(groupId), [groupId]);

  const revealTo = (line: number, col: number) => {
    const ed = edRef.current;
    if (!ed) return;
    const model = ed.getModel();
    const target = Math.max(1, model ? Math.min(line, model.getLineCount()) : line);
    ed.revealLineInCenter(target);
    ed.setPosition({ lineNumber: target, column: Math.max(1, col) });
    ed.focus();
  };

  // A fresh reveal object each open → re-navigate even if the tab is already open.
  useEffect(() => {
    revealTo(tab.reveal.line, tab.reveal.col);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.reveal]);

  const onMount: OnMount = (editor, m) => {
    m.editor.setTheme('jakide');
    edRef.current = editor;
    registerEditor(groupId, editor);
    editor.onDidFocusEditorWidget(() => setActiveGroup(groupId));
    revealTo(tab.reveal.line, tab.reveal.col);
  };

  return (
    <>
      <div className="breadcrumbs">
        <div className="crumb-list">
          <span className="crumb file">
            <FileIcon name={base(tab.path)} />
            {base(tab.path)}
          </span>
          <span className="ext-readonly-tag" title={tab.path}>
            read-only · external
          </span>
        </div>
      </div>
      <div className="monaco-wrap">
        <Editor
          path={'ext:' + tab.path}
          language={langFor(tab.path)}
          value={tab.content}
          theme="jakide"
          keepCurrentModel
          beforeMount={beforeMountTheme}
          onMount={onMount}
          options={{
            ...OVERFLOW_WIDGETS_OPTIONS,
            readOnly: true,
            fontSize: theme.fontSize,
            fontFamily: theme.fontFamily,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS,
          }}
        />
      </div>
    </>
  );
}
