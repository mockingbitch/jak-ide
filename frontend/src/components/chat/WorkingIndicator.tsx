import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { IconStop } from '../icons';
import type { MessagePart } from '../../types';

// A braille spinner + cycling status verbs, à la the Claude Code CLI working line.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const VERBS = ['Thinking', 'Pondering', 'Working', 'Crunching', 'Computing', 'Noodling', 'Brewing', 'Synthesizing', 'Wrangling', 'Conjuring', 'Churning', 'Reticulating'];
const TOOL_VERB: Record<string, string> = {
  read_file: 'Reading', Read: 'Reading', list_dir: 'Listing', LS: 'Listing', Glob: 'Searching', Grep: 'Searching',
  apply_edit: 'Editing', Edit: 'Editing', MultiEdit: 'Editing', write_file: 'Writing', Write: 'Writing',
  run_command: 'Running', Bash: 'Running', WebSearch: 'Searching the web', WebFetch: 'Fetching', Task: 'Delegating', TodoWrite: 'Planning',
};

const fmtTokens = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

function activityOf(parts: MessagePart[] | undefined, fallback: string): string {
  const running = (parts ?? []).filter((p): p is Extract<MessagePart, { kind: 'tool' }> => p.kind === 'tool' && p.status === 'running');
  const tool = running[running.length - 1];
  if (!tool) return fallback;
  const verb = TOOL_VERB[tool.name] ?? 'Running';
  const arg = tool.input && typeof tool.input === 'object' ? (tool.input as Record<string, unknown>) : undefined;
  const detail =
    typeof arg?.path === 'string' ? arg.path : typeof arg?.file_path === 'string' ? arg.file_path : typeof arg?.command === 'string' ? arg.command : '';
  return detail ? `${verb} ${detail}` : verb;
}

/** The live "processing" line shown while the assistant streams — spinner, a
 *  cycling status verb (or the current tool), a ticking elapsed timer, the output
 *  token count, and an interrupt hint. Esc (or the button) stops generation. */
export function WorkingIndicator({ onStop }: { onStop: () => void }) {
  const messages = useStore((s) => s.messages);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStop]);

  const m = messages[messages.length - 1];
  const elapsed = Math.max(0, Math.floor((Date.now() - (m?.startedAt ?? Date.now())) / 1000));
  const verb = VERBS[Math.floor(tick / 25) % VERBS.length]; // ~3s per word
  const activity = activityOf(m?.parts, verb);

  const textLen =
    (m?.parts ?? []).reduce((s, p) => s + (p.kind === 'text' ? p.text.length : 0), 0) + (m?.thinking?.length ?? 0);
  const tokens = m?.tokens ?? Math.round(textLen / 4);
  const tokenLabel = (m?.tokens == null ? '~' : '') + fmtTokens(tokens);

  return (
    <div className="chat-working">
      <span className="chat-working-spin">{SPINNER[tick % SPINNER.length]}</span>
      <span className="chat-working-activity">{activity}…</span>
      <span className="chat-working-meta">
        {elapsed}s · {tokenLabel} tok · esc to interrupt
      </span>
      <button className="chat-working-stop" title="Stop (esc)" onClick={onStop}>
        <IconStop size={11} />
      </button>
    </div>
  );
}
