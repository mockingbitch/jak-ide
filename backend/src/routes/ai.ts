import { Router } from 'express';
import { streamChat, type AiMessage } from '../services/aiService';
import type { AiContext } from '../services/contextBuilder';

export const aiRouter = Router();

// POST /api/ai/chat  { messages, context }  -> Server-Sent Events stream
// Each event is a JSON line: {type:'text'|'thinking'|'error'|'done', text?, error?}
aiRouter.post('/chat', async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  await streamChat(
    messages as AiMessage[],
    (context ?? {}) as AiContext,
    (e) => {
      send(e);
      if (e.type === 'done') res.end();
    },
    ac.signal
  );
});
