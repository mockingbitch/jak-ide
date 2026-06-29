// Without an LSP, the Problems panel derives diagnostics by parsing the Run tool
// window's captured output. We recognise the common compiler/linter formats of the
// project's stack (TypeScript, Rust/cargo, ESLint, plus a generic path:line:col).
// Pure + testable. This is light text parsing of already-in-memory output, so it
// stays on the client (no Rust round-trip needed). Best-effort: it favours not
// inventing false problems over catching every exotic format.

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  readonly file: string;
  readonly line: number;
  readonly col: number | null;
  readonly severity: Severity;
  readonly message: string;
}

const sev = (s: string | undefined): Severity =>
  s === 'warning' || s === 'warn' ? 'warning' : s === 'note' || s === 'info' || s === 'help' ? 'info' : 'error';

// tsc:  src/a.ts(12,5): error TS2304: Cannot find name 'x'.
const TSC = /^([^\s(][^(]*)\((\d+),(\d+)\):\s*(error|warning)\s+TS\d+:\s*(.*)$/;
// generic: path.ext:line:col: [severity:] message   (go, gcc/clang, many linters)
const GENERIC_COL = /^([^\s:]+\.[\w]+):(\d+):(\d+):\s*(?:(error|warning|note|info|help)\s*:?\s*)?(.*)$/;
// generic without a column: path.ext:line: [severity:] message
const GENERIC = /^([^\s:]+\.[\w]+):(\d+):\s*(?:(error|warning|note|info|help)\s*:?\s*)?(.*)$/;
// cargo/rustc severity line:  error[E0382]: borrow of moved value
const RUST_SEV = /^(error|warning)(?:\[[^\]]+\])?:\s+(.*)$/;
// cargo/rustc location line:   --> src/main.rs:10:5
const RUST_LOC = /^\s*-->\s+([^\s:]+):(\d+):(\d+)/;
// ESLint "stylish" file header: a bare path on its own line (only honoured when the
// next line is an ESLint row, so banners/semver/config names don't masquerade as files).
const ESLINT_FILE = /^([^\s:]+\.[\w]+)$/;
// ESLint "stylish" row:   12:5  error  Message text  rule-name
const ESLINT_ROW = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}[\w$/@-]+)?\s*$/;

const normFile = (f: string): string => f.replace(/\\/g, '/').replace(/^\.\//, '');

function nextNonEmpty(lines: string[], idx: number): string | null {
  for (let j = idx + 1; j < lines.length; j++) {
    if (lines[j].trim()) return lines[j];
  }
  return null;
}

/** Parse captured compiler/linter output into a de-duplicated problem list. */
export function parseProblems(output: string): Problem[] {
  const out: Problem[] = [];
  const seen = new Set<string>();
  // ESLint groups rows under a file header; cargo splits a diagnostic over a
  // severity line then a `-->` location. Both bits of state must be cleared by any
  // intervening matched diagnostic, or a later line mis-attaches to a stale file/msg.
  let eslintFile: string | null = null;
  let pendingRust: { severity: Severity; message: string } | null = null;

  const push = (file: string, line: number, col: number | null, severity: Severity, message: string) => {
    const f = normFile(file);
    const key = `${f}:${line}:${col}:${severity}:${message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ file: f, line, col, severity, message });
    }
  };

  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line) continue;

    let m: RegExpMatchArray | null;

    // cargo `-->` completes the pending severity (kept only across adjacent lines).
    if (pendingRust && (m = line.match(RUST_LOC))) {
      push(m[1], +m[2], +m[3], pendingRust.severity, pendingRust.message);
      pendingRust = null;
      continue;
    }
    if ((m = line.match(RUST_SEV))) {
      pendingRust = { severity: sev(m[1]), message: m[2] };
      eslintFile = null;
      continue;
    }
    if ((m = line.match(TSC))) {
      push(m[1], +m[2], +m[3], sev(m[4]), m[5]);
      pendingRust = null;
      eslintFile = null;
      continue;
    }
    if (eslintFile && (m = line.match(ESLINT_ROW))) {
      push(eslintFile, +m[1], +m[2], sev(m[3]), m[4].trim());
      pendingRust = null;
      continue;
    }
    if ((m = line.match(GENERIC_COL))) {
      push(m[1], +m[2], +m[3], sev(m[4]), m[5]);
      pendingRust = null;
      eslintFile = null;
      continue;
    }
    if ((m = line.match(GENERIC))) {
      push(m[1], +m[2], null, sev(m[3]), m[4]);
      pendingRust = null;
      eslintFile = null;
      continue;
    }
    // ESLint file header — only if the next non-empty line is actually an ESLint row.
    if ((m = line.match(ESLINT_FILE))) {
      const next = nextNonEmpty(lines, i);
      if (next !== null && ESLINT_ROW.test(next)) {
        eslintFile = m[1];
      }
    }
  }
  return out;
}
