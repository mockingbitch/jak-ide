import { useEffect, useRef } from 'react';
import { useMonaco } from '@monaco-editor/react';
import { useStore, activeFile } from '../store';
import { defineJakIDETheme } from '../lib/monacoTheme';
import { saveFile } from '../api';
import { getEditor } from '../lib/editorRegistry';
import { gotoLine } from '../lib/monacoActions';
import type { EditorGroup } from '../types';

const openFilePaths = (groups: EditorGroup[]): Set<string> => {
  const set = new Set<string>();
  for (const g of groups) for (const t of g.tabs) if (t.kind === 'file') set.add(t.path);
  return set;
};

/** Editor-wide concerns that must live once at the top of the tree (not per group):
 *  apply the Monaco theme, garbage-collect text models when a file leaves every
 *  group, and host the global Save / Go-to-Line shortcuts. */
export function useEditorChrome(): void {
  const monaco = useMonaco();
  const theme = useStore((s) => s.theme);
  const groups = useStore((s) => s.groups);
  const prevPaths = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!monaco) return;
    defineJakIDETheme(monaco, theme);
    monaco.editor.setTheme('jakide');
  }, [monaco, theme]);

  // Dispose a model only once its file is open in NO group (refcount across groups),
  // so closing a split copy never blanks the editor still showing it elsewhere.
  useEffect(() => {
    const open = openFilePaths(groups);
    if (monaco) {
      for (const p of prevPaths.current) {
        if (!open.has(p)) monaco.editor.getModel(monaco.Uri.parse(p))?.dispose();
      }
    }
    prevPaths.current = open;
  }, [groups, monaco]);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        const f = activeFile();
        if (!f || !f.dirty) return;
        try {
          await saveFile(f.path, f.content);
          useStore.getState().markSaved(f.path);
          useStore.getState().bumpGitRefresh(); // saving may change git status
        } catch (err) {
          alert((err as Error).message);
        }
      } else if (key === 'g' && !e.shiftKey) {
        e.preventDefault();
        gotoLine(getEditor(useStore.getState().activeGroupId));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
