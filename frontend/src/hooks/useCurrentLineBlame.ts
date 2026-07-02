import { useEffect, useRef } from 'react';
import type { editor } from 'monaco-editor';
import { gitBlame } from '../api';
import { currentLineLabel } from '../lib/gitAnnotate';
import type { BlameLine } from '../types';

const REFRESH_DEBOUNCE = 1200; // re-blame after edits/saves settle (line numbers drift)

/** GitLens-style current-line blame: a dimmed trailing annotation on the line the
 *  caret is on ("author, 3 days ago • summary") — rendered right inside the code,
 *  no toggle, no separate tab. Cleared while the buffer is mid-edit (stale mapping). */
export function useCurrentLineBlame(ed: editor.IStandaloneCodeEditor | null, path: string, enabled: boolean): void {
  const byLine = useRef<Map<number, BlameLine>>(new Map());

  useEffect(() => {
    if (!ed || !enabled) return;
    let alive = true;
    let stale = false; // buffer edited since last blame → hide until re-blamed
    let timer: ReturnType<typeof setTimeout> | null = null;
    const collection = ed.createDecorationsCollection([]);
    const relOf = (m: editor.ITextModel) => m.uri.path.replace(/^\/+/, '');

    const render = () => {
      const model = ed.getModel();
      const pos = ed.getPosition();
      if (stale || !model || model.isDisposed() || relOf(model) !== path || !pos) {
        collection.clear();
        return;
      }
      const ln = byLine.current.get(pos.lineNumber);
      const label = ln && currentLineLabel(ln, Date.now());
      if (!ln || !label) {
        collection.clear();
        return;
      }
      const col = model.getLineMaxColumn(pos.lineNumber);
      collection.set([
        {
          range: { startLineNumber: pos.lineNumber, startColumn: col, endLineNumber: pos.lineNumber, endColumn: col },
          options: {
            after: { content: `      ${label}`, inlineClassName: 'blame-eol' },
            showIfCollapsed: true,
          },
        },
      ]);
    };

    const load = () => {
      gitBlame(path)
        .then((lines) => {
          if (!alive) return;
          const map = new Map<number, BlameLine>();
          lines.forEach((l, i) => map.set(l.line > 0 ? l.line : i + 1, l));
          byLine.current = map;
          stale = false;
          render();
        })
        .catch(() => {
          /* not a repo / untracked file — no current-line blame */
        });
    };

    load();
    const cursorSub = ed.onDidChangeCursorPosition(() => render());
    const changeSub = ed.onDidChangeModelContent(() => {
      stale = true;
      collection.clear();
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, REFRESH_DEBOUNCE);
    });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      cursorSub.dispose();
      changeSub.dispose();
      collection.clear();
    };
  }, [ed, path, enabled]);
}
