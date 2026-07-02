import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useStore } from '../store';
import { saveFile, gitStage } from '../api';
import { defineJakIDETheme } from '../lib/monacoTheme';
import { LINE_NUMBERS_MIN_CHARS, OVERFLOW_WIDGETS_OPTIONS } from '../lib/monacoSetup';
import { langFor, basename } from '../lib/lang';
import { parseConflicts, type ConflictBlock } from '../lib/conflicts';
import { IconClose, IconCheck } from './icons';
import type { MergeTab } from '../types';

/** 3-way merge resolver, rendered as the body of a kind='merge' tab. */
export function MergeEditor({ tab, groupId }: { tab: MergeTab; groupId: string }) {
  const merge = tab.merge;
  const result = tab.result;
  const setResult = useStore((s) => s.setMergeResult);
  const theme = useStore((s) => s.theme);
  const closeTab = useStore((s) => s.closeTab);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);

  const [busy, setBusy] = useState(false);
  const blocks = useMemo(() => parseConflicts(result), [result]);
  const setText = (text: string) => setResult(tab.id, text);
  const close = () => closeTab(tab.id, groupId);

  const replaceBlock = (b: ConflictBlock, chosen: string[]) => {
    const lines = result.split('\n');
    lines.splice(b.startLine, b.endLine - b.startLine + 1, ...chosen);
    setText(lines.join('\n'));
  };

  const save = async () => {
    if (busy) return;
    if (blocks.length > 0 && !confirm(`${blocks.length} conflict(s) still have markers. Save and stage anyway?`)) return;
    setBusy(true);
    try {
      await saveFile(tab.path, result);
      await gitStage([tab.path]);
      bumpGitRefresh();
      close();
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="merge-bar">
        <span className="merge-title">
          Resolve Conflicts — <b>{basename(tab.path)}</b>
          <span className={'merge-count' + (blocks.length === 0 ? ' done' : '')}>
            {blocks.length === 0 ? <><IconCheck size={13} /> resolved</> : `${blocks.length} left`}
          </span>
        </span>
        <span className="merge-actions">
          <button onClick={() => setText(merge.ours)} title="Replace the whole file with your branch's version">
            Accept all ours
          </button>
          <button onClick={() => setText(merge.theirs)} title="Replace the whole file with the incoming version">
            Accept all theirs
          </button>
          <button className="primary" disabled={busy} onClick={save}>
            Save & Mark Resolved
          </button>
          <button className="icon-btn" title="Cancel" onClick={close}>
            <IconClose size={15} />
          </button>
        </span>
      </div>

      <div className="merge-body">
        <div className="merge-result">
          <Editor
            value={result}
            language={langFor(tab.path)}
            theme="jakide"
            beforeMount={(m) => defineJakIDETheme(m, theme)}
            onMount={(_e, m) => m.editor.setTheme('jakide')}
            onChange={(v) => setText(v ?? '')}
            options={{
              ...OVERFLOW_WIDGETS_OPTIONS,
              fontSize: theme.fontSize,
              fontFamily: theme.fontFamily,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS,
            }}
          />
        </div>

        <div className="merge-conflicts">
          {blocks.length === 0 ? (
            <div className="merge-clean">
              <IconCheck size={20} />
              <p>No conflict markers remain. Save &amp; Mark Resolved to stage the file.</p>
            </div>
          ) : (
            blocks.map((b, i) => (
              <div className="merge-conflict" key={i}>
                <div className="merge-conflict-head">Conflict {i + 1}</div>
                <div className="merge-side ours">
                  <div className="merge-side-label">Ours (current)</div>
                  <pre>{b.ours.join('\n') || '(empty)'}</pre>
                  <button className="link" onClick={() => replaceBlock(b, b.ours)}>
                    Use ours
                  </button>
                </div>
                <div className="merge-side theirs">
                  <div className="merge-side-label">Theirs (incoming)</div>
                  <pre>{b.theirs.join('\n') || '(empty)'}</pre>
                  <button className="link" onClick={() => replaceBlock(b, b.theirs)}>
                    Use theirs
                  </button>
                </div>
                <button className="link merge-both" onClick={() => replaceBlock(b, [...b.ours, ...b.theirs])}>
                  Use both (ours + theirs)
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
