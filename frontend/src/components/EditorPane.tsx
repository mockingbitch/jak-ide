import { useEffect, useState } from 'react';
import Editor, { DiffEditor, useMonaco, type OnMount, type BeforeMount } from '@monaco-editor/react';
import { useStore, activeFile } from '../store';
import { saveFile, deleteFileApi, gitCommitDiff } from '../api';
import { defineJakIDETheme } from '../lib/monacoTheme';
import { MarkdownPreview } from './MarkdownPreview';
import { FileIcon } from './FileIcon';
import { MergeEditor } from './MergeEditor';
import { IconChevronRight, IconClose } from './icons';

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', py: 'python', go: 'go', php: 'php', md: 'markdown', rb: 'ruby',
  css: 'css', scss: 'scss', less: 'less', html: 'html', vue: 'html', svelte: 'html',
  yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell', sql: 'sql', rs: 'rust',
  java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', toml: 'ini', ini: 'ini',
  xml: 'xml', dockerfile: 'dockerfile',
};

function langFor(path?: string): string {
  if (!path) return 'plaintext';
  const base = path.split('/').pop() ?? '';
  if (base === 'Dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile';
  const ext = base.split('.').pop()?.toLowerCase() ?? '';
  return LANG[ext] ?? 'plaintext';
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

/** Path breadcrumb shown under the tab bar (folders › … › file). */
function Breadcrumbs({ path }: { path: string }) {
  const segs = path.split('/').filter(Boolean);
  return (
    <div className="breadcrumbs">
      {segs.map((seg, i) => {
        const last = i === segs.length - 1;
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {i > 0 && (
              <span className="crumb-sep">
                <IconChevronRight size={13} />
              </span>
            )}
            <span className={'crumb' + (last ? ' file' : '')}>
              {last && <FileIcon name={seg} />}
              {seg}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function EditorPane() {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const setActivePath = useStore((s) => s.setActivePath);
  const closeTab = useStore((s) => s.closeTab);
  const setContent = useStore((s) => s.setContent);
  const setSelection = useStore((s) => s.setSelection);
  const setCursor = useStore((s) => s.setCursor);
  const markSaved = useStore((s) => s.markSaved);
  const theme = useStore((s) => s.theme);
  const changes = useStore((s) => s.changes);
  const clearChange = useStore((s) => s.clearChange);
  const refreshTab = useStore((s) => s.refreshTab);
  const gitDiff = useStore((s) => s.gitDiff);
  const openGitDiff = useStore((s) => s.openGitDiff);
  const gitBlame = useStore((s) => s.gitBlame);
  const gitHistory = useStore((s) => s.gitHistory);
  const mergeView = useStore((s) => s.mergeView);
  const auxActive = useStore((s) => s.auxActive);
  const focusAux = useStore((s) => s.focusAux);
  const closeAux = useStore((s) => s.closeAux);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);
  const monaco = useMonaco();
  const file = activeFile();
  const change = file ? changes[file.path] : undefined;
  const ext = file?.path.split('.').pop()?.toLowerCase();
  const isMarkdown = ext === 'md' || ext === 'markdown';
  // View mode is remembered per file path (not globally) so switching tabs
  // doesn't carry one file's Edit/Split/Preview choice onto another.
  const [mdViews, setMdViews] = useState<Record<string, 'edit' | 'split' | 'preview'>>({});
  const mdView = file ? mdViews[file.path] ?? 'split' : 'split';
  const setMdView = (v: 'edit' | 'split' | 'preview') => {
    if (file) setMdViews((prev) => ({ ...prev, [file.path]: v }));
  };

  const revertChange = async () => {
    if (!file || !change) return;
    try {
      if (change.created) {
        await deleteFileApi(file.path);
        closeTab(file.path);
      } else {
        await saveFile(file.path, change.before);
        refreshTab(file.path, change.before);
      }
      clearChange(file.path);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Re-define + apply the editor theme whenever the theme changes.
  useEffect(() => {
    if (!monaco) return;
    defineJakIDETheme(monaco, theme);
    monaco.editor.setTheme('jakide');
  }, [monaco, theme]);

  const save = async () => {
    const f = activeFile();
    if (!f || !f.dirty) return;
    try {
      await saveFile(f.path, f.content);
      markSaved(f.path);
      bumpGitRefresh(); // saving may change git status → refresh badges/panel
    } catch (e) {
      alert((e as Error).message);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const beforeMount: BeforeMount = (m) => defineJakIDETheme(m, useStore.getState().theme);

  const onMount: OnMount = (editor, m) => {
    m.editor.setTheme('jakide');
    editor.onDidChangeCursorSelection((ev) => {
      const model = editor.getModel();
      const sel = ev.selection;
      setCursor({ line: sel.positionLineNumber, col: sel.positionColumn });
      if (!model || sel.isEmpty()) {
        setSelection(null);
        return;
      }
      setSelection({
        text: model.getValueInRange(sel),
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
      });
    });
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => save());
  };

  const codeEditor = file ? (
    <Editor
      path={file.path}
      language={langFor(file.path)}
      value={file.content}
      theme="jakide"
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(v) => setContent(file.path, v ?? '')}
      options={{
        fontSize: theme.fontSize,
        fontFamily: theme.fontFamily,
        minimap: { enabled: !isMarkdown },
        automaticLayout: true,
        tabSize: 2,
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
      }}
    />
  ) : null;

  // The git diff / blame / history / merge views render as a single extra tab
  // (auxView). auxActive decides whether that tab or the active file is shown,
  // so opening another file while a diff is open works — and you can switch back.
  const auxView = mergeView
    ? { path: mergeView.path, label: `Merge: ${basename(mergeView.path)}` }
    : gitDiff
      ? { path: gitDiff.path, label: `Diff: ${basename(gitDiff.path)}` }
      : gitBlame
        ? { path: gitBlame.path, label: `Blame: ${basename(gitBlame.path)}` }
        : gitHistory
          ? { path: gitHistory.path, label: `History: ${basename(gitHistory.path)}` }
          : null;
  const showAux = Boolean(auxActive && auxView);

  const auxBody = !auxView ? null : mergeView ? (
    <MergeEditor />
  ) : gitDiff ? (
    <>
      <div className="git-diff-bar">
        <span>
          Git diff — <b>{basename(gitDiff.path)}</b>{' '}
          <span className="muted">{gitDiff.mode === 'staged' ? 'HEAD ↔ Index' : 'HEAD ↔ Working tree'}</span>
        </span>
        <button className="icon-btn" title="Close diff" onClick={closeAux}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="monaco-wrap">
        <DiffEditor
          key={'gitdiff:' + gitDiff.path + ':' + gitDiff.mode}
          original={gitDiff.base}
          modified={gitDiff.modified}
          language={langFor(gitDiff.path)}
          theme="jakide"
          beforeMount={beforeMount}
          onMount={(_editor, m) => m.editor.setTheme('jakide')}
          options={{
            readOnly: true,
            renderSideBySide: true,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: theme.fontSize,
            fontFamily: theme.fontFamily,
          }}
        />
      </div>
    </>
  ) : gitBlame ? (
    <>
      <div className="git-diff-bar">
        <span>
          Annotate — <b>{basename(gitBlame.path)}</b>
        </span>
        <button className="icon-btn" title="Close" onClick={closeAux}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="blame-view">
        {gitBlame.lines.map((ln, i) => (
          <div className="blame-line" key={i} title={`${ln.short} · ${ln.author} · ${ln.summary}`}>
            <span className="blame-ann">
              <span className="blame-hash">{ln.short}</span>
              <span className="blame-author">{ln.author}</span>
              <span className="blame-date">{ln.date ? new Date(ln.date).toLocaleDateString() : ''}</span>
            </span>
            <span className="blame-num">{ln.line}</span>
            <span className="blame-code">{ln.code || ' '}</span>
          </div>
        ))}
        {gitBlame.lines.length === 0 && <div className="editor-empty">No blame data.</div>}
      </div>
    </>
  ) : gitHistory ? (
    <>
      <div className="git-diff-bar">
        <span>
          History — <b>{basename(gitHistory.path)}</b>
        </span>
        <button className="icon-btn" title="Close" onClick={closeAux}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="git-log">
        {gitHistory.commits.map((c) => (
          <div
            key={c.hash}
            className="git-commit-row clickable"
            title="Show changes in this commit"
            onClick={async () => {
              try {
                openGitDiff(await gitCommitDiff(c.hash, gitHistory.path));
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            <div className="git-commit-body">
              <div className="git-commit-subject">
                {c.refs && <span className="git-refs">{c.refs.split(', ')[0]}</span>}
                {c.subject}
              </div>
              <div className="git-commit-meta">
                <span className="git-commit-hash">{c.short}</span>
                {c.author} · {new Date(c.date).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        {gitHistory.commits.length === 0 && <div className="git-clean">No history for this file.</div>}
      </div>
    </>
  ) : null;

  return (
    <div className="editor">
      <div className="tabbar">
        {tabs.length === 0 && !auxView && <span className="tab placeholder">No open files</span>}
        {tabs.map((t) => (
          <div
            key={t.path}
            className={'tab' + (!showAux && t.path === activePath ? ' active' : '')}
            onClick={() => setActivePath(t.path)}
            title={t.path}
          >
            <FileIcon name={basename(t.path)} />
            <span className="tab-name">{basename(t.path)}</span>
            <span className="tab-dirty">{t.dirty ? '●' : ''}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${basename(t.path)}`}
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                if (t.dirty && !confirm(`Discard unsaved changes to ${basename(t.path)}?`)) return;
                closeTab(t.path);
              }}
            >
              <IconClose size={13} />
            </button>
          </div>
        ))}
        {auxView && (
          <div className={'tab' + (showAux ? ' active' : '')} onClick={focusAux} title={auxView.path}>
            <FileIcon name={basename(auxView.path)} />
            <span className="tab-name">{auxView.label}</span>
            <button type="button" className="tab-close" aria-label="Close view" title="Close" onClick={(e) => {
              e.stopPropagation();
              closeAux();
            }}>
              <IconClose size={13} />
            </button>
          </div>
        )}
      </div>

      {showAux ? (
        auxBody
      ) : (
        <>
          {file && <Breadcrumbs path={file.path} />}

          {file && change && (
            <div className="diff-bar">
              <span>
                ✦ AI changed <b>{basename(file.path)}</b> — review the diff
              </span>
              <span className="diff-btns">
                <button onClick={() => clearChange(file.path)}>Keep</button>
                <button className="danger" onClick={revertChange}>
                  Revert
                </button>
              </span>
            </div>
          )}
          {file && !change && isMarkdown && (
            <div className="editor-toolbar">
              <div className="view-toggle">
                {(['edit', 'split', 'preview'] as const).map((v) => (
                  <button key={v} className={mdView === v ? 'active' : ''} onClick={() => setMdView(v)}>
                    {v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="monaco-wrap">
            {!file ? (
              <div className="editor-empty">Open a file from the Project tool window to start editing.</div>
            ) : change ? (
              <DiffEditor
                key={file.path}
                original={change.before}
                modified={file.content}
                language={langFor(file.path)}
                theme="jakide"
                beforeMount={beforeMount}
                onMount={(_editor, m) => m.editor.setTheme('jakide')}
                options={{
                  readOnly: true,
                  renderSideBySide: false,
                  fontSize: theme.fontSize,
                  fontFamily: theme.fontFamily,
                  automaticLayout: true,
                  minimap: { enabled: false },
                }}
              />
            ) : isMarkdown ? (
              <div className="md-area">
                {mdView !== 'preview' && <div className="md-pane">{codeEditor}</div>}
                {mdView === 'split' && <div className="md-divider" />}
                {mdView !== 'edit' && (
                  <div className="md-pane md-scroll">
                    <MarkdownPreview content={file.content} />
                  </div>
                )}
              </div>
            ) : (
              codeEditor
            )}
          </div>
        </>
      )}
    </div>
  );
}
