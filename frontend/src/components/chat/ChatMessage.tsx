import { ChatMarkdown } from './ChatMarkdown';
import { ChatChangeCard } from './ChatChangeCard';
import type { ChatMessage, MessagePart } from '../../types';

const fmtTokens = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
/** Completion meta for a finished assistant turn: "✓ 14s · 1.2k tokens". */
function turnMeta(m: ChatMessage): string {
  const parts = [`✓ ${fmtDuration(m.durationMs ?? 0)}`];
  if (m.tokens != null) parts.push(`${fmtTokens(m.tokens)} tokens`);
  return parts.join(' · ');
}

const TOOL_ICON: Record<string, string> = {
  read_file: '📖', list_dir: '📂', apply_edit: '✏️', write_file: '📝', run_command: '▶',
  Read: '📖', LS: '📂', Glob: '🔎', Grep: '🔎', Edit: '✏️', MultiEdit: '✏️', Write: '📝',
  Bash: '▶', Task: '🤖', WebSearch: '🌐', WebFetch: '🌐', TodoWrite: '🗒️',
};

function toolLabel(name: string, input: unknown, summary?: string): string {
  if (summary) return summary;
  const arg = input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined;
  const path = typeof arg?.path === 'string' ? arg.path : typeof arg?.command === 'string' ? arg.command : '';
  return `${name}${path ? ' ' + path : ''}`;
}

function ToolChip({ p }: { p: Extract<MessagePart, { kind: 'tool' }> }) {
  return (
    <div className={'chat-tool ' + p.status}>
      <span className="chat-tool-ico">{TOOL_ICON[p.name] ?? '🔧'}</span>
      <span className="chat-tool-label">{toolLabel(p.name, p.input, p.summary)}</span>
      <span className="chat-tool-status">{p.status === 'running' ? '…' : p.status === 'error' ? '✕' : '✓'}</span>
    </div>
  );
}

export function ChatMessageView({ m }: { m: ChatMessage }) {
  // Cursor-style: the user turn is a rounded card; the assistant turn is clean,
  // full-width flowing text with no avatar/role chrome.
  if (m.role === 'user') {
    return (
      <div className="chat-msg user">
        <div className="chat-user-card">
          {m.content ? <div className="chat-user-text">{m.content}</div> : null}
          {m.images?.length ? (
            <div className="chat-msg-images">
              {m.images.map((im, i) => (
                <img key={i} src={im.previewUrl} alt={im.name} title={im.name} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-msg assistant">
      {m.thinking ? (
        <details className="chat-thinking">
          <summary>Thinking</summary>
          <pre>{m.thinking}</pre>
        </details>
      ) : null}
      <div className="chat-parts">
        {(m.parts ?? []).map((p, i) => {
          if (p.kind === 'text') return p.text.trim() ? <ChatMarkdown key={i} text={p.text} /> : null;
          if (p.kind === 'change') return <ChatChangeCard key={i} path={p.path} created={p.created} />;
          return <ToolChip key={i} p={p} />;
        })}
        {!m.streaming && m.durationMs != null ? <div className="chat-msg-meta">{turnMeta(m)}</div> : null}
      </div>
    </div>
  );
}
