import { useEffect, useState } from 'react';
import { gitStashApply, gitStashDrop, gitStashList, gitStashPop, gitStashPush, gitStashShow, type StashEntry } from '../../api';
import { toast } from '../../lib/toastStore';
import { IconClose } from '../icons';

const refFor = (index: number) => `stash@{${index}}`;

/** PhpStorm-style Stash manager. Lists existing stashes and lets you create,
 *  apply, pop, drop, and preview them. Dropping is destructive and confirms
 *  first. Every mutation reloads the list, toasts the result, and calls
 *  onDone() so the parent can refresh the git status. */
export function StashDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [list, setList] = useState<readonly StashEntry[]>([]);
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [keepIndex, setKeepIndex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const reload = async () => {
    try {
      setList(await gitStashList());
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  useEffect(() => {
    void reload();
     
  }, []);

  /** Run a mutating stash action, then reload + notify the parent + toast. */
  const mutate = async (action: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await reload();
      onDone();
      toast('success', ok);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await gitStashPush({ message: message.trim() || undefined, includeUntracked, keepIndex });
      setMessage('');
      await reload();
      onDone();
      toast('success', 'Changes stashed');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = (s: StashEntry) => void mutate(() => gitStashApply(refFor(s.index)), `Applied ${refFor(s.index)}`);
  const pop = (s: StashEntry) => void mutate(() => gitStashPop(refFor(s.index)), `Popped ${refFor(s.index)}`);

  const drop = (s: StashEntry) => {
    const ok = window.confirm(`Drop ${refFor(s.index)}?\n\n"${s.message}"\n\nThis discards the stash permanently and cannot be undone.`);
    if (!ok) return;
    void mutate(() => gitStashDrop(refFor(s.index)), `Dropped ${refFor(s.index)}`);
  };

  const show = async (s: StashEntry) => {
    if (busy) return;
    setBusy(true);
    try {
      const { patch } = await gitStashShow(refFor(s.index));
      setPreview(patch.trim() ? patch : '(no changes in this stash)');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal prompt-dialog" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Stashes</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="prompt-field">
            <span>New stash message</span>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="(optional) WIP on feature…"
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="prompt-check">
            <input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} disabled={busy} />
            Include untracked files
          </label>
          <label className="prompt-check">
            <input type="checkbox" checked={keepIndex} onChange={(e) => setKeepIndex(e.target.checked)} disabled={busy} />
            Keep staged changes in the index
          </label>
          <span className="fp-actions">
            <button className="primary" onClick={create} disabled={busy}>
              {busy ? 'Working…' : 'Stash'}
            </button>
          </span>

          <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />

          {list.length === 0 ? (
            <div className="muted">No stashes.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map((s) => (
                <div
                  key={s.index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-3)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--code-font, ui-monospace, monospace)', fontSize: 12 }}>{refFor(s.index)}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      on {s.branch}
                      {s.message ? ` · ${s.message}` : ''}
                    </div>
                  </div>
                  <button onClick={() => apply(s)} disabled={busy} title="Apply and keep the stash">
                    Apply
                  </button>
                  <button onClick={() => pop(s)} disabled={busy} title="Apply and drop the stash">
                    Pop
                  </button>
                  <button onClick={() => show(s)} disabled={busy} title="Preview the diff">
                    Show
                  </button>
                  <button onClick={() => drop(s)} disabled={busy} title="Delete the stash" style={{ color: 'var(--danger)' }}>
                    Drop
                  </button>
                </div>
              ))}
            </div>
          )}

          {preview !== null && (
            <div className="prompt-field">
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Stash contents
                <button onClick={() => setPreview(null)} title="Hide preview">
                  Hide
                </button>
              </span>
              <pre className="clone-log">{preview}</pre>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="fp-actions">
            <button onClick={onClose} disabled={busy}>
              Close
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
