import { describe, it, expect } from 'vitest';
import { markerSeverity, toMonacoRange, diagnosticToMarker, lspLanguageId, positionToLsp, completionKindName, hoverContents, clientLang } from './protocol';

describe('lsp protocol conversions', () => {
  it('maps LSP severity to Monaco MarkerSeverity', () => {
    expect(markerSeverity(1)).toBe(8); // error
    expect(markerSeverity(2)).toBe(4); // warning
    expect(markerSeverity(3)).toBe(2); // info
    expect(markerSeverity(4)).toBe(1); // hint
    expect(markerSeverity(undefined)).toBe(8); // default error
  });

  it('converts 0-based LSP range to 1-based Monaco range', () => {
    expect(toMonacoRange({ start: { line: 0, character: 0 }, end: { line: 2, character: 5 } })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 6,
    });
  });

  it('builds a Monaco marker from an LSP diagnostic', () => {
    const m = diagnosticToMarker({
      range: { start: { line: 4, character: 2 }, end: { line: 4, character: 7 } },
      severity: 1,
      code: 2304,
      source: 'ts',
      message: "Cannot find name 'x'.",
    });
    expect(m).toEqual({
      severity: 8,
      startLineNumber: 5,
      startColumn: 3,
      endLineNumber: 5,
      endColumn: 8,
      message: "Cannot find name 'x'.",
      source: 'ts',
      code: '2304',
    });
  });

  it('derives the LSP languageId from the extension (JSX/TSX aware)', () => {
    expect(lspLanguageId('a.ts')).toBe('typescript');
    expect(lspLanguageId('a.tsx')).toBe('typescriptreact');
    expect(lspLanguageId('a.jsx')).toBe('javascriptreact');
    expect(lspLanguageId('a.mjs')).toBe('javascript');
    expect(lspLanguageId('a.php')).toBe('php');
    expect(lspLanguageId('a.py')).toBe('python');
    expect(lspLanguageId('a.go')).toBe('go');
    expect(lspLanguageId('a.css')).toBe('plaintext');
  });

  it('routes a file to the right language server family', () => {
    expect(clientLang('a.ts')).toBe('typescript');
    expect(clientLang('a.tsx')).toBe('typescript');
    expect(clientLang('a.jsx')).toBe('typescript');
    expect(clientLang('a.php')).toBe('php');
    expect(clientLang('a.py')).toBe('python');
    expect(clientLang('a.go')).toBe('go');
    expect(clientLang('a.css')).toBeNull();
  });

  it('converts Monaco position to 0-based LSP position', () => {
    expect(positionToLsp({ lineNumber: 5, column: 3 })).toEqual({ line: 4, character: 2 });
  });

  it('maps completion kinds to Monaco enum names with a fallback', () => {
    expect(completionKindName(3)).toBe('Function');
    expect(completionKindName(7)).toBe('Class');
    expect(completionKindName(25)).toBe('TypeParameter');
    expect(completionKindName(undefined)).toBe('Property');
    expect(completionKindName(999)).toBe('Property');
  });

  it('normalises hover contents (string, marked-string, markup, array)', () => {
    expect(hoverContents('hello')).toEqual(['hello']);
    expect(hoverContents({ language: 'ts', value: 'const x' })).toEqual(['```ts\nconst x\n```']);
    expect(hoverContents({ kind: 'markdown', value: '**hi**' })).toEqual(['**hi**']);
    expect(hoverContents(['a', { language: 'ts', value: 'b' }])).toEqual(['a', '```ts\nb\n```']);
    expect(hoverContents([''])).toEqual([]);
  });
});
