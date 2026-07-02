import { useCallback } from 'react';
import { useMonaco } from '@monaco-editor/react';
import { openFileAndReveal } from '../lib/openFileAt';

/** Open a file as a tab and reveal a 1-based (line, col). Thin React wrapper over
 *  `openFileAndReveal` (which does the async open + framed reveal). */
export function useOpenFileAt(): (path: string, line?: number, col?: number) => Promise<void> {
  const monaco = useMonaco();
  return useCallback(
    async (path, line, col = 1) => {
      if (!monaco) return;
      await openFileAndReveal(monaco, path, line, col);
    },
    [monaco]
  );
}
