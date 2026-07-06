// Pure (monaco-free) merge of go-to-definition results from the native Rust index
// and the LSP server, so the dedupe/priority rules stay unit-testable.

export interface MergeEntry<T> {
  /** Dedupe key: target uri string + ':' + 1-based start line. Columns are ignored
   *  on purpose — the two providers disagree on where a declaration "starts". */
  key: string;
  source: 'native' | 'lsp';
  confidence: number; // 0..1 (native); LSP entries carry a nominal 1
  payload: T;
}

/** Merge native and LSP definition entries: native results come first, and an LSP
 *  entry is dropped when any native entry targets the same key. Duplicates within
 *  a leg are also collapsed (first occurrence wins). */
export function mergeEntries<T>(
  native: readonly MergeEntry<T>[],
  lsp: readonly MergeEntry<T>[]
): MergeEntry<T>[] {
  const seen = new Set<string>();
  const out: MergeEntry<T>[] = [];
  for (const entry of [...native, ...lsp]) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
  }
  return out;
}
