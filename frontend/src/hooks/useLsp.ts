import { useEffect } from 'react';
import { useMonaco } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { useStore } from '../store';
import { createLspClient, type LspClient } from '../lib/lsp/client';
import { registerLspProviders } from '../lib/lsp/providers';
import { diagnosticToMarker, lspLanguageId, type LspDiagnostic } from '../lib/lsp/protocol';

const CHANGE_DEBOUNCE = 300;
const relPathOf = (model: editor.ITextModel) => model.uri.path.replace(/^\/+/, '');
const isSupported = (model: editor.ITextModel) => lspLanguageId(relPathOf(model)) !== 'plaintext';

/** Wire TypeScript/JavaScript models to the LSP bridge for live diagnostics
 *  (markers). One client per project; document sync is full-text + debounced. */
export function useLsp(): void {
  const monaco = useMonaco();
  const projectRoot = useStore((s) => s.projectRoot);

  useEffect(() => {
    if (!monaco || !projectRoot) return;
    const rootUri = `file://${projectRoot}`;
    const lspUri = (model: editor.ITextModel) => `${rootUri}/${relPathOf(model)}`;

    const client: LspClient = createLspClient({
      lang: 'typescript',
      rootUri,
      onDiagnostics: (uri, diagnostics) => applyDiagnostics(monaco, rootUri, uri, diagnostics),
    });

    const perModel = new Map<string, IDisposable[]>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // Providers only act on models we actually didOpen (real project files), never
    // on anonymous diff/merge models that happen to be ts/js.
    const providers = registerLspProviders(monaco, client, rootUri, lspUri, (model) => perModel.has(model.uri.toString()));

    const attach = (model: editor.ITextModel) => {
      if (model.isDisposed() || !isSupported(model) || perModel.has(model.uri.toString())) return;
      const uri = lspUri(model);
      const key = model.uri.toString();
      client.open(uri, lspLanguageId(relPathOf(model)), model.getValue());
      const changeSub = model.onDidChangeContent(() => {
        const t = timers.get(key);
        if (t) clearTimeout(t);
        timers.set(
          key,
          setTimeout(() => client.change(uri, model.getValue()), CHANGE_DEBOUNCE)
        );
      });
      const disposeSub = model.onWillDispose(() => {
        const t = timers.get(key);
        if (t) clearTimeout(t);
        timers.delete(key);
        client.close(uri);
        perModel.get(key)?.forEach((d) => d.dispose());
        perModel.delete(key);
      });
      perModel.set(key, [changeSub, disposeSub]);
    };

    monaco.editor.getModels().forEach(attach);
    const createSub = monaco.editor.onDidCreateModel(attach);

    return () => {
      createSub.dispose();
      providers.forEach((d) => d.dispose());
      for (const t of timers.values()) clearTimeout(t);
      for (const subs of perModel.values()) subs.forEach((d) => d.dispose());
      perModel.clear();
      client.dispose();
    };
  }, [monaco, projectRoot]);
}

function applyDiagnostics(monaco: Monaco, rootUri: string, uri: string, diagnostics: LspDiagnostic[]): void {
  // file://<root>/<rel> → <rel> → the relative-path model.
  const prefix = rootUri + '/';
  const rel = uri.startsWith(prefix) ? uri.slice(prefix.length) : null;
  if (rel === null) return;
  const model = monaco.editor.getModel(monaco.Uri.parse(rel));
  if (!model) return;
  monaco.editor.setModelMarkers(model, 'lsp', diagnostics.map(diagnosticToMarker));
}
