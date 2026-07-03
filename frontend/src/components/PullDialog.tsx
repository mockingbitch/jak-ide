import { useEffect, useState } from 'react';
import { gitBranches, gitPull } from '../api';
import { IconClose } from './icons';

/** PhpStorm-style Pull dialog: choose the remote + branch to pull (and merge vs
 *  rebase), instead of a bare `git pull`. Remotes/branches are derived from the
 *  remote refs (e.g. "origin/main"). */
export function PullDialog({ current, onClose, onDone }: { current: string | null; onClose: () => void; onDone: () => void }) {
  const [byRemote, setByRemote] = useState<Record<string, string[]>>({});
  const [remote, setRemote] = useState('');
  const [branch, setBranch] = useState('');
  const [rebase, setRebase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickDefaults = (map: Record<string, string[]>, rem: string) => {
    const brs = map[rem] ?? [];
    setBranch(current && brs.includes(current) ? current : brs[0] ?? current ?? '');
  };

  useEffect(() => {
    gitBranches()
      .then((b) => {
        const map: Record<string, string[]> = {};
        for (const r of b.remote) {
          const i = r.indexOf('/');
          if (i < 0) continue;
          (map[r.slice(0, i)] ??= []).push(r.slice(i + 1));
        }
        setByRemote(map);
        const rems = Object.keys(map);
        const def = rems.includes('origin') ? 'origin' : rems[0] ?? '';
        setRemote(def);
        pickDefaults(map, def);
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remotes = Object.keys(byRemote);
  const branches = byRemote[remote] ?? [];

  const onRemote = (r: string) => {
    setRemote(r);
    pickDefaults(byRemote, r);
  };

  const pull = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await gitPull({ remote: remote || undefined, branch: branch || undefined, rebase });
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Pull Changes</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="prompt-field">
            <span>Remote</span>
            <select value={remote} onChange={(e) => onRemote(e.target.value)} disabled={busy || remotes.length === 0}>
              {remotes.length === 0 && <option value="">(no remotes)</option>}
              {remotes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="prompt-field">
            <span>Branch</span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={busy || branches.length === 0}>
              {branches.length === 0 && <option value="">(current tracking branch)</option>}
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="prompt-check">
            <input type="checkbox" checked={rebase} onChange={(e) => setRebase(e.target.checked)} disabled={busy} />
            Rebase local commits on top (instead of merge)
          </label>
          {err && <div className="git-error">{err}</div>}
        </div>
        <div className="modal-footer">
          <span className="fp-actions">
            <button onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="primary" onClick={pull} disabled={busy}>
              {busy ? 'Pulling…' : 'Pull'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
