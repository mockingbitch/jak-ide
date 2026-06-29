import { describe, it, expect } from 'vitest';
import type { TreeNode } from '../types';
import { flattenTree, topLevelDirs } from './fileTree';

const dir = (name: string, path: string, children: TreeNode[]): TreeNode => ({ name, path, type: 'dir', children });
const file = (name: string, path: string): TreeNode => ({ name, path, type: 'file' });

const root: TreeNode = dir('root', '', [
  dir('src', 'src', [file('a.ts', 'src/a.ts'), dir('lib', 'src/lib', [file('b.ts', 'src/lib/b.ts')])]),
  file('README.md', 'README.md'),
]);

describe('flattenTree', () => {
  it('shows only top-level rows when nothing is expanded', () => {
    const rows = flattenTree(root, new Set());
    expect(rows.map((r) => r.node.path)).toEqual(['src', 'README.md']);
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
  });

  it('reveals a directory’s children when expanded, with increasing depth', () => {
    const rows = flattenTree(root, new Set(['src']));
    expect(rows.map((r) => r.node.path)).toEqual(['src', 'src/a.ts', 'src/lib', 'README.md']);
    expect(rows.find((r) => r.node.path === 'src/a.ts')?.depth).toBe(1);
  });

  it('expands nested directories independently', () => {
    const rows = flattenTree(root, new Set(['src', 'src/lib']));
    expect(rows.map((r) => r.node.path)).toEqual(['src', 'src/a.ts', 'src/lib', 'src/lib/b.ts', 'README.md']);
    expect(rows.find((r) => r.node.path === 'src/lib/b.ts')?.depth).toBe(2);
  });

  it('handles a null tree', () => {
    expect(flattenTree(null, new Set())).toEqual([]);
  });
});

describe('topLevelDirs', () => {
  it('returns only first-level directories', () => {
    expect([...topLevelDirs(root)]).toEqual(['src']);
  });
});
