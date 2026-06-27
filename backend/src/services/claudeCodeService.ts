import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { PROJECT_ROOT, IGNORE_DIRS } from '../config';
import type { AiContext } from './contextBuilder';
import type { AiEvent, AiMessage } from './aiService';

// Tools Claude Code is allowed to use (file ops + search). Bash, Task, Web*, etc.
// are intentionally excluded so the agent can't run arbitrary commands here.
const ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'Grep', 'Glob'];
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const SNAPSHOT_MAX_FILE = 512 * 1024;
const SNAPSHOT_MAX_TOTAL = 48 * 1024 * 1024;
const SNAPSHOT_MAX_FILES = 4000;

interface Snapshot {
  /** rel path -> content (only for files we could read within the caps). */
  content: Map<string, string>;
  /** Every rel path that existed at snapshot time (incl. ones too big to read). */
  existed: Set<string>;
}

/** Snapshot the project's text files so we can show before/after diffs for edits. */
async function snapshot(): Promise<Snapshot> {
  const content = new Map<string, string>();
  const existed = new Set<string>();
  let total = 0;
  async function walk(absDir: string, depth: number): Promise<void> {
    if (depth > 12 || existed.size >= SNAPSHOT_MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (existed.size >= SNAPSHOT_MAX_FILES) return;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name === '.git') continue;
        await walk(path.join(absDir, e.name), depth + 1);
      } else if (e.isFile()) {
        const abs = path.join(absDir, e.name);
        const rel = path.relative(PROJECT_ROOT, abs).split(path.sep).join('/');
        existed.add(rel); // record existence even if we skip reading the content
        try {
          const stat = await fs.stat(abs);
          if (stat.size > SNAPSHOT_MAX_FILE || total >= SNAPSHOT_MAX_TOTAL) continue;
          content.set(rel, await fs.readFile(abs, 'utf8'));
          total += stat.size;
        } catch {
          /* binary / unreadable — existence still recorded */
        }
      }
    }
  }
  await walk(PROJECT_ROOT, 0);
  return { content, existed };
}

/** Resolve a Claude-Code-supplied path to a project-relative path, or null if outside. */
function relOf(p: string | undefined): string | null {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
  const root = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;
  if (abs !== PROJECT_ROOT && !abs.startsWith(root)) return null;
  return path.relative(PROJECT_ROOT, abs).split(path.sep).join('/');
}

function buildPrompt(messages: AiMessage[], context: AiContext): string {
  const parts: string[] = [];
  const ctx: string[] = [];
  if (context.filePath) ctx.push(`Active file: ${context.filePath}`);
  if (context.selection?.text) {
    ctx.push(`Selected (lines ${context.selection.startLine}-${context.selection.endLine}):\n${context.selection.text}`);
  }
  if (ctx.length) parts.push(`[IDE context]\n${ctx.join('\n')}`);

  const history = messages.slice(0, -1);
  if (history.length) {
    parts.push(
      '[Earlier conversation]\n' +
        history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')
    );
  }
  const last = messages[messages.length - 1];
  parts.push(`[Request]\n${last ? last.content : ''}`);
  return parts.join('\n\n');
}

/**
 * Run a turn through the Claude Code CLI (`claude -p`), reusing the user's login.
 * Maps Claude Code's stream-json to JakIDE's AiEvent stream (text/tool/file_change).
 */
export async function streamClaudeCode(
  messages: AiMessage[],
  context: AiContext,
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const snap = await snapshot();
  const prompt = buildPrompt(messages, context);

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    ...ALLOWED_TOOLS,
  ];

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn('claude', args, { cwd: PROJECT_ROOT, env: process.env });
  } catch (e: any) {
    onEvent({ type: 'error', error: `Failed to launch Claude Code (\`claude\`): ${e?.message ?? e}` });
    onEvent({ type: 'done' });
    return;
  }

  const onAbort = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  signal?.addEventListener('abort', onAbort);

  // Absorb an async EPIPE if the child exits before reading stdin — otherwise the
  // unhandled stream 'error' event crashes the whole backend.
  child.stdin?.on('error', () => {
    /* child exited before reading stdin */
  });
  try {
    child.stdin?.write(prompt);
    child.stdin?.end();
  } catch {
    /* stdin already closed */
  }

  const editPathById = new Map<string, string>();
  const pending: Promise<void>[] = []; // in-flight file_change emits
  let stderr = '';
  let buf = '';
  let done = false;
  let sawResult = false;
  let resolveDone!: () => void;
  const completion = new Promise<void>((r) => {
    resolveDone = r;
  });

  const finish = () => {
    if (done) return;
    done = true;
    signal?.removeEventListener('abort', onAbort);
    // Emit 'done' only after any in-flight file_change events have been sent,
    // so the consumer (which ends the SSE response on 'done') can't drop them.
    Promise.allSettled(pending).then(() => {
      onEvent({ type: 'done' });
      resolveDone();
    });
  };

  const emitFileChange = async (rel: string): Promise<void> => {
    let after = '';
    try {
      after = await fs.readFile(path.resolve(PROJECT_ROOT, rel), 'utf8');
    } catch {
      /* file removed */
    }
    onEvent({
      type: 'file_change',
      path: rel,
      before: snap.content.get(rel) ?? '',
      after,
      created: !snap.existed.has(rel),
    });
  };

  const handleObj = (obj: any) => {
    if (obj.type === 'assistant' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'text' && block.text) onEvent({ type: 'text', text: block.text });
        else if (block.type === 'thinking' && block.thinking) onEvent({ type: 'thinking', text: block.thinking });
        else if (block.type === 'tool_use') {
          onEvent({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          if (FILE_EDIT_TOOLS.has(block.name)) {
            const rel = relOf(block.input?.file_path ?? block.input?.notebook_path ?? block.input?.path);
            if (rel) editPathById.set(block.id, rel);
          }
        }
      }
    } else if (obj.type === 'user' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_result') {
          const ok = !block.is_error;
          onEvent({ type: 'tool_result', id: block.tool_use_id, ok });
          const rel = editPathById.get(block.tool_use_id);
          if (rel && ok) pending.push(emitFileChange(rel));
        }
      }
    } else if (obj.type === 'result') {
      sawResult = true;
      if (obj.is_error || (obj.subtype && obj.subtype !== 'success')) {
        onEvent({
          type: 'error',
          error: typeof obj.result === 'string' && obj.result ? obj.result : `Claude Code: ${obj.subtype ?? 'error'}`,
        });
      }
      finish();
    }
  };

  child.stdout?.on('data', (d) => {
    buf += d.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        handleObj(obj);
      } catch {
        /* keep parsing */
      }
    }
  });
  child.stderr?.on('data', (d) => (stderr += d.toString()));
  child.on('error', (e) => {
    onEvent({
      type: 'error',
      error: `Claude Code failed: ${e.message}. Is the \`claude\` CLI installed and logged in (run \`claude\`)?`,
    });
    finish();
  });
  child.on('close', (code) => {
    // A SIGTERM from an abort closes with code null — that's a requested cancel,
    // not an error.
    if (!done && !signal?.aborted) {
      if (code !== 0) {
        onEvent({ type: 'error', error: `Claude Code exited (${code}). ${stderr.slice(0, 400)}`.trim() });
      } else if (!sawResult) {
        onEvent({ type: 'error', error: 'Claude Code finished without producing a result.' });
      }
    }
    finish();
  });

  // Resolve only when the CLI process has fully finished (so callers can await us).
  await completion;
}
