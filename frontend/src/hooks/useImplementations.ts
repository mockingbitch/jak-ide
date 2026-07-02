import { useEffect, useRef } from 'react';
import { useMonaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useStore } from '../store';
import { lspRequest } from '../lib/lsp/bridge';
import { openFileAndReveal } from '../lib/openFileAt';
import { clientLang } from '../lib/lsp/protocol';
import { candidateSymbols, implTargets, implHover, type ImplTarget } from '../lib/lsp/implementations';

const DEBOUNCE = 600;
const WARMUP_RETRIES = 4; // documentSymbol may be empty until the server has parsed the file
const MAX_PROBES = 60; // bound the per-file implementation requests

type LineMark = { targets: ImplTarget[]; column: number };

/** PhpStorm-style "implemented by" gutter: marks interface/class declarations that
 *  have implementations, hover lists them, clicking navigates (peek if several). */
export function useImplementations(ed: editor.IStandaloneCodeEditor | null, path: string): void {
  const monaco = useMonaco();
  const marks = useRef<Map<number, LineMark>>(new Map());

  useEffect(() => {
    if (!ed || !monaco || !clientLang(path)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    marks.current = new Map();
    const collection = ed.createDecorationsCollection([]);
    const relOf = (m: editor.ITextModel) => m.uri.path.replace(/^\/+/, '');

    const run = async () => {
      const model = ed.getModel();
      if (!alive || !model || model.isDisposed() || relOf(model) !== path) return;

      const syms = await lspRequest<unknown>(model, 'textDocument/documentSymbol', {}).catch(() => null);
      if (!alive || model.isDisposed() || relOf(model) !== path) return;
      if (syms == null) {
        if (retries++ < WARMUP_RETRIES) timer = setTimeout(run, 1500); // server still warming up
        return;
      }

      const candidates = candidateSymbols(syms).slice(0, MAX_PROBES);
      const rootUri = 'file://' + useStore.getState().projectRoot;
      const found = new Map<number, LineMark>();
      await Promise.all(
        candidates.map(async (c) => {
          const res = await lspRequest<unknown>(model, 'textDocument/implementation', {
            position: { line: c.line, character: c.character },
          }).catch(() => null);
          const targets = implTargets(res, rootUri, path, c.line + 1);
          if (targets.length) found.set(c.line + 1, { targets, column: c.character + 1 });
        })
      );
      if (!alive || model.isDisposed() || relOf(model) !== path) return;

      marks.current = found;
      collection.set(
        [...found.entries()].map(([line, m]) => ({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: {
            glyphMarginClassName: 'impl-glyph',
            glyphMarginHoverMessage: { value: implHover(m.targets) },
          },
        }))
      );
    };

    const mouse = ed.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = e.target.position?.lineNumber;
      const mark = line != null ? marks.current.get(line) : undefined;
      if (line == null || !mark) return;
      ed.setPosition({ lineNumber: line, column: mark.column });
      const action = ed.getAction('editor.action.goToImplementation');
      if (action) action.run().catch(() => {});
      else openFileAndReveal(monaco, mark.targets[0].path, mark.targets[0].line).catch(() => {});
    });

    const change = ed.onDidChangeModelContent(() => {
      retries = 0;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE);
    });

    timer = setTimeout(run, DEBOUNCE); // initial pass once the doc is likely parsed

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      mouse.dispose();
      change.dispose();
      collection.clear();
    };
  }, [ed, monaco, path]);
}
