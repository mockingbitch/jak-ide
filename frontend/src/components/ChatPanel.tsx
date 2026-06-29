import { useEffect, useRef, useState } from 'react';
import { useStore, activeFileTab } from '../store';
import { getAuthStatus, authLogin } from '../api';
import { useChatStream } from '../hooks/useChatStream';
import { useAiStore } from '../lib/aiStore';
import { fileToImage, imagesFromDataTransfer, MAX_IMAGES, MAX_TOTAL_BYTES, type AttachedImage } from '../lib/imageAttach';
import { ChatMessageView } from './chat/ChatMessage';
import { ChatComposer } from './chat/ChatComposer';
import { ChatChanges } from './chat/ChatChanges';
import { IconPlus } from './icons';

const SUGGESTIONS = ['Explain this file', 'Find a bug', 'Add tests', 'Write a commit message'];

export function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const auth = useStore((s) => s.auth);
  const setAuth = useStore((s) => s.setAuth);
  const model = useStore((s) => s.model);
  const authBusy = useStore((s) => s.authBusy);
  const setAuthBusy = useStore((s) => s.setAuthBusy);
  const file = useStore(activeFileTab);
  const permissionMode = useAiStore((s) => s.permissionMode);

  const { send, stop, busy } = useChatStream();
  const [attachments, setAttachments] = useState<AttachedImage[]>([]);
  const [dragging, setDragging] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

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

  const onSend = (text: string) => {
    send(text, attachments);
    setAttachments([]);
  };

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
    >
      <div className="chat-header">
        <span className="chat-title">AI Assistant</span>
        <span className="chat-model-badge" title="Active model">{model}</span>
        {messages.length > 0 && (
          <button
            className="chat-newchat"
            title="New chat"
            onClick={() => {
              stop(); // abort any in-flight stream before clearing
              setMessages([]);
            }}
          >
            <IconPlus size={15} />
          </button>
        )}
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

      {permissionMode !== 'plan' && <ChatChanges />}

      <ChatComposer
        attachments={attachments}
        onAddFiles={addFiles}
        onRemove={removeImage}
        onSend={onSend}
        onStop={stop}
        busy={busy}
        disabled={!auth.hasAuth}
        placeholder={file ? `Ask or instruct about ${file.path.split('/').pop()}…` : 'Ask or instruct Claude…'}
      />

      {dragging > 0 && <div className="chat-dropzone">Drop image to attach</div>}
    </div>
  );
}
