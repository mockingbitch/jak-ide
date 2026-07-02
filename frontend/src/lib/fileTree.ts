import type { TreeNode } from '../types';

/** A single visible row of the tree once expand/collapse state is applied. */
export interface FlatRow {
  node: TreeNode;
  depth: number;
}

/** Flatten the tree into the ordered list of currently-visible rows: a directory's
 *  children are included only when its path is in `expanded`. Pure — drives the
 *  virtualized renderer (only the rows in view are mounted). */
export function flattenTree(root: TreeNode | null, expanded: ReadonlySet<string>): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: readonly TreeNode[] | undefined, depth: number) => {
    if (!nodes) return;
    for (const n of nodes) {
      out.push({ node: n, depth });
      if (n.type === 'dir' && expanded.has(n.path)) walk(n.children, depth + 1);
    }
  };
  walk(root?.children, 0);
  return out;
}

/** Top-level directories — the default-expanded set (matches the prior depth<1 behaviour). */
export function topLevelDirs(root: TreeNode | null): Set<string> {
  const s = new Set<string>();
  for (const c of root?.children ?? []) if (c.type === 'dir') s.add(c.path);
  return s;
}

/** Every ancestor directory path of a node path, from the top level down.
 *  e.g. 'src/lib/foo.ts' → ['src', 'src/lib']. Pure — drives auto-reveal of the
 *  active file: expanding these makes the file visible in the tree. */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/');
  parts.pop(); // drop the leaf (file or dir) name — we only want its ancestors
  const out: string[] = [];
  let acc = '';
  for (const p of parts) {
    if (!p) continue; // guard against leading '/' or '//' producing empty segments
    acc = acc ? acc + '/' + p : p;
    out.push(acc);
  }
  return out;
}
