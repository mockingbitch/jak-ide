import { create } from 'zustand';

// Native Claude options surfaced in the AI panel. Model aliases map to `claude
// --model <alias>`; permission modes map to `claude --permission-mode <mode>`;
// effort maps to `claude --effort <level>`.
export interface ModelOption {
  readonly id: string;
  readonly label: string;
  /** Full/technical model id shown on the collapsed composer button; falls back to `label`. */
  readonly buttonLabel?: string;
  /** Fuller description (capability + context window) shown in the dropdown list. */
  readonly hint?: string;
}
export const MODELS: readonly ModelOption[] = [
  { id: 'default', label: 'Default model', hint: "Uses the IDE's configured default model." },
  {
    id: 'opus',
    label: 'Claude Opus',
    buttonLabel: 'claude-opus-4-8',
    hint: 'claude-opus-4-8 — deepest reasoning, best for hard/ambiguous work. 200K context.',
  },
  {
    id: 'sonnet',
    label: 'Claude Sonnet',
    buttonLabel: 'claude-sonnet-5',
    hint: 'claude-sonnet-5 — balanced speed & intelligence, the everyday default. 200K context.',
  },
  {
    id: 'haiku',
    label: 'Claude Haiku',
    buttonLabel: 'claude-haiku-4-5',
    hint: 'claude-haiku-4-5 — fastest and most economical, best for simple/quick turns. 200K context.',
  },
];

export type PermissionMode = 'acceptEdits' | 'plan' | 'auto' | 'default';
export const PERMISSION_MODES: ReadonlyArray<{ id: PermissionMode; label: string; hint: string }> = [
  { id: 'acceptEdits', label: 'Agent', hint: 'Reads & edits files automatically (review each change as a diff).' },
  { id: 'auto', label: 'Auto', hint: 'Claude classifies each action and auto-approves low-risk ones, asking only when it matters.' },
  { id: 'plan', label: 'Plan', hint: 'Read-only — proposes a plan without changing files.' },
  { id: 'default', label: 'Ask', hint: "Claude Code's default permission prompts." },
];

export type Effort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: ReadonlyArray<{ id: Effort; label: string; hint: string }> = [
  { id: 'default', label: 'Effort', hint: "Claude Code's standard reasoning effort." },
  { id: 'low', label: 'Low', hint: 'Fastest, least reasoning — quick edits and simple questions.' },
  { id: 'medium', label: 'Medium', hint: 'Balanced reasoning for everyday tasks.' },
  { id: 'high', label: 'High', hint: 'More thorough reasoning for harder problems.' },
  { id: 'xhigh', label: 'X-High', hint: 'Extra reasoning depth for complex, multi-step work.' },
  { id: 'max', label: 'Max', hint: 'Maximum reasoning effort — slowest, most thorough.' },
];

const KEY = 'jakide.ai';
interface Persisted {
  model?: string;
  permissionMode?: PermissionMode;
  effort?: Effort;
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
  effort: Effort;
  setModel: (m: string) => void;
  setPermissionMode: (m: PermissionMode) => void;
  setEffort: (e: Effort) => void;
}

const persist = (s: { model: string; permissionMode: PermissionMode; effort: Effort }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
};

export const useAiStore = create<AiState>((set, get) => ({
  model: p.model ?? 'default',
  permissionMode: p.permissionMode ?? 'acceptEdits',
  effort: p.effort ?? 'default',
  setModel: (model) => {
    set({ model });
    persist({ model, permissionMode: get().permissionMode, effort: get().effort });
  },
  setPermissionMode: (permissionMode) => {
    set({ permissionMode });
    persist({ model: get().model, permissionMode, effort: get().effort });
  },
  setEffort: (effort) => {
    set({ effort });
    persist({ model: get().model, permissionMode: get().permissionMode, effort });
  },
}));
