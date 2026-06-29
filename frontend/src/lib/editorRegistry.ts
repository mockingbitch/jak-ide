import type { editor } from 'monaco-editor';

// Live Monaco editor instances keyed by editor-group id. Kept out of Zustand state
// (editors are not serializable and would trigger renders); a plain module map is
// enough since the store already tracks which group is active.
const editors = new Map<string, editor.IStandaloneCodeEditor>();

export const registerEditor = (groupId: string, ed: editor.IStandaloneCodeEditor): void => {
  editors.set(groupId, ed);
};
export const unregisterEditor = (groupId: string): void => {
  editors.delete(groupId);
};
export const getEditor = (groupId: string | null): editor.IStandaloneCodeEditor | null =>
  (groupId && editors.get(groupId)) || null;
