// Minimal LSP types + pure conversions to Monaco. Kept framework-light (only
// `import type` from monaco-editor) so the mapping logic stays unit-testable.
import type { editor } from 'monaco-editor';

export interface LspPosition {
  line: number; // 0-based
  character: number; // 0-based (UTF-16)
}
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}
export interface LspDiagnostic {
  range: LspRange;
  severity?: number; // 1 Error, 2 Warning, 3 Information, 4 Hint
  code?: string | number;
  source?: string;
  message: string;
}

// Monaco MarkerSeverity: Hint=1, Info=2, Warning=4, Error=8 (stable constants).
export function markerSeverity(lsp: number | undefined): number {
  switch (lsp) {
    case 2:
      return 4; // warning
    case 3:
      return 2; // info
    case 4:
      return 1; // hint
    default:
      return 8; // error (also LSP 1)
  }
}

/** LSP range (0-based) → Monaco range (1-based). */
export function toMonacoRange(r: LspRange): {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
} {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

export function diagnosticToMarker(d: LspDiagnostic): editor.IMarkerData {
  const r = toMonacoRange(d.range);
  return {
    severity: markerSeverity(d.severity),
    startLineNumber: r.startLineNumber,
    startColumn: r.startColumn,
    endLineNumber: r.endLineNumber,
    endColumn: r.endColumn,
    message: d.message,
    source: d.source,
    code: d.code != null ? String(d.code) : undefined,
  };
}

/** Monaco position (1-based) → LSP position (0-based). */
export function positionToLsp(p: { lineNumber: number; column: number }): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

// LSP CompletionItemKind (1-25) → the matching Monaco CompletionItemKind enum *name*
// (the caller looks the name up on the runtime monaco enum, whose numeric values differ).
const COMPLETION_KIND_NAME: Record<number, string> = {
  1: 'Text', 2: 'Method', 3: 'Function', 4: 'Constructor', 5: 'Field', 6: 'Variable',
  7: 'Class', 8: 'Interface', 9: 'Module', 10: 'Property', 11: 'Unit', 12: 'Value',
  13: 'Enum', 14: 'Keyword', 15: 'Snippet', 16: 'Color', 17: 'File', 18: 'Reference',
  19: 'Folder', 20: 'EnumMember', 21: 'Constant', 22: 'Struct', 23: 'Event',
  24: 'Operator', 25: 'TypeParameter',
};
export function completionKindName(n: number | undefined): string {
  return (n != null && COMPLETION_KIND_NAME[n]) || 'Property';
}

/** Normalise LSP hover contents (string | MarkedString | MarkupContent | array) to
 *  an array of markdown strings for Monaco. */
export function hoverContents(contents: unknown): string[] {
  const one = (c: unknown): string | null => {
    if (typeof c === 'string') return c;
    if (c && typeof c === 'object') {
      const o = c as { value?: unknown; language?: unknown };
      if (typeof o.value === 'string') {
        return typeof o.language === 'string' ? '```' + o.language + '\n' + o.value + '\n```' : o.value;
      }
    }
    return null;
  };
  const arr = Array.isArray(contents) ? contents : [contents];
  return arr.map(one).filter((s): s is string => s !== null && s.length > 0);
}

/** Map a file extension to the LSP languageId the server expects (JSX/TSX matter). */
export function lspLanguageId(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescriptreact';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'jsx':
      return 'javascriptreact';
    case 'php':
    case 'phtml':
      return 'php';
    case 'py':
    case 'pyi':
      return 'python';
    case 'go':
      return 'go';
    default:
      return 'plaintext';
  }
}

/** Which language server (the `/ws/lsp?lang=` value) handles a file, or null. One
 *  server per family: ts/tsx/js/jsx all go to the TypeScript server. */
export function clientLang(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'typescript';
    case 'php':
    case 'phtml':
      return 'php';
    case 'py':
    case 'pyi':
      return 'python';
    case 'go':
      return 'go';
    default:
      return null;
  }
}
