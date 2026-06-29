import { create } from 'zustand';

// Native Claude options surfaced in the AI panel. Model aliases map to `claude
// --model <alias>`; permission modes map to `claude --permission-mode <mode>`.
export interface ModelOption {
  readonly id: string;
  readonly label: string;
}
export const MODELS: readonly ModelOption[] = [
  { id: 'default', label: 'Default model' },
  { id: 'opus', label: 'Claude Opus' },
  { id: 'sonnet', label: 'Claude Sonnet' },
  { id: 'haiku', label: 'Claude Haiku' },
];

export type PermissionMode = 'acceptEdits' | 'plan' | 'default';
export const PERMISSION_MODES: ReadonlyArray<{ id: PermissionMode; label: string; hint: string }> = [
  { id: 'acceptEdits', label: 'Agent', hint: 'Reads & edits files automatically (review each change as a diff).' },
  { id: 'plan', label: 'Plan', hint: 'Read-only — proposes a plan without changing files.' },
  { id: 'default', label: 'Ask', hint: "Claude Code's default permission prompts." },
];

const KEY = 'jakide.ai';
interface Persisted {
  model?: string;
  permissionMode?: PermissionMode;
}
function load(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
const p = load();

interface AiState {
  model: string;
  permissionMode: PermissionMode;
  setModel: (m: string) => void;
  setPermissionMode: (m: PermissionMode) => void;
}

const persist = (s: { model: string; permissionMode: PermissionMode }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
};

export const useAiStore = create<AiState>((set, get) => ({
  model: p.model ?? 'default',
  permissionMode: p.permissionMode ?? 'acceptEdits',
  setModel: (model) => {
    set({ model });
    persist({ model, permissionMode: get().permissionMode });
  },
  setPermissionMode: (permissionMode) => {
    set({ permissionMode });
    persist({ model: get().model, permissionMode });
  },
}));
