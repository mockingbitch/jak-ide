import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { getFile, searchFiles } from '../api';
import { FileIcon } from './FileIcon';
import { IconSearch } from './icons';

const basename = (p: string) => p.split('/').pop() ?? p;
const dirname = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};

/** Quick "Go to file" — names resolve against the Rust fuzzy index (/api/search/files),
 *  so it stays fast on huge projects and doesn't depend on the full client-side tree. */
export function SearchEverywhere({ onClose }: { onClose: () => void }) {
  const openTab = useStore((s) => s.openTab);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced query against the native index; `alive` guards out-of-order responses.
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      setLoading(true);
      searchFiles(query, 50)
        .then((r) => alive && setResults(r.results))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false));
    }, 110);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActive(0);
  }, [results]);

  // Keep the active item in view as you arrow through the list.
  useEffect(() => {
    listRef.current?.querySelector('.finder-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = async (path?: string) => {
    const target = path ?? results[active];
    if (!target) return;
    try {
      const f = await getFile(target);
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
            <div className="finder-empty">{loading ? 'Searching…' : 'No matches.'}</div>
          ) : (
            results.map((path, i) => (
              <div
                key={path}
                className={'finder-item' + (i === active ? ' active' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(path)}
              >
                <FileIcon name={basename(path)} />
                <span className="finder-name">{basename(path)}</span>
                <span className="finder-dir">{dirname(path)}</span>
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
