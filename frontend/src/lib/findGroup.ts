import type { TextHit } from '../api';

export interface FileGroup {
  readonly path: string;
  readonly hits: readonly TextHit[];
}

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
