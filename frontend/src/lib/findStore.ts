import { create } from 'zustand';
import { searchText, type TextHit, type FindOpts } from '../api';

const DEFAULT_OPTS: FindOpts = { regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' };

/** Standalone store for the Find in Files tool window. Kept out of the main store
 *  (which is already large) and lives at module scope so the query/results survive
 *  switching the left tool window away and back. */
interface FindState {
  query: string;
  replacement: string;
  opts: FindOpts;
  showReplace: boolean;
  showDetails: boolean;
  results: readonly TextHit[];
  error: string | null;
  loading: boolean;
  searched: boolean;
  collapsed: ReadonlySet<string>;
  seq: number;

  setQuery: (q: string) => void;
  setReplacement: (r: string) => void;
  setOpt: (p: Partial<FindOpts>) => void;
  toggleReplace: () => void;
  toggleDetails: () => void;
  toggleCollapsed: (path: string) => void;
  dismissFile: (path: string) => void;
  runSearch: () => Promise<void>;
}

export const useFindStore = create<FindState>((set, get) => ({
  query: '',
  replacement: '',
  opts: DEFAULT_OPTS,
  showReplace: false,
  showDetails: false,
  results: [],
  error: null,
  loading: false,
  searched: false,
  collapsed: new Set(),
  seq: 0,

  setQuery: (query) => set({ query }),
  setReplacement: (replacement) => set({ replacement }),
  setOpt: (p) => set((s) => ({ opts: { ...s.opts, ...p } })),
  toggleReplace: () => set((s) => ({ showReplace: !s.showReplace })),
  toggleDetails: () => set((s) => ({ showDetails: !s.showDetails })),
  toggleCollapsed: (path) =>
    set((s) => {
      const collapsed = new Set(s.collapsed);
      if (collapsed.has(path)) collapsed.delete(path);
      else collapsed.add(path);
      return { collapsed };
    }),
  dismissFile: (path) => set((s) => ({ results: s.results.filter((h) => h.path !== path) })),

  // Run the current query+options. A monotonic seq guards against out-of-order
  // responses clobbering newer ones (the component debounces calls).
  runSearch: async () => {
    const { query, opts } = get();
    if (!query.trim()) {
      set({ results: [], error: null, searched: false, loading: false });
      return;
    }
    const seq = get().seq + 1;
    set({ seq, loading: true });
    try {
      const r = await searchText(query, opts, 1000);
      if (get().seq !== seq) return;
      set({ results: r.results, error: r.error ?? null, loading: false, searched: true });
    } catch (e) {
      if (get().seq !== seq) return;
      set({ results: [], error: (e as Error).message, loading: false, searched: true });
    }
  },
}));
