import path from 'node:path';
import fs from 'fs-extra';
import dotenv from 'dotenv';

dotenv.config();

export const PORT = Number(process.env.PORT ?? 8787);

/**
 * The single folder the IDE is allowed to read/write. All paths are resolved
 * relative to it. Mutable at runtime via setProjectRoot() so the user can
 * switch / open projects without restarting; every path helper reads this live
 * binding, so a change takes effect immediately for new file/tree/terminal ops.
 */
export let PROJECT_ROOT = path.resolve(
  process.env.PROJECT_ROOT ?? path.join(process.cwd(), 'workspace')
);
fs.ensureDirSync(PROJECT_ROOT);

/** Point the IDE at a different folder. Validates that it exists and is a directory. */
export function setProjectRoot(dir: string): string {
  const abs = path.resolve(dir);
  const stat = fs.statSync(abs); // throws ENOENT if the folder doesn't exist
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${abs}`);
  PROJECT_ROOT = abs;
  fs.ensureDirSync(PROJECT_ROOT);
  return abs;
}

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
export const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

/** Allowlist for the command runner and terminal. First token of a command must be here. */
export const ALLOWED_COMMANDS = (
  process.env.ALLOWED_COMMANDS ??
  'ls,pwd,echo,cat,head,tail,wc,grep,find,tree,which,whoami,date,node,npm,npx,pnpm,yarn,python,python3,pip,pip3,go,gofmt,php,composer,git,make,tsc,eslint,prettier,vitest,jest,mkdir,touch,cp,mv,sed,awk,sort,uniq,diff'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Directories never shown in the tree or walked for context. */
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.cache', '.turbo',
  'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'coverage', 'target', '.svelte-kit',
]);
