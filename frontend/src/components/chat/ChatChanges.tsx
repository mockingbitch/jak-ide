import { useStore } from '../../store';
import { useChangeActions } from '../../hooks/useChangeActions';

/** Bulk summary of pending AI file edits (per-file cards render inline in the answer;
 *  this bar adds Keep all / Revert all for batch handling). */
export function ChatChanges() {
  const changes = useStore((s) => s.changes);
  const clearAllChanges = useStore((s) => s.clearAllChanges);
  const { revert } = useChangeActions();

  const paths = Object.keys(changes);
  if (paths.length === 0) return null;

  const revertAll = async () => {
    for (const p of Object.keys(changes)) await revert(p);
  };

  return (
    <div className="chat-changes">
      <div className="chat-changes-head">
        <span>
          {paths.length} pending change{paths.length === 1 ? '' : 's'}
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
    </div>
  );
}
