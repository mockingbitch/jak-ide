import { useStore } from '../../store';
import { getFile, saveFile, deleteFileApi } from '../../api';

/** Pending AI file edits with per-file Keep / Revert (and bulk actions). */
export function ChatChanges() {
  const changes = useStore((s) => s.changes);
  const openTab = useStore((s) => s.openTab);
  const refreshTab = useStore((s) => s.refreshTab);
  const closeTab = useStore((s) => s.closeTab);
  const clearChange = useStore((s) => s.clearChange);
  const clearAllChanges = useStore((s) => s.clearAllChanges);

  const paths = Object.keys(changes);
  if (paths.length === 0) return null;

  const open = async (p: string) => {
    try {
      const f = await getFile(p);
      openTab({ path: f.path, content: f.content, dirty: false });
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const revert = async (p: string) => {
    const entry = changes[p];
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
  const revertAll = async () => {
    for (const p of Object.keys(changes)) await revert(p);
  };

  return (
    <div className="chat-changes">
      <div className="chat-changes-head">
        <span>
          Changes <b>({paths.length})</b>
        </span>
        <span className="chat-changes-actions">
          <button className="chat-link" onClick={clearAllChanges}>
            Keep all
          </button>
          <button className="chat-link danger" onClick={revertAll}>
            Revert all
          </button>
        </span>
      </div>
      {paths.map((p) => (
        <div key={p} className="chat-change-row">
          <span className="chat-change-path" title={p} onClick={() => open(p)}>
            {p}
          </span>
          <span className="chat-change-btns">
            <button className="chat-link" onClick={() => clearChange(p)}>
              Keep
            </button>
            <button className="chat-link danger" onClick={() => revert(p)}>
              Revert
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
