import type { editor } from 'monaco-editor';

// Thin wrappers over Monaco's built-in editor actions. These cost nothing — Monaco
// already ships Find/Replace, Go-to-Line and a formatter hook; we only need to
// trigger them on the active editor instance (see editorRegistry).
const run = (ed: editor.IStandaloneCodeEditor | null, action: string): void => {
  ed?.focus();
  ed?.getAction(action)?.run();
};

export const gotoLine = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'editor.action.gotoLine');
export const startFind = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'actions.find');
export const startReplace = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'editor.action.startFindReplaceAction');
export const formatDocument = (ed: editor.IStandaloneCodeEditor | null) => run(ed, 'editor.action.formatDocument');
