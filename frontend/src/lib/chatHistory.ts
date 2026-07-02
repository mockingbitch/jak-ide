import type { ChatMessage } from '../types';

export interface ChatSession {
  readonly id: string;
  readonly title: string;
  readonly messages: ChatMessage[];
  readonly updatedAt: number;
}

/** A short title from the first non-empty user message. */
export function deriveTitle(messages: readonly ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && (m.content ?? '').trim().length > 0);
  const raw = (first?.content ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return 'Untitled chat';
  return raw.length > 48 ? raw.slice(0, 47) + '…' : raw;
}

/** Strip transient/unserializable fields (blob image URLs, live-stream flags) so a
 *  session round-trips through localStorage cleanly. */
export function sanitizeForHistory(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    parts: m.parts,
    thinking: m.thinking,
    tokens: m.tokens,
    durationMs: m.durationMs,
  }));
}

/** Worth archiving only if the user actually said something. */
export function hasContent(messages: readonly ChatMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && (m.content ?? '').trim().length > 0);
}
