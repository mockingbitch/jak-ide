import { useEffect } from 'react';
import { useMonaco } from '@monaco-editor/react';
import { useStore } from '../store';
import { getEditor } from '../lib/editorRegistry';
import { openFileAndReveal, openExternalAndReveal } from '../lib/openFileAt';
import { EXTERNAL_SCHEME, isInProjectModel, relPathOf } from '../lib/lsp/modelUri';
import { useNavHistoryStore, type NavEntry } from '../lib/navHistoryStore';

/** The active editor's location as a NavEntry, or null when there is no editor or the
 *  model is neither an in-project nor an external (`ext:`) file. */
const currentEntry = (): NavEntry | null => {
  const ed = getEditor(useStore.getState().activeGroupId);
  const model = ed?.getModel();
  const pos = ed?.getPosition();
  if (!model || !pos) return null;
  if (isInProjectModel(model)) {
    return { path: relPathOf(model), external: false, line: pos.lineNumber, column: pos.column };
  }
  if (model.uri.scheme === EXTERNAL_SCHEME) {
    return { path: model.uri.path, external: true, line: pos.lineNumber, column: pos.column };
  }
  return null;
};

/** Ctrl/Cmd+Alt+Left / Ctrl/Cmd+Alt+Right — navigate back/forward through the
 *  go-to-definition jump history (see navHistoryStore; useLsp's opener pushes origins). */
export function useNavHistory(): void {
  const monaco = useMonaco();

  useEffect(() => {
    if (!monaco) return;
    const navigate = (entry: NavEntry) => {
      const nav = entry.external
        ? openExternalAndReveal(entry.path, entry.line, entry.column)
        : openFileAndReveal(monaco, entry.path, entry.line, entry.column);
      nav.catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const history = useNavHistoryStore.getState();
      const target = e.key === 'ArrowLeft' ? history.goBack(currentEntry()) : history.goForward(currentEntry());
      if (!target) return;
      e.preventDefault();
      navigate(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [monaco]);
}
