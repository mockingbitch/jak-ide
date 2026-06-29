import { describe, it, expect } from 'vitest';
import { parseProblems, markerToProblem, mergeProblems } from './problems';

describe('parseProblems', () => {
  it('parses tsc diagnostics', () => {
    const out = "src/app.ts(12,5): error TS2304: Cannot find name 'x'.\nsrc/b.ts(1,1): warning TS6133: 'y' is declared but never used.";
    expect(parseProblems(out)).toEqual([
      { file: 'src/app.ts', line: 12, col: 5, severity: 'error', message: "Cannot find name 'x'." },
      { file: 'src/b.ts', line: 1, col: 1, severity: 'warning', message: "'y' is declared but never used." },
    ]);
  });

  it('parses cargo/rustc error + --> location across two lines', () => {
    const out = [
      'error[E0382]: borrow of moved value: `x`',
      '   --> src/main.rs:10:5',
      '    |',
      'warning: unused variable: `y`',
      '  --> src/lib.rs:3:9',
    ].join('\n');
    expect(parseProblems(out)).toEqual([
      { file: 'src/main.rs', line: 10, col: 5, severity: 'error', message: 'borrow of moved value: `x`' },
      { file: 'src/lib.rs', line: 3, col: 9, severity: 'warning', message: 'unused variable: `y`' },
    ]);
  });

  it('parses ESLint stylish output', () => {
    const out = ['src/store.ts', '  12:5   error    Unexpected console statement   no-console', '  20:1   warning  Missing semicolon              semi', ''].join('\n');
    expect(parseProblems(out)).toEqual([
      { file: 'src/store.ts', line: 12, col: 5, severity: 'error', message: 'Unexpected console statement' },
      { file: 'src/store.ts', line: 20, col: 1, severity: 'warning', message: 'Missing semicolon' },
    ]);
  });

  it('parses generic go-style path:line:col: message (defaults to error) and normalises ./', () => {
    const out = './cmd/main.go:42:6: undefined: foo';
    expect(parseProblems(out)).toEqual([{ file: 'cmd/main.go', line: 42, col: 6, severity: 'error', message: 'undefined: foo' }]);
  });

  it('ignores noise and de-dupes repeats', () => {
    const out = ['Compiling project...', 'https://example.com:80:5: not a file', 'a.ts(1,1): error TS1: dup', 'a.ts(1,1): error TS1: dup'].join('\n');
    expect(parseProblems(out)).toEqual([{ file: 'a.ts', line: 1, col: 1, severity: 'error', message: 'dup' }]);
  });

  it('does not leak rust pending message across an interleaved diagnostic', () => {
    const out = ['error[E0382]: borrow of moved value', 'src/note.ts:1:1: note: unrelated', '  --> src/main.rs:10:5'].join('\n');
    const got = parseProblems(out);
    // the --> must NOT inherit the rust message (the interleaved line cleared it)
    expect(got).toEqual([{ file: 'src/note.ts', line: 1, col: 1, severity: 'info', message: 'unrelated' }]);
  });

  it('does not attribute a later eslint-shaped row to a stale file after another tool ran', () => {
    const out = [
      'src/a.ts',
      '  1:1  error  real one  no-x',
      'error[E0382]: borrow',
      '  --> src/main.rs:10:5',
      '  9:9  warning  stale row  rule',
    ].join('\n');
    const got = parseProblems(out);
    // the trailing eslint-shaped row must NOT be pinned to src/a.ts (block ended)
    expect(got.some((p) => p.file === 'src/a.ts' && p.line === 9)).toBe(false);
    expect(got).toContainEqual({ file: 'src/a.ts', line: 1, col: 1, severity: 'error', message: 'real one' });
    expect(got).toContainEqual({ file: 'src/main.rs', line: 10, col: 5, severity: 'error', message: 'borrow' });
  });

  it('does not treat a version banner as an ESLint file header', () => {
    // a bare dotted token NOT followed by an eslint row is ignored
    expect(parseProblems('eslint.config.js\nAll files pass\n')).toEqual([]);
  });

  it('maps a Monaco marker (LSP diagnostic) to a Problem', () => {
    expect(
      markerToProblem({ resource: { path: '/src/a.ts' }, startLineNumber: 5, startColumn: 3, severity: 8, message: 'boom' })
    ).toEqual({ file: 'src/a.ts', line: 5, col: 3, severity: 'error', message: 'boom' });
    expect(markerToProblem({ resource: { path: 'b.ts' }, startLineNumber: 1, startColumn: 1, severity: 4, message: 'w' }).severity).toBe('warning');
    expect(markerToProblem({ resource: { path: 'b.ts' }, startLineNumber: 1, startColumn: 1, severity: 1, message: 'h' }).severity).toBe('info');
  });

  it('merges problem sources and de-dupes', () => {
    const a = [{ file: 'a.ts', line: 1, col: 1, severity: 'error' as const, message: 'x' }];
    const b = [
      { file: 'a.ts', line: 1, col: 1, severity: 'error' as const, message: 'x' }, // dup of a
      { file: 'a.ts', line: 2, col: 1, severity: 'warning' as const, message: 'y' },
    ];
    expect(mergeProblems(a, b)).toEqual([
      { file: 'a.ts', line: 1, col: 1, severity: 'error', message: 'x' },
      { file: 'a.ts', line: 2, col: 1, severity: 'warning', message: 'y' },
    ]);
  });
});
