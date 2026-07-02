import { useEffect, useRef, useState } from 'react';
import { searchFiles } from '../../api';
import { FileIcon } from '../FileIcon';

const base = (p: string) => p.split('/').pop() ?? p;
const dir = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};

/** Small fuzzy file picker for @-mentioning files into the chat context. Resolves
 *  names against the Rust index (/api/search/files). */
export function MentionPicker({ onPick, onClose }: { onPick: (path: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly string[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      searchFiles(query, 30)
        .then((r) => alive && setResults(r.results))
        .catch(() => alive && setResults([]));
    }, 110);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    listRef.current?.querySelector('.mention-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (path?: string) => {
    const target = path ?? results[active];
    if (target) onPick(target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
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
    <>
      <div className="menu-overlay" onClick={onClose} />
      <div className="mention-pop">
        <input
          ref={inputRef}
          className="mention-input"
          placeholder="Add file to context…"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="mention-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="mention-empty">{query ? 'No matches.' : 'Type to search files.'}</div>
          ) : (
            results.map((path, i) => (
              <div
                key={path}
                className={'mention-item' + (i === active ? ' active' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(path)}
              >
                <FileIcon name={base(path)} />
                <span className="mention-name">{base(path)}</span>
                <span className="mention-dir">{dir(path)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
