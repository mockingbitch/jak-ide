import { useStore } from '../../store';
import { useChangeActions } from '../../hooks/useChangeActions';
import { ChatChangeCard } from './ChatChangeCard';

/** Cursor-style live list of the files the AI has edited this session — grows as
 *  `file_change` events stream in. Header shows the file count + total +/- lines;
 *  while the AI is still running it shows an "Editing…" spinner, and once done it
 *  offers batch Keep all / Revert all. Each row (ChatChangeCard) opens the diff and
 *  keeps/reverts that one file. */
export function ChatChanges({ busy }: { busy: boolean }) {
  const changes = useStore((s) => s.changes);
  const clearAllChanges = useStore((s) => s.clearAllChanges);
  const { revert } = useChangeActions();

  const paths = Object.keys(changes);
  if (paths.length === 0) return null;

  const additions = paths.reduce((n, p) => n + (changes[p].additions ?? 0), 0);
  const deletions = paths.reduce((n, p) => n + (changes[p].deletions ?? 0), 0);

  const revertAll = async () => {
    for (const p of Object.keys(changes)) await revert(p);
  };

  return (
    <div className="chat-changes">
      <div className="chat-changes-head">
        <span className="chat-changes-title">
          {paths.length} file{paths.length === 1 ? '' : 's'} changed
          {(additions > 0 || deletions > 0) && (
            <span className="chg-stat">
              {additions > 0 && <span className="chg-add">+{additions}</span>}
              {deletions > 0 && <span className="chg-del">−{deletions}</span>}
            </span>
          )}
        </span>
        {busy ? (
          <span className="chat-changes-editing">
            <span className="chat-changes-spin" />
            Editing…
          </span>
        ) : (
          <span className="chat-changes-actions">
            <button className="chat-link" onClick={clearAllChanges}>
              Keep all
            </button>
            <button className="chat-link danger" onClick={revertAll}>
              Revert all
            </button>
          </span>
        )}
      </div>
      <div className="chat-changes-list">
        {paths.map((p) => (
          <ChatChangeCard key={p} path={p} created={changes[p].created} />
        ))}
      </div>
    </div>
  );
}
