import { useMemo } from 'react';
import { useStore } from '../store';
import { useAllProblems } from '../hooks/useProblems';
import { useOpenFileAt } from '../hooks/useOpenFileAt';
import { FileIcon } from './FileIcon';
import type { Problem, Severity } from '../lib/problems';

const baseOf = (p: string) => p.split('/').pop() ?? p;
const SEV_GLYPH: Record<Severity, string> = { error: '✕', warning: '!', info: 'i' };

interface FileProblems {
  readonly file: string;
  readonly items: readonly Problem[];
}

function groupByFile(problems: readonly Problem[]): FileProblems[] {
  const order: string[] = [];
  const byFile = new Map<string, Problem[]>();
  for (const p of problems) {
    let arr = byFile.get(p.file);
    if (!arr) {
      arr = [];
      byFile.set(p.file, arr);
      order.push(p.file);
    }
    arr.push(p);
  }
  return order.map((file) => ({ file, items: byFile.get(file) ?? [] }));
}

export function ProblemsPanel() {
  const problems = useAllProblems();
  const projectRoot = useStore((s) => s.projectRoot);
  const openFileAt = useOpenFileAt();
  const groups = useMemo(() => groupByFile(problems), [problems]);

  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;

  // Compiler/linter paths may be absolute or `./`-prefixed; map back to a project-relative path.
  const toRel = (f: string): string => {
    let p = f;
    if (projectRoot && p.startsWith(projectRoot + '/')) p = p.slice(projectRoot.length + 1);
    if (p.startsWith('./')) p = p.slice(2);
    return p;
  };

  const open = (p: Problem) => {
    const rel = toRel(p.file);
    // An absolute path that isn't under the project root would be silently remapped
    // under root by the server's path resolver → wrong file. Refuse instead.
    if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) {
      alert(`This problem is in a file outside the project:\n${p.file}`);
      return;
    }
    openFileAt(rel, p.line, p.col ?? 1).catch((e) => alert((e as Error).message));
  };

  return (
    <div className="prob-panel">
      <div className="tw-header">
        <span className="tw-title">Problems</span>
        {problems.length > 0 && (
          <span className="prob-counts">
            <span className="prob-c error">✕ {errors}</span>
            <span className="prob-c warning">! {warnings}</span>
          </span>
        )}
      </div>

      {problems.length === 0 ? (
        <div className="prob-empty">
          No problems detected. Live diagnostics from the language server appear here as you edit, and you can
          also run a build or linter in the <b>Run</b> tab (e.g. <code>tsc --noEmit</code>, <code>cargo check</code>,{' '}
          <code>eslint .</code>) to surface its output here.
        </div>
      ) : (
        <div className="prob-list">
          {groups.map((g) => (
            <div className="prob-group" key={g.file}>
              <div className="prob-file">
                <FileIcon name={baseOf(g.file)} />
                <span className="prob-file-name">{baseOf(g.file)}</span>
                <span className="prob-file-dir">{toRel(g.file)}</span>
                <span className="prob-file-count">{g.items.length}</span>
              </div>
              {g.items.map((p, i) => (
                <div className={'prob-row ' + p.severity} key={`${p.line}:${p.col}:${i}`} onClick={() => open(p)}>
                  <span className={'prob-sev ' + p.severity} title={p.severity}>
                    {SEV_GLYPH[p.severity]}
                  </span>
                  <span className="prob-msg">{p.message}</span>
                  <span className="prob-loc">
                    {p.line}
                    {p.col != null ? `:${p.col}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
