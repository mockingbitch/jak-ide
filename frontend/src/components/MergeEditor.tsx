import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useStore } from '../store';
import { saveFile, gitStage } from '../api';
import { defineJakIDETheme } from '../lib/monacoTheme';
import { parseConflicts, type ConflictBlock } from '../lib/conflicts';
import { IconClose, IconCheck } from './icons';

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', py: 'python', go: 'go', php: 'php', md: 'markdown', rb: 'ruby', css: 'css',
  scss: 'scss', less: 'less', html: 'html', vue: 'html', yml: 'yaml', yaml: 'yaml', sh: 'shell',
  sql: 'sql', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', xml: 'xml',
};
const langFor = (p: string) => LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';
const basename = (p: string) => p.split('/').pop() ?? p;

export function MergeEditor() {
  const merge = useStore((s) => s.mergeView)!;
  const result = useStore((s) => s.mergeResult) ?? '';
  const setResult = useStore((s) => s.setMergeResult);
  const theme = useStore((s) => s.theme);
  const close = useStore((s) => s.closeMergeView);
  const bumpGitRefresh = useStore((s) => s.bumpGitRefresh);

  const [busy, setBusy] = useState(false);

  const blocks = useMemo(() => parseConflicts(result), [result]);

  const replaceBlock = (b: ConflictBlock, chosen: string[]) => {
    const lines = result.split('\n');
    lines.splice(b.startLine, b.endLine - b.startLine + 1, ...chosen);
    setResult(lines.join('\n'));
  };

  const save = async () => {
    if (busy) return;
    if (blocks.length > 0 && !confirm(`${blocks.length} conflict(s) still have markers. Save and stage anyway?`)) return;
    setBusy(true);
    try {
      await saveFile(merge.path, result);
      await gitStage([merge.path]);
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
          Resolve Conflicts — <b>{basename(merge.path)}</b>
          <span className={'merge-count' + (blocks.length === 0 ? ' done' : '')}>
            {blocks.length === 0 ? <><IconCheck size={13} /> resolved</> : `${blocks.length} left`}
          </span>
        </span>
        <span className="merge-actions">
          <button onClick={() => setResult(merge.ours)} title="Replace the whole file with your branch's version">
            Accept all ours
          </button>
          <button onClick={() => setResult(merge.theirs)} title="Replace the whole file with the incoming version">
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
            language={langFor(merge.path)}
            theme="jakide"
            beforeMount={(m) => defineJakIDETheme(m, theme)}
            onMount={(_e, m) => m.editor.setTheme('jakide')}
            onChange={(v) => setResult(v ?? '')}
            options={{
              fontSize: theme.fontSize,
              fontFamily: theme.fontFamily,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
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
