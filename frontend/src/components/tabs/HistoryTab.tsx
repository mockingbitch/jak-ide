import { useStore } from '../../store';
import { gitCommitDiff } from '../../api';
import { basename } from '../../lib/lang';
import { IconClose } from '../icons';
import type { HistoryTab as HistoryTabType } from '../../types';

/** File history: list of commits; clicking one opens its diff as a new diff tab. */
export function HistoryTab({ tab, groupId }: { tab: HistoryTabType; groupId: string }) {
  const closeTab = useStore((s) => s.closeTab);
  const openGitDiff = useStore((s) => s.openGitDiff);
  return (
    <>
      <div className="git-diff-bar">
        <span>
          History — <b>{basename(tab.path)}</b>
        </span>
        <button className="icon-btn" title="Close" onClick={() => closeTab(tab.id, groupId)}>
          <IconClose size={15} />
        </button>
      </div>
      <div className="git-log">
        {tab.commits.map((c) => (
          <div
            key={c.hash}
            className="git-commit-row clickable"
            title="Show changes in this commit"
            onClick={async () => {
              try {
                openGitDiff(await gitCommitDiff(c.hash, tab.path));
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            <div className="git-commit-body">
              <div className="git-commit-subject">
                {c.refs && <span className="git-refs">{c.refs.split(', ')[0]}</span>}
                {c.subject}
              </div>
              <div className="git-commit-meta">
                <span className="git-commit-hash">{c.short}</span>
                {c.author} · {new Date(c.date).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        {tab.commits.length === 0 && <div className="git-clean">No history for this file.</div>}
      </div>
    </>
  );
}
