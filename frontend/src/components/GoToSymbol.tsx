import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, activeFileTab } from '../store';
import { getSymbols, type SymbolItem } from '../api';
import { getEditor } from '../lib/editorRegistry';
import { revealPosition } from '../lib/monacoActions';
import { basename } from '../lib/lang';
import { IconSearch } from './icons';

// Short badge label per symbol kind (falls back to the first letter).
const KIND_BADGE: Record<string, string> = {
  function: 'ƒ', method: 'm', class: 'C', interface: 'I', type: 'T', enum: 'E',
  struct: 'S', trait: 'R', constant: 'K', variable: 'v', property: 'p', field: 'p',
  namespace: 'N', module: 'N', constructor: 'm', impl: 'i', union: 'U', macro: '!',
  enum_case: 'e',
};
const badgeFor = (kind: string) => KIND_BADGE[kind] ?? (kind[0]?.toUpperCase() ?? '?');

/** Go to Symbol in File (Ctrl/Cmd+Shift+O): lists the active file's heuristic
 *  symbols and jumps the active editor to the chosen one. */
export function GoToSymbol({ onClose }: { onClose: () => void }) {
  const file = useStore(activeFileTab);
  const activeGroupId = useStore((s) => s.activeGroupId);
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes from anywhere — the input is disabled when there's no active
  // file, so its onKeyDown can't be the only dismissal path.
  useEffect(() => {
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onWinKey);
    return () => window.removeEventListener('keydown', onWinKey);
  }, [onClose]);

  useEffect(() => {
    if (!file) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    getSymbols(file.path, file.content)
      .then((r) => alive && setSymbols(r.symbols))
      .catch(() => alive && setSymbols([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [file]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter((s) => s.name.toLowerCase().includes(q));
  }, [symbols, query]);

  useEffect(() => {
    setActive(0);
  }, [filtered]);
  useEffect(() => {
    listRef.current?.querySelector('.finder-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (sym?: SymbolItem) => {
    const target = sym ?? filtered[active];
    if (!target) return;
    revealPosition(getEditor(activeGroupId), target.line, target.col);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return; // ignore IME-composition keystrokes (Escape handled at window level)
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
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
            placeholder={file ? `Go to symbol in ${basename(file.path)}…` : 'Open a file to list its symbols'}
            value={query}
            spellCheck={false}
            disabled={!file}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="finder-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="finder-empty">
              {!file ? 'No active file.' : loading ? 'Scanning…' : symbols.length === 0 ? 'No symbols found.' : 'No matches.'}
            </div>
          ) : (
            filtered.map((s, i) => (
              <div
                key={`${s.line}:${s.col}:${s.name}`}
                className={'finder-item sym-item' + (i === active ? ' active' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s)}
              >
                <span className={'sym-badge sym-' + s.kind} title={s.kind}>
                  {badgeFor(s.kind)}
                </span>
                <span className="finder-name" style={{ paddingLeft: Math.min(s.indent, 12) * 7 }}>
                  {s.name}
                </span>
                <span className="sym-kind">{s.kind}</span>
                <span className="sym-line">{s.line}</span>
              </div>
            ))
          )}
        </div>
        <div className="finder-foot">
          <span>
            <span className="k">↑↓</span> navigate
          </span>
          <span>
            <span className="k">↵</span> go
          </span>
          <span>
            <span className="k">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
