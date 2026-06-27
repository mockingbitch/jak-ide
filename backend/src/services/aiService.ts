import type Anthropic from '@anthropic-ai/sdk';
import { MODEL } from '../config';
import { buildContextBlock, type AiContext } from './contextBuilder';
import { TOOLS, execTool } from './aiTools';
import { getClient, AuthError, resolveMethod } from './auth';
import { streamClaudeCode } from './claudeCodeService';

const MAX_ITERATIONS = 20;

export const SYSTEM_PROMPT = `You are JakIDE's AI coding assistant, embedded in a web IDE. You pair-program like a senior staff engineer (similar to Cursor's agent).

Project technologies: PHP / Laravel, JavaScript / TypeScript / React / Vue, Python, Go, and Docker.

You have TOOLS that act directly on the user's project:
- list_dir(path?)        — discover the layout
- read_file(path)        — read a file's exact contents
- apply_edit(path, search, replace) — make a minimal, targeted edit (preferred)
- write_file(path, content)         — create or fully rewrite a file
- run_command(command)   — run a single allowlisted command (tests, git, ls, …)

How to work:
- Read before you edit. Use read_file / list_dir to ground yourself; never guess file contents.
- Make changes yourself with apply_edit (preferred — keep edits minimal) or write_file. Do NOT paste large code blocks for the user to copy; perform the edit.
- After editing, briefly say what you changed and why. The IDE shows every change as a diff the user can Keep or Revert, so you don't need to reprint the whole file.
- Use run_command for verification (e.g. running tests) when helpful.
- For pure questions ("explain this code"), just answer — don't call tools you don't need.
- Be concise. Lead with the outcome.`;

export interface AiEvent {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'file_change' | 'done' | 'error';
  // text / thinking
  text?: string;
  // tool_use / tool_result
  id?: string;
  name?: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
  // file_change
  path?: string;
  before?: string;
  after?: string;
  created?: boolean;
  // error
  error?: string;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Run the agentic loop: stream Claude, execute any tool calls against the
 * project, feed results back, and repeat until the model stops calling tools.
 */
export async function streamChat(
  messages: AiMessage[],
  context: AiContext,
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  // Pick the engine. 'claude-code' drives the `claude` CLI (reuses its login);
  // 'apikey'/'oauth' drive our own SDK agent; 'none' means no credentials.
  const method = await resolveMethod();
  if (method === 'none') {
    onEvent({
      type: 'error',
      error:
        'Not connected to Claude. Sign in with Anthropic, log into Claude Code (run `claude`), or set ANTHROPIC_API_KEY.',
    });
    onEvent({ type: 'done' });
    return;
  }
  if (method === 'claude-code') {
    await streamClaudeCode(messages, context, onEvent, signal);
    return;
  }

  // Enrich the latest user turn with project-aware context.
  const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const last = history[history.length - 1];
  const apiMessages: any[] = history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  if (last && last.role === 'user') {
    const contextBlock = await buildContextBlock(context);
    apiMessages.push({ role: 'user', content: `${contextBlock}\n\n## User request\n${last.content}` });
  } else if (last) {
    apiMessages.push({ role: last.role, content: last.content });
  }

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal?.aborted) break;

      // Resolve the client each iteration so a long OAuth run refreshes its token
      // (and the first iteration validates that we're authenticated at all).
      let client: Anthropic;
      try {
        client = await getClient();
      } catch (e) {
        onEvent({ type: 'error', error: e instanceof AuthError ? e.message : `Auth error: ${(e as Error).message}` });
        break;
      }

      const params: any = {
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive', display: 'summarized' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages: apiMessages,
      };

      const stream = client.messages.stream(params, { signal });
      for await (const event of stream as any) {
        if (event.type !== 'content_block_delta') continue;
        if (event.delta?.type === 'text_delta') onEvent({ type: 'text', text: event.delta.text });
        else if (event.delta?.type === 'thinking_delta') onEvent({ type: 'thinking', text: event.delta.thinking });
      }

      const msg: any = await stream.finalMessage();
      // Preserve the full assistant turn (incl. thinking + tool_use blocks) for the next request.
      apiMessages.push({ role: 'assistant', content: msg.content });

      const toolUses = (msg.content as any[]).filter((b) => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      const toolResults: any[] = [];
      for (const tu of toolUses) {
        if (signal?.aborted) break;
        onEvent({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        const result = await execTool(tu.name, tu.input);
        if (result.fileChange) {
          onEvent({
            type: 'file_change',
            path: result.fileChange.path,
            before: result.fileChange.before,
            after: result.fileChange.after,
            created: result.fileChange.created,
          });
        }
        onEvent({ type: 'tool_result', id: tu.id, ok: result.ok, summary: result.summary });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: !result.ok,
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }
    onEvent({ type: 'done' });
  } catch (err: any) {
    if (signal?.aborted) {
      onEvent({ type: 'done' });
      return;
    }
    onEvent({ type: 'error', error: err?.message ?? String(err) });
    onEvent({ type: 'done' });
  }
}
