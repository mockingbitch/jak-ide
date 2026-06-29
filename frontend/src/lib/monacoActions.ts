import type { editor } from 'monaco-editor';

// Thin wrappers over Monaco's built-in editor actions. These cost nothing — Monaco
// already ships Find/Replace, Go-to-Line and a formatter hook; we only need to
// trigger them on the active editor instance (see editorRegistry).
const run = (ed: editor.IStandaloneCodeEditor | null, action: string): void => {
  ed?.focus();
  ed?.getAction(action)?.run();
};

export const gotoLine = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'editor.action.gotoLine');

/** Reveal and place the cursor at a 1-based (line, col) in an already-open editor. */
export const revealPosition = (ed: editor.IStandaloneCodeEditor | null, line: number, col = 1): void => {
  if (!ed) return;
  const model = ed.getModel();
  const target = model ? Math.min(line, model.getLineCount()) : line;
  ed.revealLineInCenter(target);
  ed.setPosition({ lineNumber: target, column: col });
  ed.focus();
};
export const startFind = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'actions.find');
export const startReplace = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'editor.action.startFindReplaceAction');
export const formatDocument = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'editor.action.formatDocument');
