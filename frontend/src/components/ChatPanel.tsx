import { useRef, useState } from 'react';
import { useStore } from '../store';
import { getFile, saveFile, deleteFileApi, getAuthStatus, authLogin } from '../api';
import type { ChatMessage, MessagePart } from '../types';

const TOOL_ICON: Record<string, string> = {
  // JakIDE SDK-agent tools
  read_file: '📖',
  list_dir: '📂',
  apply_edit: '✏️',
  write_file: '📝',
  run_command: '▶',
  // Claude Code tools
  Read: '📖',
  LS: '📂',
  Glob: '🔎',
  Grep: '🔎',
  Edit: '✏️',
  MultiEdit: '✏️',
  Write: '📝',
  Bash: '▶',
  Task: '🤖',
  WebSearch: '🌐',
  WebFetch: '🌐',
  TodoWrite: '🗒️',
};

function toolLabel(name: string, input: any, summary?: string): string {
  if (summary) return summary;
  const arg = input?.path ?? input?.command ?? '';
  return `${name}${arg ? ' ' + arg : ''}`;
}

export function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const selection = useStore((s) => s.selection);
  const auth = useStore((s) => s.auth);
  const setAuth = useStore((s) => s.setAuth);
  const model = useStore((s) => s.model);
  const openTab = useStore((s) => s.openTab);
  const refreshTab = useStore((s) => s.refreshTab);
  const applyAiChange = useStore((s) => s.applyAiChange);
  const closeTab = useStore((s) => s.closeTab);
  const recordChange = useStore((s) => s.recordChange);
  const clearChange = useStore((s) => s.clearChange);
  const clearAllChanges = useStore((s) => s.clearAllChanges);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);
  const changes = useStore((s) => s.changes);
  const file = useStore((s) => s.tabs.find((t) => t.path === s.activePath) ?? null);

  const authBusy = useStore((s) => s.authBusy);
  const setAuthBusy = useStore((s) => s.setAuthBusy);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const signIn = async () => {
    if (authBusy) return; // a sign-in is already running (possibly from Settings)
    setAuthBusy(true);
    try {
      const r = await authLogin();
      if (!r.ok && r.error) alert(r.error);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      try {
        setAuth(await getAuthStatus());
      } catch {
        /* ignore */
      }
      setAuthBusy(false);
    }
  };

  const scroll = () => setTimeout(() => scroller.current?.scrollTo(0, scroller.current.scrollHeight), 0);

  // Mutate the in-progress (last) assistant message.
  const updateLast = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => {
      const c = [...prev];
      c[c.length - 1] = fn(c[c.length - 1]);
      return c;
    });

  const appendText = (text: string) =>
    updateLast((m) => {
      const parts = [...(m.parts ?? [])];
      const last = parts[parts.length - 1];
      if (last && last.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: last.text + text };
      else parts.push({ kind: 'text', text });
      return { ...m, parts };
    });

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');

    // Build text-only history for the API from prior turns.
    const apiHistory = messages
      .map((m) => ({
        role: m.role,
        content:
          m.role === 'user'
            ? m.content ?? ''
            : (m.parts ?? [])
                .filter((p): p is Extract<MessagePart, { kind: 'text' }> => p.kind === 'text')
                .map((p) => p.text)
                .join(''),
      }))
      .filter((m) => m.content.trim().length > 0);
    const history = [...apiHistory, { role: 'user' as const, content: text }];

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', parts: [], thinking: '', streaming: true },
    ]);
    setBusy(true);
    scroll();

    const context = { filePath: file?.path, fileContent: file?.content, selection: selection ?? undefined };

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, context }),
      });
      if (!resp.body) throw new Error('No response stream');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';
        for (const ch of chunks) {
          const line = ch.trim();
          if (!line.startsWith('data:')) continue;
          let evt: any;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue; // skip a malformed/partial frame instead of aborting the stream
          }
          handleEvent(evt);
          scroll();
        }
      }
      updateLast((m) => ({ ...m, streaming: false }));
    } catch (e) {
      appendText(`\n\n⚠️ ${(e as Error).message}`);
      updateLast((m) => ({ ...m, streaming: false }));
    } finally {
      setBusy(false);
      scroll();
      bumpGitRefresh(); // the assistant may have edited files → refresh git status
    }
  };

  const handleEvent = (evt: any) => {
    switch (evt.type) {
      case 'text':
        appendText(evt.text);
        break;
      case 'thinking':
        updateLast((m) => ({ ...m, thinking: (m.thinking ?? '') + evt.text }));
        break;
      case 'tool_use':
        updateLast((m) => ({
          ...m,
          parts: [...(m.parts ?? []), { kind: 'tool', id: evt.id, name: evt.name, input: evt.input, status: 'running' }],
        }));
        break;
      case 'tool_result':
        updateLast((m) => ({
          ...m,
          parts: (m.parts ?? []).map((p) =>
            p.kind === 'tool' && p.id === evt.id ? { ...p, status: evt.ok ? 'done' : 'error', summary: evt.summary } : p
          ),
        }));
        break;
      case 'file_change':
        recordChange(evt.path, evt.before, evt.created);
        applyAiChange(evt.path, evt.after); // updates an open tab, but never clobbers unsaved edits
        break;
      case 'error':
        appendText(`\n\n⚠️ ${evt.error}`);
        break;
    }
  };

  const openChanged = async (path: string) => {
    try {
      const f = await getFile(path);
      openTab({ path: f.path, content: f.content, dirty: false });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const revert = async (path: string) => {
    const entry = changes[path];
    if (!entry) return;
    try {
      if (entry.created) {
        // The AI created this file — reverting means deleting it, not blanking it.
        await deleteFileApi(path);
        closeTab(path);
      } else {
        await saveFile(path, entry.before);
        refreshTab(path, entry.before);
      }
      clearChange(path);
    } catch (e) {
      alert('Revert failed: ' + (e as Error).message);
    }
  };

  const revertAll = async () => {
    for (const path of Object.keys(changes)) await revert(path);
  };

  const changedPaths = Object.keys(changes);

  return (
    <div className="chat">
      <div className="tw-header">
        <span className="tw-title">AI Assistant</span>
        <span className="muted">{model}</span>
      </div>
      {!auth.hasAuth && (
        <div className="banner">
          <div className="banner-row">
            <span>Not connected to Claude.</span>
            <button className="signin-btn" onClick={signIn} disabled={authBusy}>
              {authBusy ? 'Finish in your browser…' : 'Sign in with Anthropic'}
            </button>
          </div>
          <div className="banner-note">
            {auth.claudeInstalled && 'You have Claude Code — run `claude` and log in, then reload to use it. '}
            {auth.antInstalled
              ? '“Sign in” opens your browser to authorize. Or use an API key (File → Set Anthropic API Key, or backend/.env).'
              : 'Or set an API key (the “Sign in” button needs the Anthropic `ant` CLI installed).'}
          </div>
        </div>
      )}

      {changedPaths.length > 0 && (
        <div className="changes">
          <div className="changes-head">
            <span>Changes ({changedPaths.length})</span>
            <span className="changes-actions">
              <button className="link" onClick={clearAllChanges}>
                Keep all
              </button>
              <button className="link danger" onClick={revertAll}>
                Revert all
              </button>
            </span>
          </div>
          {changedPaths.map((p) => (
            <div key={p} className="change-row">
              <span className="change-path" title={p} onClick={() => openChanged(p)}>
                {p}
              </span>
              <span className="change-btns">
                <button className="link" onClick={() => clearChange(p)}>
                  Keep
                </button>
                <button className="link danger" onClick={() => revert(p)}>
                  Revert
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="messages" ref={scroller}>
        {messages.length === 0 && (
          <div className="hint">
            Ask about <b>{file ? file.path : 'your code'}</b>, or tell the assistant to make a change — it will read
            and edit files itself, and each change shows up above as a diff you can <b>Keep</b> or <b>Revert</b>.
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView key={i} m={m} />
        ))}
      </div>

      <div className="composer">
        <textarea
          value={input}
          placeholder={file ? `Ask or instruct about ${file.path}…  (Enter to send)` : 'Ask or instruct the assistant…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button onClick={send} disabled={busy}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function MessageView({ m }: { m: ChatMessage }) {
  return (
    <div className={'msg ' + m.role}>
      <div className="role">
        {m.role === 'user' ? 'You' : 'Assistant'}
        {m.streaming ? ' • working…' : ''}
      </div>
      {m.thinking ? (
        <details className="thinking">
          <summary>thinking</summary>
          <pre>{m.thinking}</pre>
        </details>
      ) : null}

      {m.role === 'user' ? (
        <div className="content">
          <pre>{m.content}</pre>
        </div>
      ) : (
        <div className="parts">
          {(m.parts ?? []).map((p, i) =>
            p.kind === 'text' ? (
              p.text.trim() ? (
                <div className="content" key={i}>
                  <pre>{p.text}</pre>
                </div>
              ) : null
            ) : (
              <div key={i} className={'tool-chip ' + p.status}>
                <span className="tool-ico">{TOOL_ICON[p.name] ?? '🔧'}</span>
                <span className="tool-label">{toolLabel(p.name, p.input, p.summary)}</span>
                <span className="tool-status">{p.status === 'running' ? '…' : p.status === 'error' ? '✕' : '✓'}</span>
              </div>
            )
          )}
          {(m.parts ?? []).length === 0 && m.streaming && <div className="content"><pre>…</pre></div>}
        </div>
      )}
    </div>
  );
}
