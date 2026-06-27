import { useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode } from '../types';
import { useStore } from '../store';
import { getFile } from '../api';
import { FileIcon } from './FileIcon';
import { IconSearch } from './icons';

interface FileEntry {
  name: string;
  path: string;
}

/** Flatten the project tree into a flat list of file paths. */
function flatten(node: TreeNode | null): FileEntry[] {
  if (!node) return [];
  const out: FileEntry[] = [];
  const walk = (n: TreeNode) => {
    if (n.type === 'file') out.push({ name: n.name, path: n.path });
    n.children?.forEach(walk);
  };
  node.children?.forEach(walk);
  return out;
}

/** Subsequence fuzzy match; returns a score (higher = better) or -1 for no match. */
function score(query: string, entry: FileEntry): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const name = entry.name.toLowerCase();
  const path = entry.path.toLowerCase();
  if (name.startsWith(q)) return 1000 - name.length;
  if (name.includes(q)) return 700 - name.length;
  // subsequence over the full path
  let qi = 0;
  for (let i = 0; i < path.length && qi < q.length; i++) {
    if (path[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 300 - path.length;
  return -1;
}

const basename = (p: string) => p.split('/').pop() ?? p;
const dirname = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};

export function SearchEverywhere({ onClose }: { onClose: () => void }) {
  const tree = useStore((s) => s.tree);
  const openTab = useStore((s) => s.openTab);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const files = useMemo(() => flatten(tree), [tree]);

  const results = useMemo(() => {
    const scored = files
      .map((f) => ({ f, s: score(query, f) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.f);
    return scored;
  }, [files, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the active item in view as you arrow through the list.
  useEffect(() => {
    const el = listRef.current?.querySelector('.finder-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = async (entry?: FileEntry) => {
    const target = entry ?? results[active];
    if (!target) return;
    try {
      const f = await getFile(target.path);
      openTab({ path: f.path, content: f.content, dirty: false });
      onClose();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose();
    }
  };

  return (
    <div className="finder-overlay" onClick={onClose}>
      <div className="finder" onClick={(e) => e.stopPropagation()}>
        <div className="finder-input-row">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            className="finder-input"
            placeholder="Search files by name…"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="finder-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="finder-empty">{files.length === 0 ? 'No project files loaded.' : 'No matches.'}</div>
          ) : (
            results.map((f, i) => (
              <div
                key={f.path}
                className={'finder-item' + (i === active ? ' active' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(f)}
              >
                <FileIcon name={basename(f.path)} />
                <span className="finder-name">{basename(f.path)}</span>
                <span className="finder-dir">{dirname(f.path)}</span>
              </div>
            ))
          )}
        </div>
        <div className="finder-foot">
          <span>
            <span className="k">↑↓</span> navigate
          </span>
          <span>
            <span className="k">↵</span> open
          </span>
          <span>
            <span className="k">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
