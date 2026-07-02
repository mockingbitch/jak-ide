import type { Monaco } from '@monaco-editor/react';
import { useStore } from '../store';
import { getFile } from '../api';
import { getEditor } from './editorRegistry';

/** Open `path` as a tab and reveal a 1-based (line, col) in the active group's editor.
 *  The reveal retries across a few animation frames because Monaco swaps the model
 *  asynchronously after `openTab` (or mounts fresh into an empty group). Shared by the
 *  Find/Problems "open at" hook and by LSP go-to-definition/implementation navigation. */
export async function openFileAndReveal(monaco: Monaco, path: string, line?: number, col = 1): Promise<void> {
  const f = await getFile(path);
  useStore.getState().openTab({ path: f.path, content: f.content, dirty: false });
  if (!line) return;

  const want = monaco.Uri.parse(path).toString();
  let tries = 0;
  const reveal = () => {
    const ed = getEditor(useStore.getState().activeGroupId);
    const model = ed?.getModel();
    if (ed && model && model.uri.toString() === want) {
      const target = Math.min(line, model.getLineCount());
      ed.revealLineInCenter(target);
      ed.setPosition({ lineNumber: target, column: col });
      ed.focus();
      return;
    }
    if (tries++ < 40) requestAnimationFrame(reveal);
  };
  requestAnimationFrame(reveal);
}
