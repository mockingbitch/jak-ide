import { useState } from 'react';
import { gitCloneStreamUrl, openProjectApi } from '../api';
import { IconClose } from './icons';

/** Server-sent events streamed from the git-clone endpoint. */
type CloneStreamEvent =
  | { type: 'start'; target: string }
  | { type: 'progress'; text?: string }
  | { type: 'done'; path: string }
  | { type: 'error'; error?: string };

/** Clone a repository with live progress (SSE), then offer to open the clone. */
export function CloneDialog({ parentDefault, onClose }: { parentDefault: string; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState(parentDefault);
  const [name, setName] = useState('');
  const [log, setLog] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donePath, setDonePath] = useState<string | null>(null);

  const start = async () => {
    if (!url.trim() || running) return;
    setRunning(true);
    setError(null);
    setLog('');
    setDonePath(null);
    try {
      const resp = await fetch(gitCloneStreamUrl(url.trim(), parent.trim(), name.trim() || undefined));
      if (!resp.body) throw new Error('No response stream');
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';
        for (const ch of chunks) {
          const line = ch.trim();
          if (!line.startsWith('data:')) continue;
          let evt: CloneStreamEvent;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === 'start') setLog((l) => l + `Cloning into ${evt.target}…\n`);
          else if (evt.type === 'progress') setLog((l) => l + (evt.text ?? ''));
          else if (evt.type === 'done') {
            setDonePath(evt.path);
            setLog((l) => l + 'Done.\n');
          } else if (evt.type === 'error') setError(evt.error || 'clone failed');
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const openCloned = async () => {
    if (!donePath) return;
    try {
      await openProjectApi(donePath);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-overlay" onClick={running ? undefined : onClose}>
      <div className="modal clone-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Clone Repository</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="clone-field">
            <span>Repository URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git  or  /path/to/repo"
              spellCheck={false}
              disabled={running}
              autoFocus
            />
          </label>
          <label className="clone-field">
            <span>Parent directory</span>
            <input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} disabled={running} />
          </label>
          <label className="clone-field">
            <span>Folder name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="(derived from URL)"
              spellCheck={false}
              disabled={running}
            />
          </label>
          {(log || error) && (
            <pre className="clone-log">
              {log}
              {error ? '\nError: ' + error : ''}
            </pre>
          )}
        </div>
        <div className="modal-footer">
          <span className="muted">Uses your system git (works offline for local paths).</span>
          <span className="fp-actions">
            <button onClick={onClose} disabled={running}>
              Cancel
            </button>
            {donePath ? (
              <button className="primary" onClick={openCloned}>
                Open clone
              </button>
            ) : (
              <button className="primary" onClick={start} disabled={running || !url.trim()}>
                {running ? 'Cloning…' : 'Clone'}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
