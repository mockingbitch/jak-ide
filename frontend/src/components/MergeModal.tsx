import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useStore } from '../store';
import { saveFile, gitStage } from '../api';
import { defineJakIDETheme } from '../lib/monacoTheme';
import { LINE_NUMBERS_MIN_CHARS, OVERFLOW_WIDGETS_OPTIONS } from '../lib/monacoSetup';
import { langFor, basename } from '../lib/lang';
import { parseConflicts } from '../lib/conflicts';
import { ConflictLineResolver } from './ConflictLineResolver';
import { IconClose, IconCheck, IconChevronRight, IconChevronDown } from './icons';
import type { MergeSession } from '../types';

const READONLY_OPTS = {
  ...OVERFLOW_WIDGETS_OPTIONS,
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS,
} as const;

/** PhpStorm-style 3-way merge: Local (ours) │ Result (editable) │ Incoming (theirs).
 *  Per-conflict Accept ours/theirs/both; F7 / Shift+F7 jump between conflicts. */
export function MergeModal({ session }: { session: MergeSession }) {
  const theme = useStore((s) => s.theme);
  const setResult = useStore((s) => s.setMergeModalResult);
  const close = useStore((s) => s.closeMergeModal);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);
  const refreshTab = useStore((s) => s.refreshTab);

  const result = session.result;
  const blocks = useMemo(() => parseConflicts(result), [result]);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false); // result editor mounted (edRef set)
  const [lineOpen, setLineOpen] = useState(false); // line-by-line resolver drawer
  const edRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decoRef = useRef<string[]>([]);

  const idx = Math.min(current, Math.max(0, blocks.length - 1));

  // Highlight ours/theirs regions of every conflict; ring the current one. Re-runs
  // whenever the blocks change (an accept rewrites the result).
  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    const decos: editor.IModelDeltaDecoration[] = [];
    blocks.forEach((b, i) => {
      const cur = i === idx;
      // ours: line after <<<<<<< up to ======= / |||||||
      decos.push({
        range: { startLineNumber: b.startLine + 2, startColumn: 1, endLineNumber: b.startLine + 1 + b.ours.length, endColumn: 1 },
        options: { isWholeLine: true, className: 'merge-ln-ours' + (cur ? ' cur' : '') },
      });
      // theirs: the lines just above >>>>>>>
      decos.push({
        range: { startLineNumber: b.endLine - b.theirs.length + 1, startColumn: 1, endLineNumber: b.endLine, endColumn: 1 },
        options: { isWholeLine: true, className: 'merge-ln-theirs' + (cur ? ' cur' : '') },
      });
    });
    decoRef.current = ed.deltaDecorations(decoRef.current, decos);
  }, [blocks, idx, ready]);

  const revealConflict = (i: number) => {
    const b = blocks[i];
    const ed = edRef.current;
    if (b && ed) {
      ed.revealLineInCenter(b.startLine + 1);
      ed.setPosition({ lineNumber: b.startLine + 1, column: 1 });
    }
  };

  const go = (delta: number) => {
    if (blocks.length === 0) return;
    const next = (idx + delta + blocks.length) % blocks.length;
    setCurrent(next);
    revealConflict(next);
  };

  // F7 / Shift+F7 conflict navigation, while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault();
        go(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, idx]);

  // Replace the current conflict's marker region with the chosen lines.
  const accept = (chosen: string[]) => {
    const b = blocks[idx];
    if (!b) return;
    const lines = result.split('\n');
    lines.splice(b.startLine, b.endLine - b.startLine + 1, ...chosen);
    setResult(lines.join('\n'));
    setCurrent((c) => Math.max(0, Math.min(c, blocks.length - 2)));
  };
  const cur = blocks[idx];

  const apply = async () => {
    if (busy) return;
    if (blocks.length > 0 && !confirm(`${blocks.length} conflict(s) still unresolved. Save and stage anyway?`)) return;
    setBusy(true);
    try {
      await saveFile(session.path, result);
      await gitStage([session.path]);
      refreshTab(session.path, result); // keep any open editor tab in sync
      bumpGitRefresh();
      close();
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  };

  const pane = (value: string, label: string, cls: string, editable: boolean) => (
    <div className={'merge-col ' + cls}>
      <div className="merge-col-head">{label}</div>
      <div className="merge-col-body">
        <Editor
          value={value}
          language={langFor(session.path)}
          theme="jakide"
          beforeMount={(m) => defineJakIDETheme(m, theme)}
          onMount={(e, m) => {
            m.editor.setTheme('jakide');
            if (editable) {
              edRef.current = e;
              setReady(true); // false→true re-renders so the decoration effect runs
              const b0 = blocks[0];
              if (b0) e.revealLineInCenter(b0.startLine + 1);
            }
          }}
          onChange={editable ? (v) => setResult(v ?? '') : undefined}
          options={{
            ...(editable ? OVERFLOW_WIDGETS_OPTIONS : READONLY_OPTS),
            fontSize: theme.fontSize,
            fontFamily: theme.fontFamily,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS,
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="merge-modal-overlay">
      <div className="merge-modal">
        <div className="merge-modal-head">
          <span className="merge-modal-title">
            Resolve Conflicts — <b>{basename(session.path)}</b>
            <span className={'merge-count' + (blocks.length === 0 ? ' done' : '')}>
              {blocks.length === 0 ? (
                <>
                  <IconCheck size={13} /> resolved
                </>
              ) : (
                `${idx + 1} / ${blocks.length}`
              )}
            </span>
          </span>
          <span className="merge-nav">
            <button className="icon-btn merge-nav-prev" title="Previous conflict (Shift+F7)" disabled={blocks.length === 0} onClick={() => go(-1)}>
              <IconChevronDown size={15} />
            </button>
            <button className="icon-btn" title="Next conflict (F7)" disabled={blocks.length === 0} onClick={() => go(1)}>
              <IconChevronDown size={15} />
            </button>
          </span>
          <span className="merge-modal-actions">
            <button disabled={!cur} onClick={() => accept(cur ? cur.ours : [])}>
              Accept ours
            </button>
            <button disabled={!cur} onClick={() => accept(cur ? cur.theirs : [])}>
              Accept theirs
            </button>
            <button disabled={!cur} onClick={() => accept(cur ? [...cur.ours, ...cur.theirs] : [])} title="Keep both, ours first">
              Both
            </button>
            <button
              className={lineOpen ? 'active' : ''}
              disabled={!cur}
              onClick={() => setLineOpen((o) => !o)}
              title="Resolve the current conflict line by line"
            >
              By line…
            </button>
            <span className="merge-sep" />
            <button className="primary" disabled={busy} onClick={apply}>
              <IconCheck size={13} /> Apply
            </button>
            <button className="icon-btn" title="Cancel (Esc)" onClick={close}>
              <IconClose size={16} />
            </button>
          </span>
        </div>

        <div className="merge-modal-body">
          {pane(session.ours, 'Local (ours) — accepts « into the middle', 'ours', false)}
          {pane(result, 'Result — merged output (editable)', 'result', true)}
          {pane(session.theirs, 'Incoming (theirs) — accepts » into the middle', 'theirs', false)}
        </div>

        {lineOpen && cur && (
          <div className="merge-line-drawer">
            <ConflictLineResolver
              key={idx}
              ours={cur.ours}
              theirs={cur.theirs}
              onApply={(lines) => {
                accept(lines);
                setLineOpen(false);
              }}
              onClose={() => setLineOpen(false)}
            />
          </div>
        )}

        <div className="merge-modal-foot">
          <IconChevronRight size={12} />
          Press <b>F7</b> for the next conflict, <b>Shift+F7</b> for the previous. Use Accept ours/theirs/both on the highlighted conflict.
        </div>
      </div>
    </div>
  );
}
