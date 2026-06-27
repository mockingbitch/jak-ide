import path from 'node:path';
import fs from 'fs-extra';
import { IGNORE_DIRS } from '../config';
import { resolveSafe } from '../security/paths';
import { readFileContent, writeFileContent, applyEdit } from './fileService';
import { runCommand } from './commandRunner';

export interface ToolExecResult {
  ok: boolean;
  /** Content returned to the model as the tool_result. */
  content: string;
  /** Short human-readable summary for the UI. */
  summary: string;
  /** Set when a file's content changed, so the UI can show a diff. */
  fileChange?: { path: string; before: string; after: string; created?: boolean };
}

/** Tool definitions sent to Claude (Anthropic tool-use schema). */
export const TOOLS = [
  {
    name: 'list_dir',
    description:
      'List files and folders in the project. Pass a project-relative directory path, or omit / "" for the project root. Use this to discover the layout before reading or editing.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative directory path; "" or omitted = project root' } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file by its project-relative path. Returns the exact file content — copy from it verbatim when constructing an apply_edit "search".',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_edit',
    description:
      'Make a MINIMAL edit to an existing file by replacing one exact snippet. Preferred for small changes. "search" must match the current file content exactly (read the file first). Fails if the snippet is not found or not unique enough.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        search: { type: 'string', description: 'Exact existing text to replace (verbatim, incl. indentation)' },
        replace: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'search', 'replace'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description:
      'Create a new file or fully overwrite an existing one with the given content. Use for new files or large rewrites; prefer apply_edit for small changes.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_command',
    description:
      'Run a single allowlisted command in the project root (e.g. run tests, a build, git status, ls). No shell operators (; && | etc.). Returns stdout, stderr, and the exit code.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
  },
];

const MAX_READ_CHARS = 100_000;
const MAX_RESULT_CHARS = 60_000;

function clip(s: string, max = MAX_RESULT_CHARS): string {
  return s.length > max ? s.slice(0, max) + `\n… [truncated, ${s.length} chars total]` : s;
}

async function safeRead(rel: string): Promise<string | null> {
  try {
    const abs = resolveSafe(rel);
    if ((await fs.pathExists(abs)) && (await fs.stat(abs)).isFile()) {
      return await fs.readFile(abs, 'utf8');
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function execTool(name: string, input: any): Promise<ToolExecResult> {
  try {
    switch (name) {
      case 'list_dir':
        return await listDir(String(input?.path ?? ''));
      case 'read_file':
        return await readFileTool(String(input?.path ?? ''));
      case 'apply_edit':
        return await applyEditTool(String(input?.path ?? ''), String(input?.search ?? ''), String(input?.replace ?? ''));
      case 'write_file':
        return await writeFileTool(String(input?.path ?? ''), String(input?.content ?? ''));
      case 'run_command':
        return await runCommandTool(String(input?.command ?? ''));
      default:
        return { ok: false, content: `Unknown tool: ${name}`, summary: `unknown tool ${name}` };
    }
  } catch (e: any) {
    return { ok: false, content: `Error: ${e?.message ?? String(e)}`, summary: `${name} failed` };
  }
}

async function listDir(rel: string): Promise<ToolExecResult> {
  const abs = resolveSafe(rel);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { ok: false, content: `Not a directory: ${rel || '.'}`, summary: `list ${rel || '.'} (not a dir)` };
  }
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const lines = entries
    .filter((e) => !(e.isDirectory() && IGNORE_DIRS.has(e.name)) && e.name !== '.git')
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  const base = rel ? rel.replace(/\/+$/, '') + '/' : '';
  const listing = lines.map((l) => base + l).join('\n') || '(empty)';
  return { ok: true, content: clip(listing), summary: `list ${rel || '.'} (${lines.length})` };
}

async function readFileTool(rel: string): Promise<ToolExecResult> {
  try {
    const { content } = await readFileContent(rel);
    const lineCount = content.split('\n').length;
    return { ok: true, content: clip(content, MAX_READ_CHARS), summary: `read ${rel} (${lineCount} lines)` };
  } catch (e: any) {
    return { ok: false, content: `Error reading ${rel}: ${e?.message ?? e}`, summary: `read ${rel} (error)` };
  }
}

async function applyEditTool(rel: string, search: string, replace: string): Promise<ToolExecResult> {
  const before = await safeRead(rel);
  if (before === null) {
    return {
      ok: false,
      content: `File not found: ${rel}. Use write_file to create it.`,
      summary: `edit ${rel} (not found)`,
    };
  }
  try {
    const after = await applyEdit(rel, [{ search, replace }]);
    return {
      ok: true,
      content: `Edited ${rel}.`,
      summary: `edit ${rel}`,
      fileChange: { path: rel, before, after },
    };
  } catch (e: any) {
    return { ok: false, content: `Could not apply edit to ${rel}: ${e?.message ?? e}`, summary: `edit ${rel} (failed)` };
  }
}

async function writeFileTool(rel: string, content: string): Promise<ToolExecResult> {
  const prior = await safeRead(rel);
  await writeFileContent(rel, content);
  return {
    ok: true,
    content: `Wrote ${rel} (${content.length} chars).`,
    summary: `write ${rel}`,
    fileChange: { path: rel, before: prior ?? '', after: content, created: prior === null },
  };
}

async function runCommandTool(command: string): Promise<ToolExecResult> {
  const r = await runCommand(command);
  const parts = [`exit code: ${r.exitCode}`];
  if (r.stdout) parts.push(`--- stdout ---\n${r.stdout}`);
  if (r.stderr) parts.push(`--- stderr ---\n${r.stderr}`);
  if (r.error) parts.push(`--- error ---\n${r.error}`);
  return { ok: r.ok, content: clip(parts.join('\n')), summary: `$ ${command}` };
}
