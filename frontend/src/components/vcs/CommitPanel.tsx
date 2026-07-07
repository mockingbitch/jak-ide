import type { CommitOptions } from '../../api';
import { IconArrowUp } from '../icons';

/** The commit message editor + options (amend / sign-off / no-verify) + the
 *  Commit / Commit & Push actions. Presentational — GitPanel owns the state and
 *  the commit/push handlers. Ctrl/Cmd+Enter commits, +Shift also pushes. */
export function CommitPanel({
  message,
  onMessageChange,
  opts,
  onToggleOpt,
  canCommit,
  selectedCount,
  hasConflicts,
  upstreamNull,
  onCommit,
  onCommitAndPush,
}: {
  message: string;
  onMessageChange: (v: string) => void;
  opts: CommitOptions;
  onToggleOpt: (k: keyof CommitOptions) => void;
  canCommit: boolean;
  selectedCount: number;
  hasConflicts: boolean;
  upstreamNull: boolean;
  onCommit: () => void;
  onCommitAndPush: () => void;
}) {
  return (
    <div className="git-commit">
      <textarea
        value={message}
        placeholder="Commit message  (Ctrl/Cmd+Enter · +Shift to push)"
        onChange={(e) => onMessageChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || !canCommit) return;
          e.preventDefault();
          if (e.shiftKey) onCommitAndPush();
          else onCommit();
        }}
      />
      <div className="git-commit-opts">
        <label title="Replace the last commit (--amend)">
          <input type="checkbox" checked={!!opts.amend} onChange={() => onToggleOpt('amend')} /> Amend
        </label>
        <label title="Add a Signed-off-by trailer (--signoff)">
          <input type="checkbox" checked={!!opts.signOff} onChange={() => onToggleOpt('signOff')} /> Sign-off
        </label>
        <label title="Skip pre-commit / commit-msg hooks (--no-verify)">
          <input type="checkbox" checked={!!opts.noVerify} onChange={() => onToggleOpt('noVerify')} /> No-verify
        </label>
      </div>
      <div className="git-commit-actions">
        <span className="muted">{selectedCount} selected</span>
        <div className="git-commit-btns">
          <button className="primary" disabled={!canCommit} onClick={onCommit}>
            Commit
          </button>
          <button
            className="git-commit-push"
            title={upstreamNull ? 'Commit, then publish this branch' : 'Commit, then push to upstream'}
            disabled={!canCommit}
            onClick={onCommitAndPush}
          >
            <IconArrowUp size={13} /> Commit &amp; Push
          </button>
        </div>
      </div>
      {hasConflicts && <div className="git-hint">Resolve conflicts before committing.</div>}
    </div>
  );
}
