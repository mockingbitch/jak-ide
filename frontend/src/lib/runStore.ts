import { create } from 'zustand';
import { cleanOutput } from './ansi';

export interface RunConfig {
  readonly id: string;
  readonly name: string;
  readonly command: string;
}

const KEY = 'jakide.run';
const OUTPUT_CAP = 1_000_000; // keep at most ~1MB of streamed output

interface Persisted {
  configs?: RunConfig[];
  draft?: string;
}
function load(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
const p = load();

/** Run tool window state. Configs + the command draft persist; the live output /
 *  running / exit status are ephemeral but kept here so they survive switching the
 *  bottom view away and back (the WebSocket lives in runnerService, not the panel). */
interface RunState {
  configs: readonly RunConfig[];
  draft: string;
  output: string;
  running: boolean;
  exitCode: number | null;
  /** True when a run ended because the connection dropped (no real exit code). */
  interrupted: boolean;
  lastCommand: string | null;

  setDraft: (d: string) => void;
  saveConfig: (name: string) => void;
  removeConfig: (id: string) => void;
  loadConfig: (id: string) => void;
  begin: (command: string) => void;
  appendOutput: (data: string) => void;
  finish: (code: number | null) => void;
  interrupt: () => void;
  clearOutput: () => void;
}

const persist = (configs: readonly RunConfig[], draft: string) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ configs, draft }));
  } catch {
    /* ignore quota / privacy mode */
  }
};

export const useRunStore = create<RunState>((set, get) => ({
  configs: p.configs ?? [],
  draft: p.draft ?? '',
  output: '',
  running: false,
  exitCode: null,
  interrupted: false,
  lastCommand: null,

  setDraft: (draft) => {
    set({ draft });
    persist(get().configs, draft);
  },
  saveConfig: (name) =>
    set((s) => {
      const command = s.draft.trim();
      const nm = name.trim();
      if (!command || !nm) return {};
      const cfg: RunConfig = { id: crypto.randomUUID(), name: nm, command };
      const configs = [...s.configs.filter((c) => c.name !== nm), cfg];
      persist(configs, s.draft);
      return { configs };
    }),
  removeConfig: (id) =>
    set((s) => {
      const configs = s.configs.filter((c) => c.id !== id);
      persist(configs, s.draft);
      return { configs };
    }),
  loadConfig: (id) =>
    set((s) => {
      const c = s.configs.find((x) => x.id === id);
      if (!c) return {};
      persist(s.configs, c.command);
      return { draft: c.command };
    }),
  begin: (command) => set({ running: true, output: '', exitCode: null, interrupted: false, lastCommand: command }),
  appendOutput: (data) =>
    set((s) => {
      let output = s.output + cleanOutput(data);
      if (output.length > OUTPUT_CAP) output = '…(truncated)…\n' + output.slice(output.length - OUTPUT_CAP);
      return { output };
    }),
  finish: (code) => set({ running: false, exitCode: code }),
  interrupt: () => set((s) => (s.running ? { running: false, interrupted: true } : {})),
  clearOutput: () => set({ output: '', exitCode: null, interrupted: false }),
}));
