import { useEffect } from 'react';
import type { VcsMenuItem } from '../../lib/vcs/vcsActions';

export interface VcsMenuState {
  x: number;
  y: number;
  // readonly so both the file menu (VcsMenuItem[]) and the log menu
  // (readonly GitLogMenuItem[]) can be passed without copying.
  items: readonly VcsMenuItem[];
}

/** A right-click menu for Local Changes files, positioned at the cursor. Follows
 *  the app's hand-rolled menu pattern (overlay + absolute list). `onPick` fires
 *  with the chosen action id; the panel maps ids to handlers. */
export function VcsContextMenu({ menu, onPick, onClose }: { menu: VcsMenuState; onPick: (id: VcsMenuItem['id']) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="menu-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="vcs-context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
        {menu.items.map((it) => (
          <div key={it.id}>
            {it.separatorBefore && <div className="vcs-menu-sep" />}
            <button
              className={'vcs-menu-item' + (it.danger ? ' danger' : '')}
              role="menuitem"
              onClick={() => {
                onPick(it.id);
                onClose();
              }}
            >
              {it.label}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
