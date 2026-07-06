import { useEffect } from 'react';
import { useMonaco } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import { useStore } from '../store';
import { createLspClient, type LspClient } from '../lib/lsp/client';
import { registerLspProviders } from '../lib/lsp/providers';
import { setLspBridge } from '../lib/lsp/bridge';
import { registerPhpDefinitionProvider } from '../lib/codeIntel/definitionProvider';
import { useNavHistoryStore } from '../lib/navHistoryStore';
import { openFileAndReveal, openExternalAndReveal } from '../lib/openFileAt';
import { clientLang, diagnosticToMarker, lspLanguageId, type LspDiagnostic } from '../lib/lsp/protocol';
import { EXTERNAL_SCHEME, isInProjectModel, relPathOf } from '../lib/lsp/modelUri';

const CHANGE_DEBOUNCE = 300;
// Monaco language ids per server family, for provider registration. Families with
// `nativeDefinition` get their definition provider from the native (Rust) index —
// which merges the LSP leg itself — instead of the plain LSP definition provider.
const LANG_CONFIGS: ReadonlyArray<{ id: string; monaco: string[]; nativeDefinition?: boolean }> = [
  { id: 'typescript', monaco: ['typescript', 'javascript'] },
  { id: 'php', monaco: ['php'], nativeDefinition: true },
  { id: 'python', monaco: ['python'] },
  { id: 'go', monaco: ['go'] },
];

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
      // Only track in-project editable file models. Skip external read-only tabs
      // (`ext:`) and diff/aux (`inmemory`) models. See lib/lsp/modelUri.
      if (!isInProjectModel(model)) return;
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
      registerLspProviders(monaco, cfg.monaco, () => getClient(cfg.id), rootUri, lspUri, isTracked, {
        skipDefinition: cfg.nativeDefinition,
      })
    );
    // Native go-to-definition (PHP). Registered unconditionally — it works off the
    // Rust index even when no LSP server is installed for the family.
    for (const cfg of LANG_CONFIGS) {
      if (cfg.nativeDefinition) providers.push(registerPhpDefinitionProvider(monaco, { languages: cfg.monaco }));
    }

    // Record the jump origin (in-project or `ext:` external model only) so
    // Ctrl/Cmd+Alt+Left can navigate back after a go-to-definition jump.
    const pushOrigin = (source: editor.ICodeEditor) => {
      const model = source.getModel();
      const pos = source.getPosition();
      if (!model || !pos) return;
      const { push } = useNavHistoryStore.getState();
      if (isInProjectModel(model)) {
        push({ path: relPathOf(model), external: false, line: pos.lineNumber, column: pos.column });
      } else if (model.uri.scheme === EXTERNAL_SCHEME) {
        push({ path: model.uri.path, external: true, line: pos.lineNumber, column: pos.column });
      }
    };

    // Cross-file navigation: when go-to-definition/implementation/references targets a
    // resource that isn't the current model, open it as a tab and reveal the position.
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor(source, resource, selectionOrPosition) {
        let line: number | undefined;
        let col = 1;
        if (selectionOrPosition) {
          if ('startLineNumber' in selectionOrPosition) {
            line = selectionOrPosition.startLineNumber;
            col = selectionOrPosition.startColumn;
          } else {
            line = selectionOrPosition.lineNumber;
            col = selectionOrPosition.column;
          }
        }
        // Out-of-project target (stdlib stub / external dependency) → read-only
        // tab. External targets carry the `ext:` scheme; in-project targets parse
        // to scheme `file` (monaco coerces the scheme-less relative path), so we
        // key on `ext` — NOT `file` — to tell them apart.
        if (resource.scheme === EXTERNAL_SCHEME) {
          pushOrigin(source);
          openExternalAndReveal(resource.path, line ?? 1, col).catch(() => {});
          return true;
        }
        const rel = resource.path.replace(/^\/+/, '');
        if (!rel) return false;
        pushOrigin(source);
        openFileAndReveal(monaco, rel, line, col).catch(() => {});
        return true;
      },
    });

    // Let out-of-tree features (implementation gutter) issue LSP requests for a model.
    setLspBridge((model, method, params) => {
      const langId = clientLang(relPathOf(model));
      if (!langId || !perModel.has(model.uri.toString())) return Promise.reject(new Error('untracked model'));
      return getClient(langId).request(method, { textDocument: { uri: lspUri(model) }, ...params });
    });

    return () => {
      setLspBridge(null);
      opener.dispose();
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
