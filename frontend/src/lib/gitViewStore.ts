import { create } from 'zustand';

/** Which open files currently show the inline git annotation (blame) gutter. Kept
 *  in its own tiny store (per-path, not per-tab) so the toggle survives tab switches
 *  and can be flipped from the editor toolbar or the project-tree context menu. */
interface GitViewState {
  annotated: ReadonlySet<string>;
  toggleAnnotate: (path: string) => void;
  setAnnotate: (path: string, on: boolean) => void;
}

export const useGitViewStore = create<GitViewState>((set) => ({
  annotated: new Set(),
  toggleAnnotate: (path) =>
    set((s) => {
      const next = new Set(s.annotated);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { annotated: next };
    }),
  setAnnotate: (path, on) =>
    set((s) => {
      if (s.annotated.has(path) === on) return {}; // no-op → no re-render
      const next = new Set(s.annotated);
      if (on) next.add(path);
      else next.delete(path);
      return { annotated: next };
    }),
}));
