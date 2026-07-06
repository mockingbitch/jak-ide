import { create } from 'zustand';

/** A navigable editor location. `path` is project-relative when `external` is false,
 *  absolute (read-only external tab) when true. Line/column are 1-based. */
export interface NavEntry {
  readonly path: string;
  readonly external: boolean;
  readonly line: number;
  readonly column: number;
}

const CAP = 50;

/** Go-to-definition navigation history (PhpStorm-style back/forward). The opener in
 *  useLsp pushes the jump origin; useNavHistory pops entries on Ctrl/Cmd+Alt+Left/Right.
 *  Kept out of the main store — it is pure position data with its own lifecycle. */
interface NavHistoryState {
  back: readonly NavEntry[];
  forward: readonly NavEntry[];

  /** Record the location we are jumping away from. Clears the forward stack. */
  push: (entry: NavEntry) => void;
  /** Pop the most recent origin; `current` (where the user is now) goes onto forward. */
  goBack: (current: NavEntry | null) => NavEntry | null;
  /** Pop the most recent forward entry; `current` goes back onto the back stack. */
  goForward: (current: NavEntry | null) => NavEntry | null;
}

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  back: [],
  forward: [],

  push: (entry) => set((s) => ({ back: [...s.back, entry].slice(-CAP), forward: [] })),

  goBack: (current) => {
    const { back, forward } = get();
    const target = back[back.length - 1];
    if (!target) return null;
    set({
      back: back.slice(0, -1),
      forward: current ? [...forward, current] : forward,
    });
    return target;
  },

  goForward: (current) => {
    const { back, forward } = get();
    const target = forward[forward.length - 1];
    if (!target) return null;
    set({
      forward: forward.slice(0, -1),
      back: current ? [...back, current].slice(-CAP) : back,
    });
    return target;
  },
}));
