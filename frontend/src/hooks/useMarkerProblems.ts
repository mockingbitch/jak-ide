import { useEffect, useState } from 'react';
import { useMonaco } from '@monaco-editor/react';
import { markerToProblem, type Problem } from '../lib/problems';

/** Live problems from Monaco markers (LSP diagnostics), updated as markers change. */
export function useMarkerProblems(): Problem[] {
  const monaco = useMonaco();
  const [problems, setProblems] = useState<Problem[]>([]);

  useEffect(() => {
    if (!monaco) return;
    const refresh = () => setProblems(monaco.editor.getModelMarkers({}).map(markerToProblem));
    refresh();
    const sub = monaco.editor.onDidChangeMarkers(refresh);
    return () => sub.dispose();
  }, [monaco]);

  return problems;
}
