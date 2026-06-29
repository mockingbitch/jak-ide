import { useMemo } from 'react';
import { useRunStore } from '../lib/runStore';
import { parseProblems, type Problem } from '../lib/problems';

// Shared single-entry cache so the two call sites (the bottom-bar badge in App and
// the ProblemsPanel) parse a given output only once, not twice per render.
let cache: { output: string; problems: Problem[] } | null = null;

function problemsFor(output: string): Problem[] {
  if (cache && cache.output === output) return cache.problems;
  const problems = parseProblems(output);
  cache = { output, problems };
  return problems;
}

/** Diagnostics derived from the Run tool window's captured output (no LSP yet). */
export function useProblems(): Problem[] {
  const output = useRunStore((s) => s.output);
  return useMemo(() => problemsFor(output), [output]);
}
