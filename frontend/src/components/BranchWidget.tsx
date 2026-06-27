import { useState } from 'react';
import { useStore } from '../store';
import { BranchMenu } from './BranchMenu';
import { IconBranch, IconChevronDown } from './icons';

/** PhpStorm-style branch widget in the title bar (real git). Hidden outside a repo. */
export function BranchWidget() {
  const git = useStore((s) => s.git);
  const [open, setOpen] = useState(false);

  if (!git.repo) return null;

  return (
    <div className="vcs-widget-wrap">
      <button className="vcs-widget" onClick={() => setOpen((o) => !o)} title="Git branch" aria-haspopup="menu" aria-expanded={open}>
        <IconBranch size={14} />
        <span className="vcs-branch">{git.branch ?? 'detached'}</span>
        {!!git.ahead && <span className="git-ab">↑{git.ahead}</span>}
        {!!git.behind && <span className="git-ab">↓{git.behind}</span>}
        <IconChevronDown size={12} className="vcs-caret" />
      </button>

      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="branch-menu-pop">
            <BranchMenu onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
