import { useEffect, useState } from 'react';
import { browseDir, type BrowseResult } from '../api';
import { IconClose, IconArrowUp, IconFolderOpen, IconProject, IconChevronRight } from './icons';

/** Server-side directory browser used to pick a project folder. Works in the
 *  browser (web dev) and in Electron; in Electron it also offers the native
 *  OS dialog via the preload bridge. */
export function FolderPicker({ onClose, onPick }: { onClose: () => void; onPick: (path: string) => void }) {
  const [cwd, setCwd] = useState<string | undefined>(undefined); // undefined => home
  const [data, setData] = useState<BrowseResult | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const native = (window as any).jakide?.pickFolder as undefined | (() => Promise<string | null>);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    browseDir(cwd)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setManual(d.path);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [cwd]);

  const go = (p?: string | null) => {
    if (p) setCwd(p);
  };

  const useNative = async () => {
    try {
      const p = await native!();
      if (p) onPick(p);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="folder-picker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Open Folder</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose size={16} />
          </button>
        </div>

        <div className="fp-path">
          <button className="icon-btn" title="Parent folder" disabled={!data?.parent} onClick={() => go(data?.parent)}>
            <IconArrowUp size={16} />
          </button>
          <input
            className="fp-input"
            value={manual}
            spellCheck={false}
            placeholder="/absolute/path/to/project"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(manual.trim());
            }}
          />
        </div>

        <div className="fp-list">
          {loading && <div className="fp-empty">Loading…</div>}
          {error && !loading && <div className="fp-empty">{error}</div>}
          {!loading && !error && data && data.entries.length === 0 && (
            <div className="fp-empty">No sub-folders here.</div>
          )}
          {!loading &&
            !error &&
            data?.entries.map((e) => (
              <button key={e.path} className="fp-item" onClick={() => go(e.path)} title={e.path}>
                <IconFolderOpen size={16} />
                <span className="fp-name">{e.name}</span>
                <IconChevronRight size={14} className="fp-go" />
              </button>
            ))}
        </div>

        <div className="modal-footer">
          {native ? (
            <button className="link" onClick={useNative}>
              Use system dialog…
            </button>
          ) : (
            <span className="muted">Browse to a folder, then open it.</span>
          )}
          <span className="fp-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!data} onClick={() => data && onPick(data.path)}>
              <IconProject size={15} /> Open this folder
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
