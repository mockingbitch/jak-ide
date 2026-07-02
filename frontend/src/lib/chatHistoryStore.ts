import { create } from 'zustand';
import type { ChatMessage } from '../types';
import { type ChatSession, deriveTitle, sanitizeForHistory, hasContent } from './chatHistory';

const KEY = 'jakide.chatHistory';
const MAX_SESSIONS = 30;
let seq = 0;

function loadSessions(): ChatSession[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? (arr as ChatSession[]) : [];
  } catch {
    return [];
  }
}
function persist(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    /* ignore quota / privacy mode */
  }
}

interface HistoryState {
  sessions: ChatSession[];
  /** Snapshot the current conversation into history (no-op if it has no user turn). */
  archive: (messages: readonly ChatMessage[]) => void;
  /** Pull a session out of history to make it the active conversation. */
  load: (id: string) => ChatMessage[] | null;
  remove: (id: string) => void;
  clearAll: () => void;
}

export const useChatHistory = create<HistoryState>((set, get) => ({
  sessions: loadSessions(),

  archive: (messages) => {
    if (!hasContent(messages)) return;
    const session: ChatSession = {
      id: `s${Date.now()}-${seq++}`,
      title: deriveTitle(messages),
      messages: sanitizeForHistory(messages),
      updatedAt: Date.now(),
    };
    const sessions = [session, ...get().sessions].slice(0, MAX_SESSIONS);
    persist(sessions);
    set({ sessions });
  },

  load: (id) => {
    const found = get().sessions.find((s) => s.id === id);
    if (!found) return null;
    const sessions = get().sessions.filter((s) => s.id !== id);
    persist(sessions);
    set({ sessions });
    return found.messages;
  },

  remove: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    persist(sessions);
    set({ sessions });
  },

  clearAll: () => {
    persist([]);
    set({ sessions: [] });
  },
}));
