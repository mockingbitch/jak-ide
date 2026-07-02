import { useEffect, useMemo, useRef, useState } from 'react';
import { useFindStore } from '../lib/findStore';
import { useOpenFileAt } from '../hooks/useOpenFileAt';
import { groupHitsByFile, hitKey } from '../lib/findGroup';
import { FindResults } from './FindResults';
import { IconSearch } from './icons';

/** "Text" tab of the search modal — full-project content search. Reuses the shared
 *  findStore (so query/results are the same as the docked Find-in-Files panel) and
 *  renders grouped results with keyboard navigation. `active` drives autofocus. */
export function ContentSearchPanel({ active, onClose }: { active: boolean; onClose: () => void }) {
  const query = useFindStore((s) => s.query);
  const opts = useFindStore((s) => s.opts);
  const results = useFindStore((s) => s.results);
  const error = useFindStore((s) => s.error);
  const loading = useFindStore((s) => s.loading);
  const searched = useFindStore((s) => s.searched);
  const collapsed = useFindStore((s) => s.collapsed);
  const setQuery = useFindStore((s) => s.setQuery);
  const setOpt = useFindStore((s) => s.setOpt);
  const toggleCollapsed = useFindStore((s) => s.toggleCollapsed);
  const dismissFile = useFindStore((s) => s.dismissFile);
  const runSearch = useFindStore((s) => s.runSearch);

  const openFileAt = useOpenFileAt();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);

  const groups = useMemo(() => groupHitsByFile(results), [results]);
  // Flat, ordered list of navigable hits (one entry per rendered result line).
  const flat = useMemo(
    () =>
      groups.flatMap((g) =>
        g.hits.map((h, i) => ({ key: hitKey(g.path, i), path: g.path, line: h.line, col: h.col }))
      ),
    [groups]
  );

  // Debounce: re-run whenever the query or any option changes.
  const optKey = `${opts.regex}|${opts.caseSensitive}|${opts.wholeWord}|${opts.include}|${opts.exclude}`;
  useEffect(() => {
    const id = setTimeout(() => {
      runSearch().catch(() => {});
    }, 160);
    return () => clearTimeout(id);
  }, [query, optKey, runSearch]);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);
  // Clamp/reset the cursor when the result set changes.
  useEffect(() => {
    setSelected((a) => (a < flat.length ? a : 0));
  }, [flat.length]);
  useEffect(() => {
    rootRef.current?.querySelector('.find-hit.active')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const open = (path: string, line: number, col: number) =>
    openFileAt(path, line, col)
      .then(onClose)
      .catch((e) => alert((e as Error).message));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const h = flat[selected];
      if (h) open(h.path, h.line, h.col);
    }
  };

  const total = results.length;
  const fileCount = groups.length;
  const activeKey = flat[selected]?.key;

  return (
    <div className="finder-content" ref={rootRef}>
      <div className="finder-input-row">
        <IconSearch size={18} />
        <div className="find-field finder-field">
          <input
            ref={inputRef}
            className="finder-input"
            placeholder="Search text in all files…"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="find-toggles">
            <button
              className={'find-toggle' + (opts.caseSensitive ? ' on' : '')}
              title="Match Case"
              onClick={() => setOpt({ caseSensitive: !opts.caseSensitive })}
            >
              Aa
            </button>
            <button
              className={'find-toggle' + (opts.wholeWord ? ' on' : '')}
              title="Whole Word"
              onClick={() => setOpt({ wholeWord: !opts.wholeWord })}
            >
              W
            </button>
            <button
              className={'find-toggle' + (opts.regex ? ' on' : '')}
              title="Use Regular Expression"
              onClick={() => setOpt({ regex: !opts.regex })}
            >
              .*
            </button>
          </div>
        </div>
      </div>

      <div className="finder-summary">
        {error ? (
          <span className="find-error">{error}</span>
        ) : loading ? (
          <span>Searching…</span>
        ) : !query.trim() ? (
          <span className="find-dim">Type to search the project.</span>
        ) : searched && total === 0 ? (
          <span className="find-dim">No results.</span>
        ) : (
          <span>
            {total} result{total === 1 ? '' : 's'} in {fileCount} file{fileCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <FindResults
        groups={groups}
        collapsed={collapsed}
        activeKey={activeKey}
        onToggle={toggleCollapsed}
        onDismiss={dismissFile}
        onOpen={open}
      />

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
  );
}
