import path from 'node:path';
import fs from 'fs-extra';
import { IGNORE_DIRS, PROJECT_ROOT } from '../config';
import { resolveSafe, toRel, HttpError } from '../security/paths';

export interface TreeNode {
  name: string;
  path: string; // relative, posix-style ('' for root)
  type: 'file' | 'dir';
  children?: TreeNode[];
}

const MAX_DEPTH = 8;
const MAX_ENTRIES_PER_DIR = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function buildTree(): Promise<TreeNode> {
  const root: TreeNode = {
    name: path.basename(PROJECT_ROOT) || 'project',
    path: '',
    type: 'dir',
    children: [],
  };
  await walk(PROJECT_ROOT, root, 0);
  return root;
}

async function walk(absDir: string, node: TreeNode, depth: number): Promise<void> {
  if (depth >= MAX_DEPTH) return;
  let entries = await fs.readdir(absDir, { withFileTypes: true });
  entries = entries
    .filter((e) => !(e.isDirectory() && IGNORE_DIRS.has(e.name)))
    .filter((e) => e.name !== '.git')
    .slice(0, MAX_ENTRIES_PER_DIR);
  entries.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1;
    const bd = b.isDirectory() ? 0 : 1;
    return ad - bd || a.name.localeCompare(b.name);
  });
  node.children = [];
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = toRel(abs);
    if (e.isDirectory()) {
      const child: TreeNode = { name: e.name, path: rel, type: 'dir', children: [] };
      node.children.push(child);
      await walk(abs, child, depth + 1);
    } else if (e.isFile()) {
      node.children.push({ name: e.name, path: rel, type: 'file' });
    }
  }
}

export async function readFileContent(rel: string): Promise<{ content: string; path: string }> {
  const abs = resolveSafe(rel);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new HttpError(400, 'Not a file');
  if (stat.size > MAX_FILE_BYTES) throw new HttpError(413, 'File too large to open in the editor');
  const content = await fs.readFile(abs, 'utf8');
  return { content, path: rel };
}

export async function writeFileContent(rel: string, content: string): Promise<void> {
  const abs = resolveSafe(rel);
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, content, 'utf8');
}

export async function createFile(rel: string, content = ''): Promise<void> {
  const abs = resolveSafe(rel);
  if (await fs.pathExists(abs)) throw new HttpError(409, 'File already exists');
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, content, 'utf8');
}

export async function deletePath(rel: string): Promise<void> {
  const abs = resolveSafe(rel);
  if (abs === PROJECT_ROOT) throw new HttpError(400, 'Refusing to delete the project root');
  await fs.remove(abs);
}

export interface EditHunk {
  search: string;
  replace: string;
}

/**
 * Apply one or more search/replace hunks to a file (the format the AI emits).
 * An empty `search` means "replace the whole file with `replace`".
 */
export async function applyEdit(rel: string, hunks: EditHunk[]): Promise<string> {
  const abs = resolveSafe(rel);
  let content = await fs.readFile(abs, 'utf8');
  for (const h of hunks) {
    if (h.search === '') {
      content = h.replace;
      continue;
    }
    const idx = content.indexOf(h.search);
    if (idx === -1) {
      throw new HttpError(422, `Could not locate the SEARCH block in ${rel}. The file may have changed since the suggestion.`);
    }
    content = content.slice(0, idx) + h.replace + content.slice(idx + h.search.length);
  }
  await fs.writeFile(abs, content, 'utf8');
  return content;
}
