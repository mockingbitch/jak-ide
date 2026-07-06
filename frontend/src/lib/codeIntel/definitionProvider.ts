import type { Monaco } from '@monaco-editor/react';
import type { CancellationToken, editor, IDisposable, languages, Position } from 'monaco-editor';
import { intelDefinition, type IntelLocation } from '../../api';
import { useStore } from '../../store';
import { lspRequest } from '../lsp/bridge';
import { isInProjectModel, relPathOf } from '../lsp/modelUri';
import { positionToLsp } from '../lsp/protocol';
import { lspToLocations, type LspLocation } from '../lsp/providers';
import { mergeEntries, type MergeEntry } from './merge';

// The LSP leg (intelephense) is a best-effort SECOND opinion merged after the native
// Rust result. Cap how long it may delay the response so a slow/hung language server
// never stalls Ctrl+Click — the native index is the primary source. Resolves to null.
const LSP_LEG_TIMEOUT_MS = 2500;

const keyOf = (loc: languages.Location): string => loc.uri.toString() + ':' + loc.range.startLineNumber;

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then((v) => resolve(v)).catch(() => resolve(null)).finally(() => clearTimeout(timer));
  });

// IntelLocation → Monaco location. In-project targets use the same relative-path URI
// convention as lspToLocations (matches open-tab model URIs); external targets use the
// `ext:` scheme (matching ExternalFileTab), which the editor opener loads read-only.
// NB: monaco coerces a scheme-less parse to `file`, so external MUST use an explicit
// scheme to stay distinguishable from in-project targets in the opener.
const nativeToLocation = (monaco: Monaco, l: IntelLocation): languages.Location => ({
  uri: l.external ? monaco.Uri.parse('ext:' + l.path) : monaco.Uri.parse(l.path),
  range: {
    startLineNumber: l.line,
    startColumn: l.column,
    endLineNumber: l.line,
    endColumn: l.column + l.name.length,
  },
});

type Entry = MergeEntry<languages.Location>;

/** PhpStorm-style go-to-definition: query the native Rust index and the LSP server in
 *  parallel, merge (native first, deduped by target file+line). Registered for the php
 *  family INSTEAD of the LSP definition provider — Monaco unions providers, so keeping
 *  both would duplicate every peek entry. Works with no LSP client (native-only) and
 *  degrades to LSP-only when the intel endpoint is unavailable (404 / core not rebuilt). */
export function registerPhpDefinitionProvider(monaco: Monaco, opts: { languages: string[] }): IDisposable {
  return monaco.languages.registerDefinitionProvider(opts.languages, {
    async provideDefinition(model: editor.ITextModel, position: Position, token: CancellationToken) {
      // In-project editable models only; skip external (`ext:`) and aux models.
      if (!isInProjectModel(model)) return null;
      const rootUri = 'file://' + useStore.getState().projectRoot;

      const [nativeRes, lspRes] = await Promise.all([
        intelDefinition(relPathOf(model), model.getValue(), position.lineNumber, position.column).catch(
          () => null
        ),
        // Best-effort second opinion; bounded so a slow LSP never stalls the jump.
        withTimeout(
          lspRequest<LspLocation | LspLocation[] | null>(model, 'textDocument/definition', {
            position: positionToLsp(position),
          }),
          LSP_LEG_TIMEOUT_MS
        ),
      ]);
      if (token.isCancellationRequested) return null;

      const native: Entry[] = nativeRes
        ? nativeRes.locations.map((l) => {
            const payload = nativeToLocation(monaco, l);
            return { key: keyOf(payload), source: 'native', confidence: l.confidence, payload };
          })
        : [];
      const lsp: Entry[] = lspToLocations(monaco, rootUri, lspRes).map((payload) => ({
        key: keyOf(payload),
        source: 'lsp',
        confidence: 1,
        payload,
      }));

      const merged = mergeEntries(native, lsp);
      // null (not []) lets Monaco show its built-in "no definition found" hint.
      return merged.length ? merged.map((e) => e.payload) : null;
    },
  });
}
