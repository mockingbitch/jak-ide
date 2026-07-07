import { useEffect, useState } from 'react';
import { gitClean } from '../../api';
import { toast } from '../../lib/toastStore';
import { StashDialog } from './StashDialog';
import { RemoteSettings } from './RemoteSettings';
import { IconChevronDown } from '../icons';

/** PhpStorm-style "VCS Operations" popup: a single ⋯ entry in the git header
 *  that opens the less-common actions (stash manager, clean untracked, manage
 *  remotes, reset) so they don't clutter the toolbar. `onDone` triggers a git
 *  refresh; `onOpenReset` asks the parent to open the Reset dialog (shared with
 *  the log context menu). */
export function VcsOperationsMenu({ onDone, onOpenReset }: { onDone: () => void; onOpenReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [showRemotes, setShowRemotes] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Preview via a dry-run, confirm, then force-remove untracked files.
  const cleanUntracked = async () => {
    setOpen(false);
    try {
      const { paths } = await gitClean({ dryRun: true, dirs: true });
      if (paths.length === 0) {
        toast('info', 'No untracked files to clean');
        return;
      }
      const preview = paths.slice(0, 20).join('\n') + (paths.length > 20 ? `\n…and ${paths.length - 20} more` : '');
      if (!confirm(`Permanently delete ${paths.length} untracked item(s)? This cannot be undone.\n\n${preview}`)) return;
      await gitClean({ dryRun: false, dirs: true });
      toast('success', `Cleaned ${paths.length} untracked item(s)`);
      onDone();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const item = (label: string, fn: () => void, danger = false) => (
    <button className={'vcs-menu-item' + (danger ? ' danger' : '')} role="menuitem" onClick={fn}>
      {label}
    </button>
  );

  return (
    <>
      <button className="icon-btn" title="VCS operations" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconChevronDown size={15} />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="vcs-ops-menu" role="menu">
            {item('Stash…', () => { setOpen(false); setShowStash(true); })}
            {item('Manage Remotes…', () => { setOpen(false); setShowRemotes(true); })}
            <div className="vcs-menu-sep" />
            {item('Reset HEAD…', () => { setOpen(false); onOpenReset(); }, true)}
            {item('Clean Untracked Files…', cleanUntracked, true)}
          </div>
        </>
      )}
      {showStash && <StashDialog onClose={() => setShowStash(false)} onDone={onDone} />}
      {showRemotes && <RemoteSettings onClose={() => setShowRemotes(false)} onDone={onDone} />}
    </>
  );
}
