import { useChangeActions } from '../../hooks/useChangeActions';
import { FileIcon } from '../FileIcon';
import { IconCheck } from '../icons';

const base = (p: string) => p.split('/').pop() ?? p;

/** Inline card for one AI file edit, shown right in the answer: open the diff, Keep,
 *  or Revert. Once resolved (no longer in store.changes) it shows a settled state. */
export function ChatChangeCard({ path, created }: { path: string; created?: boolean }) {
  const { changes, open, keep, revert } = useChangeActions();
  const pending = !!changes[path];

  return (
    <div className={'chat-change-card' + (pending ? '' : ' resolved')}>
      <span className="chg-verb">{created ? '＋' : '✎'}</span>
      <button className="chg-path" title={path} onClick={() => open(path)}>
        <FileIcon name={base(path)} />
        <span className="chg-name">{base(path)}</span>
      </button>
      {pending ? (
        <span className="chg-btns">
          <button className="chat-link" onClick={() => keep(path)}>
            Keep
          </button>
          <button className="chat-link danger" onClick={() => revert(path)}>
            Revert
          </button>
        </span>
      ) : (
        <span className="chg-kept" title="Kept">
          <IconCheck size={12} /> kept
        </span>
      )}
    </div>
  );
}
