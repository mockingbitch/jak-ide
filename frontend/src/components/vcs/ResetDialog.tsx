import { useState } from 'react';
import { gitReset, type ResetMode } from '../../api';
import { toast } from '../../lib/toastStore';
import { IconClose } from '../icons';

interface ResetOption {
  readonly mode: ResetMode;
  readonly label: string;
  readonly hint: string;
  readonly danger?: boolean;
}

const OPTIONS: readonly ResetOption[] = [
  { mode: 'soft', label: 'Soft', hint: 'Keep the index and working tree — only move HEAD.' },
  { mode: 'mixed', label: 'Mixed', hint: 'Keep the working tree, reset the index (default).' },
  { mode: 'hard', label: 'Hard', hint: 'Discard ALL uncommitted changes — this cannot be undone.', danger: true },
];

/** PhpStorm-style "Reset current branch to…" dialog. Chooses the reset mode and
 *  a target (defaults to HEAD, or a commit hash when launched from history) and
 *  runs `git reset`. Hard reset always confirms first because it is destructive. */
export function ResetDialog({ target, onClose, onDone }: { target?: string; onClose: () => void; onDone: () => void }) {
  const [targetText, setTargetText] = useState(target?.trim() || 'HEAD');
  const [mode, setMode] = useState<ResetMode>('mixed');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doReset = async () => {
    if (busy) return;
    const tgt = targetText.trim() || 'HEAD';
    if (mode === 'hard') {
      const ok = window.confirm(
        `Hard reset "${tgt}"\n\n` +
          'This will PERMANENTLY DISCARD every uncommitted change in your ' +
          'working tree and index. Lost changes cannot be recovered.\n\nContinue?',
      );
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    try {
      await gitReset(mode, tgt);
      toast('success', `Reset (${mode}) to ${tgt}`);
      onDone();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast('error', msg);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Reset Current Branch</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="prompt-field">
            <span>Reset to</span>
            <input
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="HEAD"
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
          </label>
          {OPTIONS.map((opt) => (
            <label
              key={opt.mode}
              className="prompt-check"
              style={{ alignItems: 'flex-start', color: opt.danger ? 'var(--danger)' : undefined }}
            >
              <input
                type="radio"
                name="reset-mode"
                checked={mode === opt.mode}
                onChange={() => setMode(opt.mode)}
                disabled={busy}
              />
              <span>
                <strong>{opt.label}</strong>
                <span style={{ display: 'block', opacity: 0.85 }}>{opt.hint}</span>
              </span>
            </label>
          ))}
          {mode === 'hard' && (
            <div className="git-error">
              Warning: a hard reset permanently deletes all uncommitted changes in the working tree and index.
            </div>
          )}
          {err && <div className="git-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <span className="fp-actions">
            <button onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="primary" onClick={doReset} disabled={busy}>
              {busy ? 'Resetting…' : 'Reset'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
