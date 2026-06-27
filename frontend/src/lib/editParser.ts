export interface ParsedEdit {
  kind: 'edit' | 'create';
  path: string;
  hunks?: { search: string; replace: string }[];
  content?: string;
  raw: string;
}

// Matches ```edit:path ...``` and ```create:path ...``` fenced blocks the AI emits.
const FENCE = /```(edit|create):([^\n`]+)\n([\s\S]*?)```/g;
const HUNK = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;

export function parseEdits(text: string): ParsedEdit[] {
  const out: ParsedEdit[] = [];
  FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(text))) {
    const kind = m[1] as 'edit' | 'create';
    const path = m[2].trim();
    const body = m[3];
    if (kind === 'create') {
      out.push({ kind, path, content: body.replace(/\n$/, ''), raw: m[0] });
    } else {
      out.push({ kind, path, hunks: parseHunks(body), raw: m[0] });
    }
  }
  return out;
}

function parseHunks(body: string): { search: string; replace: string }[] {
  const hunks: { search: string; replace: string }[] = [];
  HUNK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HUNK.exec(body))) {
    hunks.push({ search: m[1], replace: m[2] });
  }
  // No markers found: treat the whole body as a full-file replacement.
  if (hunks.length === 0 && body.trim()) {
    hunks.push({ search: '', replace: body.replace(/\n$/, '') });
  }
  return hunks;
}
