import { useEffect, useMemo } from 'react';
import { useFindStore } from '../lib/findStore';
import { useStore } from '../store';
import { useOpenFileAt } from '../hooks/useOpenFileAt';
import { groupHitsByFile } from '../lib/findGroup';
import { replaceInFiles, getFile } from '../api';
import { FindResults } from './FindResults';
import { IconChevronRight, IconChevronDown } from './icons';
import type { FileTab } from '../types';

export function FindInFiles() {
  const query = useFindStore((s) => s.query);
  const replacement = useFindStore((s) => s.replacement);
  const opts = useFindStore((s) => s.opts);
  const showReplace = useFindStore((s) => s.showReplace);
  const showDetails = useFindStore((s) => s.showDetails);
  const results = useFindStore((s) => s.results);
  const error = useFindStore((s) => s.error);
  const loading = useFindStore((s) => s.loading);
  const searched = useFindStore((s) => s.searched);
  const collapsed = useFindStore((s) => s.collapsed);
  const setQuery = useFindStore((s) => s.setQuery);
  const setReplacement = useFindStore((s) => s.setReplacement);
  const setOpt = useFindStore((s) => s.setOpt);
  const toggleReplace = useFindStore((s) => s.toggleReplace);
  const toggleDetails = useFindStore((s) => s.toggleDetails);
  const toggleCollapsed = useFindStore((s) => s.toggleCollapsed);
  const dismissFile = useFindStore((s) => s.dismissFile);
  const runSearch = useFindStore((s) => s.runSearch);

  const openFileAt = useOpenFileAt();
  const groups = useMemo(() => groupHitsByFile(results), [results]);

  // Debounce: re-run whenever the query or any option changes.
  const optKey = `${opts.regex}|${opts.caseSensitive}|${opts.wholeWord}|${opts.include}|${opts.exclude}`;
  useEffect(() => {
    const id = setTimeout(() => {
      runSearch().catch(() => {});
    }, 160);
    return () => clearTimeout(id);
  }, [query, optKey, runSearch]);

  const onReplaceAll = async () => {
    const files = groups.map((g) => g.path);
    if (files.length === 0) return;
    if (!confirm(`Replace all matches of "${query}" in ${files.length} file(s)? This writes to disk.`)) return;
    try {
      const res = await replaceInFiles(query, replacement, opts, files);
      // Reload any open, non-dirty tab whose file we just rewrote (don't clobber unsaved edits).
      const changed = new Set(files);
      const openTabs = useStore
        .getState()
        .groups.flatMap((g) => g.tabs)
        .filter((t): t is FileTab => t.kind === 'file' && changed.has(t.path) && !t.dirty);
      for (const t of openTabs) {
        try {
          const f = await getFile(t.path);
          useStore.getState().refreshTab(t.path, f.content);
        } catch {
          /* file may have been deleted by the replace target list — ignore */
        }
      }
      useStore.getState().bumpGitRefresh();
      await runSearch();
      alert(`Replaced ${res.replacements} occurrence(s) in ${res.filesChanged} file(s).`);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const total = results.length;
  const fileCount = groups.length;

  return (
    <div className="find-panel">
      <div className="tw-header">
        <span className="tw-title">Find in Files</span>
      </div>

      <div className="find-controls">
        <div className="find-input-row">
          <button
            className="find-expand"
            title={showReplace ? 'Hide replace' : 'Toggle replace'}
            onClick={toggleReplace}
            aria-pressed={showReplace}
          >
            {showReplace ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
          <div className="find-field">
            <input
              className="find-input"
              placeholder="Search"
              value={query}
              spellCheck={false}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
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

        {showReplace && (
          <div className="find-input-row find-replace-row">
            <span className="find-expand-spacer" />
            <div className="find-field">
              <input
                className="find-input"
                placeholder={opts.regex ? 'Replace (use ${1} for groups)' : 'Replace'}
                value={replacement}
                spellCheck={false}
                onChange={(e) => setReplacement(e.target.value)}
              />
            </div>
            <button className="find-replace-all" title="Replace All" disabled={total === 0} onClick={onReplaceAll}>
              Replace All
            </button>
          </div>
        )}

        <button className="find-details-toggle" onClick={toggleDetails}>
          {showDetails ? '▾' : '▸'} files to include / exclude
        </button>
        {showDetails && (
          <div className="find-details">
            <input
              className="find-input find-glob"
              placeholder="files to include (e.g. *.ts, src/**)"
              value={opts.include}
              spellCheck={false}
              onChange={(e) => setOpt({ include: e.target.value })}
            />
            <input
              className="find-input find-glob"
              placeholder="files to exclude (e.g. *.test.ts)"
              value={opts.exclude}
              spellCheck={false}
              onChange={(e) => setOpt({ exclude: e.target.value })}
            />
          </div>
        )}

        <div className="find-summary">
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
      </div>

      <FindResults
        groups={groups}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onDismiss={dismissFile}
        onOpen={(path, line, col) => openFileAt(path, line, col).catch((e) => alert((e as Error).message))}
      />
    </div>
  );
}
