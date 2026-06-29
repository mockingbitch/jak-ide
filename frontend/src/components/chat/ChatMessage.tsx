import { ChatMarkdown } from './ChatMarkdown';
import type { ChatMessage, MessagePart } from '../../types';

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
  const isUser = m.role === 'user';
  return (
    <div className={'chat-msg ' + m.role}>
      <div className="chat-msg-head">
        <span className={'chat-avatar ' + m.role}>{isUser ? 'U' : '✦'}</span>
        <span className="chat-role">{isUser ? 'You' : 'Claude'}</span>
        {m.streaming && <span className="chat-streaming">working…</span>}
      </div>

      {m.thinking ? (
        <details className="chat-thinking">
          <summary>Thinking</summary>
          <pre>{m.thinking}</pre>
        </details>
      ) : null}

      {isUser ? (
        <>
          {m.content ? <div className="chat-user-text">{m.content}</div> : null}
          {m.images?.length ? (
            <div className="chat-msg-images">
              {m.images.map((im, i) => (
                <img key={i} src={im.previewUrl} alt={im.name} title={im.name} />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="chat-parts">
          {(m.parts ?? []).map((p, i) =>
            p.kind === 'text' ? (
              p.text.trim() ? <ChatMarkdown key={i} text={p.text} /> : null
            ) : (
              <ToolChip key={i} p={p} />
            )
          )}
          {(m.parts ?? []).length === 0 && m.streaming ? <div className="chat-typing">●&thinsp;●&thinsp;●</div> : null}
        </div>
      )}
    </div>
  );
}
