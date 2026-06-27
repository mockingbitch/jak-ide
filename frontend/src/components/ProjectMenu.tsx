import { useState } from 'react';
import { useStore } from '../store';
import { IconChevronDown, IconFolderOpen } from './icons';

/** Two-letter project initials, JetBrains-style (split on separators). */
function initials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const p = parts[0] ?? name;
  return (p.slice(0, 2) || '··').toUpperCase();
}

const baseName = (p: string) => p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'project';

/** Title-bar project chip with a dropdown: current project, recent projects
 *  (click to switch), and "Open Folder…". */
export function ProjectMenu() {
  const projectRoot = useStore((s) => s.projectRoot);
  const recents = useStore((s) => s.recents);
  const switchProject = useStore((s) => s.switchProject);
  const openFolderPicker = useStore((s) => s.openFolderPicker);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const name = baseName(projectRoot);
  const others = recents.filter((r) => r.path !== projectRoot);

  const doSwitch = async (dir: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await switchProject(dir);
    } catch (e) {
      alert('Could not open project: ' + (e as Error).message);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        className="proj-chip"
        onClick={() => setOpen((o) => !o)}
        title={projectRoot || 'Project'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="proj-badge">{initials(name)}</span>
        <span className="proj-name">{name}</span>
        <IconChevronDown size={14} className="proj-caret" />
      </button>

      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="proj-menu" role="menu">
            <div className="proj-menu-head">
              <span className="proj-badge">{initials(name)}</span>
              <div className="proj-menu-cur">
                <div className="proj-menu-name">{name}</div>
                <div className="proj-menu-path" title={projectRoot}>
                  {projectRoot}
                </div>
              </div>
            </div>

            {others.length > 0 && (
              <div className="proj-menu-section">
                <div className="proj-menu-label">Recent projects</div>
                {others.map((r) => (
                  <button
                    key={r.path}
                    className="proj-menu-item"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => doSwitch(r.path)}
                    title={r.path}
                  >
                    <span className="proj-badge sm">{initials(r.name)}</span>
                    <span className="proj-menu-item-text">
                      <span className="proj-menu-item-name">{r.name}</span>
                      <span className="proj-menu-item-path">{r.path}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="proj-menu-sep" />
            <button
              className="proj-menu-item open-folder"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openFolderPicker();
              }}
            >
              <IconFolderOpen size={16} />
              <span className="proj-menu-item-name">Open Folder…</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
