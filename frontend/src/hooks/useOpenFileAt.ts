import { useCallback } from 'react';
import { useMonaco } from '@monaco-editor/react';
import { useStore } from '../store';
import { getFile } from '../api';
import { getEditor } from '../lib/editorRegistry';

/** Open a file as a tab and reveal a 1-based (line, col). The reveal retries across
 *  a few animation frames because the active group's Monaco editor swaps its model
 *  asynchronously after `openTab` (or mounts fresh into an empty group). */
export function useOpenFileAt(): (path: string, line?: number, col?: number) => Promise<void> {
  const monaco = useMonaco();
  const openTab = useStore((s) => s.openTab);

  return useCallback(
    async (path, line, col = 1) => {
      const f = await getFile(path);
      openTab({ path: f.path, content: f.content, dirty: false });
      if (!line) return;

      const want = monaco?.Uri.parse(path).toString();
      let tries = 0;
      const reveal = () => {
        const ed = getEditor(useStore.getState().activeGroupId);
        const model = ed?.getModel();
        if (ed && model && (!want || model.uri.toString() === want)) {
          const target = Math.min(line, model.getLineCount());
          ed.revealLineInCenter(target);
          ed.setPosition({ lineNumber: target, column: col });
          ed.focus();
          return;
        }
        if (tries++ < 40) requestAnimationFrame(reveal);
      };
      requestAnimationFrame(reveal);
    },
    [monaco, openTab]
  );
}
