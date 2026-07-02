import { useStore } from '../store';
import { getFile, saveFile, deleteFileApi } from '../api';

/** Shared Keep / Revert / open actions for a pending AI file edit. Used by the
 *  inline change cards in a chat answer and by the bulk Changes bar. */
export function useChangeActions() {
  const changes = useStore((s) => s.changes);
  const openTab = useStore((s) => s.openTab);
  const refreshTab = useStore((s) => s.refreshTab);
  const closeTab = useStore((s) => s.closeTab);
  const clearChange = useStore((s) => s.clearChange);

  // Open the file — FileEditorTab renders the before/after diff while it's pending.
  const open = async (p: string) => {
    try {
      const f = await getFile(p);
      openTab({ path: f.path, content: f.content, dirty: false });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const keep = (p: string) => clearChange(p);

  const revert = async (p: string) => {
    const entry = useStore.getState().changes[p];
    if (!entry) return;
    try {
      if (entry.created) {
        await deleteFileApi(p);
        closeTab(p);
      } else {
        await saveFile(p, entry.before);
        refreshTab(p, entry.before);
      }
      clearChange(p);
    } catch (e) {
      alert('Revert failed: ' + (e as Error).message);
    }
  };

  return { changes, open, keep, revert };
}
