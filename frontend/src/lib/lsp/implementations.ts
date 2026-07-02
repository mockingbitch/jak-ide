import type { LspRange } from './protocol';

// LSP SymbolKind values we mark in the gutter: Class=5, Interface=11. Their
// `textDocument/implementation` yields subclasses / implementing classes.
export const IMPL_SYMBOL_KINDS: ReadonlySet<number> = new Set([5, 11]);

interface DocumentSymbol {
  name: string;
  kind: number;
  range?: LspRange;
  selectionRange?: LspRange;
  location?: { range: LspRange };
  children?: DocumentSymbol[];
}

export interface SymbolCandidate {
  name: string;
  kind: number;
  line: number; // 0-based (LSP)
  character: number; // 0-based
}

/** Flatten a documentSymbol response (hierarchical DocumentSymbol[] or flat
 *  SymbolInformation[]) to the class/interface names + name positions to probe. */
export function candidateSymbols(symbols: unknown, kinds = IMPL_SYMBOL_KINDS): SymbolCandidate[] {
  const out: SymbolCandidate[] = [];
  const visit = (s: DocumentSymbol) => {
    const range = s.selectionRange ?? s.range ?? s.location?.range;
    if (range && kinds.has(s.kind)) {
      out.push({ name: s.name, kind: s.kind, line: range.start.line, character: range.start.character });
    }
    s.children?.forEach(visit);
  };
  if (Array.isArray(symbols)) (symbols as DocumentSymbol[]).forEach(visit);
  return out;
}

interface Loc {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetRange?: LspRange;
  targetSelectionRange?: LspRange;
}

export interface ImplTarget {
  path: string; // project-relative
  line: number; // 1-based
}

/** Normalise implementation results to same-project targets, dropping the declaration
 *  itself (some servers include the queried symbol in the result). */
export function implTargets(res: unknown, rootUri: string, selfPath: string, selfLine: number): ImplTarget[] {
  if (!res) return [];
  const arr = Array.isArray(res) ? res : [res];
  const prefix = rootUri + '/';
  const out: ImplTarget[] = [];
  for (const l of arr as Loc[]) {
    const uri = l.uri ?? l.targetUri;
    const range = l.range ?? l.targetSelectionRange ?? l.targetRange;
    if (!uri || !range || !uri.startsWith(prefix)) continue;
    const path = uri.slice(prefix.length);
    const line = range.start.line + 1;
    if (path === selfPath && line === selfLine) continue; // skip self
    out.push({ path, line });
  }
  return out;
}

const base = (p: string) => p.split('/').pop() ?? p;

/** Gutter hover: "Implementations (n) — A.php, B.php". */
export function implHover(targets: readonly ImplTarget[]): string {
  const names = [...new Set(targets.map((t) => base(t.path)))];
  const shown = names.slice(0, 12).map((n) => `\`${n}\``).join(', ');
  const more = names.length > 12 ? ` +${names.length - 12} more` : '';
  return `**Implementations** (${targets.length}) — ${shown}${more}\n\nClick the gutter icon to go to implementation.`;
}
