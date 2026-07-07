import { useEffect, useState } from 'react';
import { gitAddRemote, gitRemotes, gitRemoveRemote, gitSetRemoteUrl, type GitRemote } from '../../api';
import { toast } from '../../lib/toastStore';
import { IconClose } from '../icons';

/** PhpStorm-style Git Remotes manager: list remotes, edit each URL, remove a
 *  remote, or add a new one. Credentials/tokens are handled by the user's git
 *  credential helper and are never stored by JakIDE. */
export function RemoteSettings({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    gitRemotes()
      .then((rs) => {
        setRemotes(rs);
        setDrafts(Object.fromEntries(rs.map((r) => [r.name, r.url])));
      })
      .catch((e) => toast('error', (e as Error).message));
  };

  useEffect(() => {
    load();
     
  }, []);

  /** Run a mutating remote op, then reload + notify the parent + toast. */
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      load();
      onDone();
      toast('success', ok);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveUrl = (r: GitRemote) => {
    const url = (drafts[r.name] ?? '').trim();
    if (!url || url === r.url) return;
    void run(() => gitSetRemoteUrl(r.name, url), `Updated URL for "${r.name}"`);
  };

  const remove = (name: string) => {
    if (!window.confirm(`Remove remote "${name}"?\n\nThis only detaches it locally; nothing on the server is deleted.`)) return;
    void run(() => gitRemoveRemote(name), `Removed remote "${name}"`);
  };

  const add = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    void run(async () => {
      await gitAddRemote(name, url);
      setNewName('');
      setNewUrl('');
    }, `Added remote "${name}"`);
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Git Remotes</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">
          {remotes.length === 0 && <div className="muted">No remotes configured yet.</div>}
          {remotes.map((r) => (
            <div key={r.name} className="prompt-field">
              <span>{r.name}</span>
              <span className="fp-actions">
                <input
                  value={drafts[r.name] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.name]: e.target.value }))}
                  spellCheck={false}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <button onClick={() => saveUrl(r)} disabled={busy || (drafts[r.name] ?? '').trim() === r.url || !(drafts[r.name] ?? '').trim()}>
                  Save URL
                </button>
                <button className="danger" onClick={() => remove(r.name)} disabled={busy}>
                  Remove
                </button>
              </span>
            </div>
          ))}

          <div className="prompt-field">
            <span>Add remote</span>
            <span className="fp-actions">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="name (e.g. origin)"
                spellCheck={false}
                disabled={busy}
                style={{ flex: '0 0 140px' }}
              />
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://… or git@…"
                spellCheck={false}
                disabled={busy}
                style={{ flex: 1 }}
              />
              <button className="primary" onClick={add} disabled={busy || !newName.trim() || !newUrl.trim()}>
                Add
              </button>
            </span>
          </div>

          <div className="muted">
            Credentials and tokens are handled by your git credential helper and are never stored by JakIDE.
          </div>
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
