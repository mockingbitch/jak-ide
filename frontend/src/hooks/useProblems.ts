import { useMemo } from 'react';
import { useRunStore } from '../lib/runStore';
import { parseProblems, mergeProblems, type Problem } from '../lib/problems';
import { useMarkerProblems } from './useMarkerProblems';

// Shared single-entry cache so the two call sites (the bottom-bar badge in App and
// the ProblemsPanel) parse a given output only once, not twice per render.
let cache: { output: string; problems: Problem[] } | null = null;

function problemsFor(output: string): Problem[] {
  if (cache && cache.output === output) return cache.problems;
  const problems = parseProblems(output);
  cache = { output, problems };
  return problems;
}

/** Diagnostics parsed from the Run tool window's captured output. */
export function useProblems(): Problem[] {
  const output = useRunStore((s) => s.output);
  return useMemo(() => problemsFor(output), [output]);
}

/** All problems for the Problems panel: live LSP markers + parsed run output. */
export function useAllProblems(): Problem[] {
  const run = useProblems();
  const markers = useMarkerProblems();
  return useMemo(() => mergeProblems(markers, run), [markers, run]);
}
