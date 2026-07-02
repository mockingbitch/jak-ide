import type { TextHit } from '../api';

export interface FileGroup {
  readonly path: string;
  readonly hits: readonly TextHit[];
}

/** Stable identity for a hit = its file path + index within that file's hit list.
 *  Drives keyboard navigation/active-highlight over the grouped results. The NUL
 *  separator can't appear in a path, so the key never collides. */
export const hitKey = (path: string, indexInFile: number) => `${path}\u0000${indexInFile}`;

/** Group flat content-search hits by file, preserving first-seen file order and
 *  per-file hit order (the order the Rust walker emitted them). */
export function groupHitsByFile(hits: readonly TextHit[]): FileGroup[] {
  const order: string[] = [];
  const byPath = new Map<string, TextHit[]>();
  for (const h of hits) {
    let arr = byPath.get(h.path);
    if (!arr) {
      arr = [];
      byPath.set(h.path, arr);
      order.push(h.path);
    }
    arr.push(h);
  }
  return order.map((path) => ({ path, hits: byPath.get(path) ?? [] }));
}
