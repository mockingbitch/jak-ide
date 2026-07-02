import { describe, it, expect } from 'vitest';
import { deriveTitle, sanitizeForHistory, hasContent } from './chatHistory';
import type { ChatMessage } from '../types';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const asst = (text: string): ChatMessage => ({ role: 'assistant', parts: [{ kind: 'text', text }] });

describe('deriveTitle', () => {
  it('uses the first user message, collapsed and truncated', () => {
    expect(deriveTitle([user('  Fix the   login bug  '), asst('ok')])).toBe('Fix the login bug');
    const long = 'a'.repeat(80);
    expect(deriveTitle([user(long)])).toHaveLength(48); // 47 chars + ellipsis
  });
  it('falls back when there is no user text', () => {
    expect(deriveTitle([asst('hi')])).toBe('Untitled chat');
    expect(deriveTitle([])).toBe('Untitled chat');
  });
});

describe('sanitizeForHistory', () => {
  it('drops transient/unserializable fields but keeps content and parts', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hi', images: [{ previewUrl: 'blob:x', name: 'a.png' }] },
      { role: 'assistant', parts: [{ kind: 'text', text: 'yo' }], streaming: true, startedAt: 123, tokens: 5, durationMs: 900 },
    ];
    const out = sanitizeForHistory(msgs);
    expect(out[0]).not.toHaveProperty('images');
    expect(out[1]).not.toHaveProperty('streaming');
    expect(out[1]).not.toHaveProperty('startedAt');
    expect(out[0].content).toBe('hi');
    expect(out[1].parts).toEqual([{ kind: 'text', text: 'yo' }]);
    expect(out[1].tokens).toBe(5);
  });
});

describe('hasContent', () => {
  it('is true only when a user turn has text', () => {
    expect(hasContent([user('x')])).toBe(true);
    expect(hasContent([user('   ')])).toBe(false);
    expect(hasContent([asst('x')])).toBe(false);
    expect(hasContent([])).toBe(false);
  });
});
