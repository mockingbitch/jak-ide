import { useEffect, useRef, useState } from 'react';
import { useStore, activeFileTab } from '../store';
import { getAuthStatus, authLogin } from '../api';
import { useChatStream } from '../hooks/useChatStream';
import { useAiStore } from '../lib/aiStore';
import { fileToImage, imagesFromDataTransfer, MAX_IMAGES, MAX_TOTAL_BYTES, type AttachedImage } from '../lib/imageAttach';
import { useChatHistory } from '../lib/chatHistoryStore';
import { ChatMessageView } from './chat/ChatMessage';
import { ChatComposer } from './chat/ChatComposer';
import { ChatChanges } from './chat/ChatChanges';
import { ChatQueue } from './chat/ChatQueue';
import { ChatHistoryMenu } from './chat/ChatHistoryMenu';
import { WorkingIndicator } from './chat/WorkingIndicator';
import { IconPlus } from './icons';

const SUGGESTIONS = ['Explain this file', 'Find a bug', 'Add tests', 'Write a commit message'];

// A prompt the user submitted while a reply was streaming — parked until its turn.
interface QueuedPrompt {
  id: number;
  text: string;
  images: AttachedImage[];
  mentions: string[];
  includeCurrentFile: boolean;
}

// Which real engine is answering — the app supports only Claude today (via the
// `claude` CLI, or the Anthropic API directly), surfaced from the resolved auth
// method rather than a user-facing "provider" picker since there's nothing else to pick.
const ENGINE_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  apikey: 'Claude API',
  oauth: 'Claude (OAuth)',
  none: 'Not connected',
};

