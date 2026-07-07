// Which context-menu actions apply to a file, given its classification. Pure so
// the availability rules are unit-tested; GitPanel maps each id to a handler.

import type { GitFileEntry } from '../../types';
import { classify } from './fileStatus';

export type VcsActionId =
  // Local Changes file actions
  | 'diff'
  | 'stage'
  | 'unstage'
  | 'rollback'
  | 'resolve'
  | 'history'
  | 'annotate'
  | 'copyPath'
  | 'copyRelPath'
  // Git log commit actions (see hooks/useGitLogMenu.ts) — same menu component
  | 'checkout'
  | 'cherryPick'
  | 'revert'
  | 'reset'
  | 'branch'
  | 'copyHash';

export interface VcsMenuItem {
  id: VcsActionId;
  label: string;
  /** Destructive — the handler should confirm first. */
  danger?: boolean;
  /** Render a separator ABOVE this item. */
  separatorBefore?: boolean;
}

/** Ordered context-menu items for a Local Changes file. */
export function fileActions(f: GitFileEntry): VcsMenuItem[] {
  const c = classify(f);
  const items: VcsMenuItem[] = [{ id: 'diff', label: 'Show Diff' }];

  if (c.status === 'conflicted') {
    items.push({ id: 'resolve', label: 'Resolve Conflicts…' });
    items.push({ id: 'stage', label: 'Mark Resolved (stage)' });
  } else {
    // A file can be both staged and dirty (e.g. index M + work M) → offer both.
    if (c.hasUnstaged) items.push({ id: 'stage', label: c.status === 'untracked' ? 'Add to VCS' : 'Stage' });
    if (c.staged) items.push({ id: 'unstage', label: 'Unstage' });
    if (c.status !== 'untracked') items.push({ id: 'rollback', label: 'Rollback…', danger: true });
  }

  items.push({ id: 'history', label: 'Show History', separatorBefore: true });
  items.push({ id: 'annotate', label: 'Annotate' });
  items.push({ id: 'copyPath', label: 'Copy Path', separatorBefore: true });
  items.push({ id: 'copyRelPath', label: 'Copy Relative Path' });
  return items;
}
