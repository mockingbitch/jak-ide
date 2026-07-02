import { useEffect } from 'react';
import { useMonaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { gitBlame } from '../api';
import { annotationRows } from '../lib/gitAnnotate';

/** Apply PhpStorm-style inline git-blame annotations to `ed` while `enabled`.
 *  Fetches blame for `path`, injects a per-line gutter column (date + author, age
 *  heat-coloured, hover = commit details), and clears it on toggle-off/unmount. */
export function useGitAnnotate(ed: editor.IStandaloneCodeEditor | null, path: string, enabled: boolean): void {
  const monaco = useMonaco();
  useEffect(() => {
    if (!ed || !monaco || !enabled) return;
    let alive = true;
    // One editor instance is reused across file→file switches (Monaco swaps the
    // model). Create the collection only after blame resolves AND the editor's model
    // still matches `path`, so we never annotate the wrong (already-swapped) buffer.
    let collection: editor.IEditorDecorationsCollection | null = null;
    const want = monaco.Uri.parse(path).toString();
    gitBlame(path)
      .then((lines) => {
        if (!alive) return;
        const model = ed.getModel();
        if (!model || model.uri.toString() !== want) return;
        const rows = annotationRows(lines);
        collection = ed.createDecorationsCollection(
          rows.map((r) => ({
            range: { startLineNumber: r.lineNumber, startColumn: 1, endLineNumber: r.lineNumber, endColumn: 1 },
            options: {
              // Injected text before column 1 → a per-line annotation column.
              before: {
                content: r.label,
                inlineClassName: `blame-inj blame-b${r.bucket}${r.uncommitted ? ' blame-uncommitted' : ''}`,
                cursorStops: monaco.editor.InjectedTextCursorStops.None, // don't trap the caret
              },
              hoverMessage: { value: r.hover },
            },
          }))
        );
      })
      .catch(() => {
        /* not a repo / file untracked — leave the editor unannotated */
      });
    return () => {
      alive = false;
      collection?.clear();
    };
  }, [ed, monaco, path, enabled]);
}
