import path from 'node:path';
import { PROJECT_ROOT } from '../config';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve a user-supplied relative path against PROJECT_ROOT and guarantee the
 * result stays inside it. Blocks `..` traversal and absolute-path escapes.
 */
export function resolveSafe(relInput: string): string {
  const rel = String(relInput ?? '').replace(/^[/\\]+/, '');
  const abs = path.resolve(PROJECT_ROOT, rel);
  const rootWithSep = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;
  if (abs !== PROJECT_ROOT && !abs.startsWith(rootWithSep)) {
    throw new HttpError(400, 'Path escapes the project root');
  }
  return abs;
}

/** Convert an absolute path inside PROJECT_ROOT back to a posix-style relative path. */
export function toRel(abs: string): string {
  return path.relative(PROJECT_ROOT, abs).split(path.sep).join('/');
}

export { HttpError };
