import type { Monaco } from '@monaco-editor/react';
import type { editor, IDisposable, languages, Position } from 'monaco-editor';
import type { LspClient } from './client';
import { toMonacoRange, completionKindName, hoverContents, positionToLsp, type LspRange } from './protocol';

// Minimal shapes of the LSP responses we consume.
interface LspTextEdit {
  range: LspRange;
  newText: string;
}
interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: unknown;
  insertText?: string;
  insertTextFormat?: number; // 1 plaintext, 2 snippet
  textEdit?: LspTextEdit;
  sortText?: string;
  filterText?: string;
}
interface LspCompletionList {
  isIncomplete?: boolean;
  items: LspCompletionItem[];
}
interface LspHover {
  contents: unknown;
  range?: LspRange;
}
interface LspLocation {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetSelectionRange?: LspRange;
  targetRange?: LspRange;
}

const docOf = (d: unknown): string | { value: string } | undefined => {
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && typeof (d as { value?: unknown }).value === 'string') {
    return { value: (d as { value: string }).value };
  }
  return undefined;
};

/** Register Monaco completion/hover/definition providers backed by the LSP client.
 *  `uriOf` maps a model to its LSP file:// uri. Returns disposables. */
export function registerLspProviders(
  monaco: Monaco,
  languages: string[],
  getClient: () => LspClient,
  rootUri: string,
  uriOf: (model: editor.ITextModel) => string,
  isTracked: (model: editor.ITextModel) => boolean
): IDisposable[] {
  const docPos = (model: editor.ITextModel, position: Position) => ({
    textDocument: { uri: uriOf(model) },
    position: positionToLsp(position),
  });
  const kindEnum = monaco.languages.CompletionItemKind as unknown as Record<string, number>;

  const completion = monaco.languages.registerCompletionItemProvider(languages, {
    triggerCharacters: ['.', '"', "'", '/', '@', '<', ' '],
    async provideCompletionItems(model: editor.ITextModel, position: Position) {
      if (!isTracked(model)) return { suggestions: [] };
      const res = await getClient()
        .request<LspCompletionItem[] | LspCompletionList | null>('textDocument/completion', docPos(model, position))
        .catch(() => null);
      if (!res) return { suggestions: [] };
      const items = Array.isArray(res) ? res : res.items ?? [];
      const incomplete = Array.isArray(res) ? false : Boolean(res.isIncomplete);
      const word = model.getWordUntilPosition(position);
      const defaultRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };
      const suggestions: languages.CompletionItem[] = items.map((it) => ({
        label: it.label,
        kind: kindEnum[completionKindName(it.kind)] ?? kindEnum.Property,
        insertText: it.textEdit?.newText ?? it.insertText ?? it.label,
        insertTextRules:
          it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        detail: it.detail,
        documentation: docOf(it.documentation),
        sortText: it.sortText,
        filterText: it.filterText,
        range: it.textEdit ? toMonacoRange(it.textEdit.range) : defaultRange,
      }));
      return { suggestions, incomplete };
    },
  });

  const hover = monaco.languages.registerHoverProvider(languages, {
    async provideHover(model: editor.ITextModel, position: Position) {
      if (!isTracked(model)) return null;
      const res = await getClient().request<LspHover | null>('textDocument/hover', docPos(model, position)).catch(() => null);
      if (!res || !res.contents) return null;
      const contents = hoverContents(res.contents).map((value) => ({ value }));
      if (contents.length === 0) return null;
      return { contents, range: res.range ? toMonacoRange(res.range) : undefined };
    },
  });

  const definition = monaco.languages.registerDefinitionProvider(languages, {
    async provideDefinition(model: editor.ITextModel, position: Position) {
      if (!isTracked(model)) return null;
      const res = await getClient()
        .request<LspLocation | LspLocation[] | null>('textDocument/definition', docPos(model, position))
        .catch(() => null);
      if (!res) return null;
      const locs = Array.isArray(res) ? res : [res];
      const prefix = rootUri + '/';
      const defs: languages.Location[] = [];
      for (const l of locs) {
        const uri = l.uri ?? l.targetUri;
        const range = l.range ?? l.targetSelectionRange ?? l.targetRange;
        if (!uri || !range || !uri.startsWith(prefix)) continue; // same-project targets only
        defs.push({ uri: monaco.Uri.parse(uri.slice(prefix.length)), range: toMonacoRange(range) });
      }
      return defs;
    },
  });

  return [completion, hover, definition];
}
