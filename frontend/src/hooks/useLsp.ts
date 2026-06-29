import { useEffect } from 'react';
import { useMonaco } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { useStore } from '../store';
import { createLspClient, type LspClient } from '../lib/lsp/client';
import { registerLspProviders } from '../lib/lsp/providers';
import { clientLang, diagnosticToMarker, lspLanguageId, type LspDiagnostic } from '../lib/lsp/protocol';

const CHANGE_DEBOUNCE = 300;
// Monaco language ids per server family, for provider registration.
const LANG_CONFIGS: ReadonlyArray<{ id: string; monaco: string[] }> = [
  { id: 'typescript', monaco: ['typescript', 'javascript'] },
  { id: 'php', monaco: ['php'] },
  { id: 'python', monaco: ['python'] },
  { id: 'go', monaco: ['go'] },
];

const relPathOf = (model: editor.ITextModel) => model.uri.path.replace(/^\/+/, '');

/** Wire source models to per-language LSP servers (via the /ws/lsp bridge) for live
 *  diagnostics + completion/hover/definition. One client per language family, created
 *  lazily on first use; full-text + debounced document sync. */
export function useLsp(): void {
  const monaco = useMonaco();
  const projectRoot = useStore((s) => s.projectRoot);

  useEffect(() => {
    if (!monaco || !projectRoot) return;
    const rootUri = `file://${projectRoot}`;
    const lspUri = (model: editor.ITextModel) => `${rootUri}/${relPathOf(model)}`;

    const clients = new Map<string, LspClient>();
    const getClient = (langId: string): LspClient => {
      let c = clients.get(langId);
      if (!c) {
        c = createLspClient({
          lang: langId,
          rootUri,
          onDiagnostics: (uri, diagnostics) => applyDiagnostics(monaco, rootUri, uri, diagnostics),
        });
        clients.set(langId, c);
      }
      return c;
    };

    const perModel = new Map<string, IDisposable[]>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const attach = (model: editor.ITextModel) => {
      if (model.isDisposed()) return;
      const path = relPathOf(model);
      const langId = clientLang(path);
      const key = model.uri.toString();
      if (!langId || perModel.has(key)) return;
      const uri = lspUri(model);
      const client = getClient(langId);
      client.open(uri, lspLanguageId(path), model.getValue());
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

    // Providers act only on tracked (opened project) models; the client for a family
    // is created lazily the first time it's needed.
    const isTracked = (model: editor.ITextModel) => perModel.has(model.uri.toString());
    const providers = LANG_CONFIGS.flatMap((cfg) =>
      registerLspProviders(monaco, cfg.monaco, () => getClient(cfg.id), rootUri, lspUri, isTracked)
    );

    return () => {
      createSub.dispose();
      providers.forEach((d) => d.dispose());
      for (const t of timers.values()) clearTimeout(t);
      for (const subs of perModel.values()) subs.forEach((d) => d.dispose());
      perModel.clear();
      for (const c of clients.values()) c.dispose();
      clients.clear();
    };
  }, [monaco, projectRoot]);
}

function applyDiagnostics(monaco: Monaco, rootUri: string, uri: string, diagnostics: LspDiagnostic[]): void {
  // file://<root>/<rel> → <rel> → the relative-path model.
  const prefix = rootUri + '/';
  if (!uri.startsWith(prefix)) return;
  const model = monaco.editor.getModel(monaco.Uri.parse(uri.slice(prefix.length)));
  if (!model) return;
  monaco.editor.setModelMarkers(model, 'lsp', diagnostics.map(diagnosticToMarker));
}