export function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const auth = useStore((s) => s.auth);
  const setAuth = useStore((s) => s.setAuth);
  const model = useStore((s) => s.model);
  const authBusy = useStore((s) => s.authBusy);
  const setAuthBusy = useStore((s) => s.setAuthBusy);
  const authMethod = useStore((s) => s.auth.method);
  const contextUsage = useStore((s) => s.contextUsage);
  const clearContextUsage = useStore((s) => s.clearContextUsage);
  const file = useStore(activeFileTab);
  const permissionMode = useAiStore((s) => s.permissionMode);
  const archiveChat = useChatHistory((s) => s.archive);
  const loadChat = useChatHistory((s) => s.load);

  const { send, stop, busy } = useChatStream();

  // --- prompt queue: prompts submitted mid-stream run one after another ---
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  // `busy` only flips true a render (or an await) after send() starts; this guards
  // that gap so the drain effect never double-dispatches.
  const dispatchingRef = useRef(false);
  const nextQueueId = useRef(0);
  // Stop the current reply AND drop anything queued (a manual stop cancels the batch).
  const stopAll = () => {
    stop();
    setQueue([]);
  };

  // Archive the current chat, then either clear (New chat) or load a past one.
  const newChat = () => {
    stopAll();
    archiveChat(useStore.getState().messages);
    setMessages([]);
    clearContextUsage();
  };
  const openHistory = (id: string) => {
    stopAll();
    archiveChat(useStore.getState().messages);
    const msgs = loadChat(id);
    if (msgs) setMessages(msgs);
    clearContextUsage();
  };
  const [attachments, setAttachments] = useState<AttachedImage[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [dragging, setDragging] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // The active file is bound as context by default; the user can remove its pill,
  // and switching to another file re-binds (dismissal is per active-file path).
  const [ctxDismissed, setCtxDismissed] = useState(false);
  useEffect(() => setCtxDismissed(false), [file?.path]);
  const includeCurrentFile = !!file && !ctxDismissed;

  const addMention = (path: string) => setMentions((prev) => (prev.includes(path) ? prev : [...prev, path]));
  const removeMention = (path: string) => setMentions((prev) => prev.filter((p) => p !== path));

  // Stick to the bottom as the conversation grows / streams.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const addFiles = async (files: File[]) => {
    let current = attachments;
    for (const f of files) {
      if (current.length >= MAX_IMAGES) {
        alert(`You can attach at most ${MAX_IMAGES} images.`);
        break;
      }
      try {
        const img = await fileToImage(f);
        if (current.reduce((s, a) => s + a.bytes, 0) + img.bytes > MAX_TOTAL_BYTES) {
          alert(`Attachments exceed ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB total.`);
          break;
        }
        current = [...current, img];
        setAttachments(current);
      } catch (e) {
        alert((e as Error).message);
      }
    }
  };
  const removeImage = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  const runPrompt = (p: QueuedPrompt) => {
    dispatchingRef.current = true;
    send(p.text, p.images, p.mentions, p.includeCurrentFile);
  };

  // Submit: run now if idle, else park on the queue. Attachments/mentions are captured
  // per prompt and cleared so the composer is ready for the next.
  const onSend = (text: string) => {
    const p: QueuedPrompt = { id: ++nextQueueId.current, text, images: attachments, mentions, includeCurrentFile };
    setAttachments([]);
    setMentions([]);
    if (busy || dispatchingRef.current || queue.length > 0) setQueue((q) => [...q, p]);
    else runPrompt(p);
  };
  const removeQueued = (id: number) => setQueue((q) => q.filter((p) => p.id !== id));

  // Once the stream is actually running, release the dispatch guard.
  useEffect(() => {
    if (busy) dispatchingRef.current = false;
  }, [busy]);
  // When the current reply finishes and nothing is in flight, run the next queued prompt.
  useEffect(() => {
    if (busy || dispatchingRef.current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    runPrompt(next);
    // runPrompt/send are captured from this render; deps intentionally just the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queue]);

  const signIn = async () => {
    if (authBusy) return;
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

  return (
    <div
      className={'chat' + (dragging > 0 ? ' dragover' : '')}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging((n) => n + 1);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => setDragging((n) => Math.max(0, n - 1))}
      onDrop={(e) => {
        const imgs = imagesFromDataTransfer(e.dataTransfer);
        if (imgs.length) {
          e.preventDefault();
          addFiles(imgs);
        }
        setDragging(0);
      }}
      onKeyDown={(e) => {
        // Esc interrupts a running generation — scoped to the chat (focus within
        // the panel), so it never steals Escape from an open modal.
        if (busy && e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          stopAll();
        }
      }}
    >
      <div className="chat-header">
        <span className="chat-title">AI Assistant</span>
        <span className="chat-engine-badge" title={`Active AI engine — model: ${model}`}>
          {ENGINE_LABEL[authMethod] ?? authMethod}
        </span>
        {contextUsage && (
          <span
            className={'chat-context-badge' + (contextUsage.used / contextUsage.window > 0.8 ? ' hot' : '')}
            title={`Context used: ${contextUsage.used.toLocaleString()} / ${contextUsage.window.toLocaleString()} tokens`}
          >
            {Math.min(100, Math.round((contextUsage.used / contextUsage.window) * 100))}% context
          </span>
        )}
        <span className="chat-header-spacer" />
        <ChatHistoryMenu onSelect={openHistory} />
        <button className="chat-newchat" title="New chat" onClick={newChat}>
          <IconPlus size={15} />
        </button>
      </div>

      {!auth.hasAuth && (
        <div className="chat-auth-banner">
          <div className="chat-banner-row">
            <span>Not connected to Claude.</span>
            <button className="chat-signin-btn" onClick={signIn} disabled={authBusy}>
              {authBusy ? 'Finish in browser…' : 'Sign in'}
            </button>
          </div>
          <div className="chat-banner-note">
            {auth.claudeInstalled && 'You have Claude Code — run `claude` and log in, then reload. '}
            {auth.antInstalled
              ? '“Sign in” opens your browser. Or set an API key (File → Set Anthropic API Key).'
              : 'Or set an API key (the “Sign in” button needs the Anthropic `ant` CLI).'}
          </div>
        </div>
      )}

      {permissionMode === 'plan' && (
        <div className="chat-plan-bar">◇ Plan mode — Claude proposes steps read-only; no files are edited.</div>
      )}

      <div className="chat-messages" ref={scroller}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-title">Ask about {file ? <b>{file.path}</b> : 'your code'}</div>
            <div className="chat-empty-sub">
              Claude reads and edits files itself — each change appears below as a diff you can Keep or Revert.
            </div>
            {auth.hasAuth && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chat-suggestion" onClick={() => onSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((m, i) => <ChatMessageView key={i} m={m} />)
        )}
      </div>

      {permissionMode !== 'plan' && <ChatChanges busy={busy} />}

      {busy && <WorkingIndicator onStop={stopAll} />}

      <ChatQueue items={queue} onRemove={removeQueued} />

      <ChatComposer
        attachments={attachments}
        onAddFiles={addFiles}
        onRemove={removeImage}
        onSend={onSend}
        onStop={stopAll}
        busy={busy}
        disabled={!auth.hasAuth}
        contextPath={includeCurrentFile ? file?.path : undefined}
        onRemoveContext={() => setCtxDismissed(true)}
        mentions={mentions}
        onAddMention={addMention}
        onRemoveMention={removeMention}
        placeholder={busy ? 'Queue another prompt…' : file ? `Ask or instruct about ${file.path.split('/').pop()}…` : 'Ask or instruct Claude…'}
      />

      {dragging > 0 && <div className="chat-dropzone">Drop image to attach</div>}
    </div>
  );
}
