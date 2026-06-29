import { useRef, useState } from 'react';
import { useStore, activeFileTab } from '../store';
import { useAiStore } from '../lib/aiStore';
import type { ChatMessage, ChatStreamEvent, MessagePart } from '../types';
import type { AttachedImage } from '../lib/imageAttach';

/** Owns the AI chat send + SSE stream (no UI). Sends the native Claude options
 *  (model, permissionMode) and any attached images with the current turn, and
 *  exposes stop() to abort an in-flight generation. */
export function useChatStream() {
  const setMessages = useStore((s) => s.setMessages);
  const recordChange = useStore((s) => s.recordChange);
  const applyAiChange = useStore((s) => s.applyAiChange);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Write to the assistant message at a PINNED index; no-op if the array shrank
  // (e.g. "New chat" cleared messages mid-stream) so the reducer never throws.
  const setAt = (idx: number, fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const c = [...prev];
      c[idx] = fn(c[idx]);
      return c;
    });

  const appendTextAt = (idx: number, text: string) =>
    setAt(idx, (m) => {
      const parts = [...(m.parts ?? [])];
      const last = parts[parts.length - 1];
      if (last && last.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: last.text + text };
      else parts.push({ kind: 'text', text });
      return { ...m, parts };
    });

  const handleEvent = (idx: number, evt: ChatStreamEvent) => {
    switch (evt.type) {
      case 'text':
        appendTextAt(idx, evt.text);
        break;
      case 'thinking':
        setAt(idx, (m) => ({ ...m, thinking: (m.thinking ?? '') + evt.text }));
        break;
      case 'tool_use':
        setAt(idx, (m) => ({
          ...m,
          parts: [...(m.parts ?? []), { kind: 'tool', id: evt.id, name: evt.name, input: evt.input, status: 'running' }],
        }));
        break;
      case 'tool_result':
        setAt(idx, (m) => ({
          ...m,
          parts: (m.parts ?? []).map((p) =>
            p.kind === 'tool' && p.id === evt.id ? { ...p, status: evt.ok ? 'done' : 'error', summary: evt.summary } : p
          ),
        }));
        break;
      case 'file_change':
        recordChange(evt.path, evt.before, evt.created);
        applyAiChange(evt.path, evt.after);
        break;
      case 'error':
        appendTextAt(idx, `\n\n⚠️ ${evt.error}`);
        break;
    }
  };

  const send = async (text: string, images: AttachedImage[]) => {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || busy) return;

    const state = useStore.getState();
    const file = activeFileTab(state);
    const { model, permissionMode } = useAiStore.getState();

    // Text-only history for prior turns; the current turn carries the images.
    const apiHistory = state.messages
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
    const history = [...apiHistory, { role: 'user' as const, content: trimmed }];

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, images: images.map((i) => ({ previewUrl: i.previewUrl, name: i.name })) },
      { role: 'assistant', parts: [], thinking: '', streaming: true },
    ]);
    // The assistant turn we just appended is the pin target for this stream.
    const idx = useStore.getState().messages.length - 1;
    setBusy(true);

    const body = {
      messages: history,
      context: { filePath: file?.path, fileContent: file?.content, selection: state.selection ?? undefined },
      options: { model, permissionMode },
      images: images.map((i) => ({ mediaType: i.mediaType, data: i.dataBase64 })),
    };

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!resp.ok) {
        const raw = await resp.text().catch(() => '');
        let msg = raw;
        try {
          msg = (JSON.parse(raw) as { error?: string }).error ?? raw;
        } catch {
          /* not JSON — use the raw body */
        }
        throw new Error(msg.slice(0, 300) || `Request failed (${resp.status})`);
      }
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
          try {
            handleEvent(idx, JSON.parse(line.slice(5).trim()) as ChatStreamEvent);
          } catch {
            /* skip a partial/malformed frame */
          }
        }
      }
      setAt(idx, (m) => ({ ...m, streaming: false }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') appendTextAt(idx, `\n\n⚠️ ${(e as Error).message}`);
      setAt(idx, (m) => ({ ...m, streaming: false }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      bumpGitRefresh(); // the assistant may have edited files
    }
  };

  const stop = () => abortRef.current?.abort();

  return { send, stop, busy };
}
