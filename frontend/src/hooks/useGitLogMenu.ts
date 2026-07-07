import { useCallback, useState, type MouseEvent } from 'react';
import { gitCheckout, gitCherryPick, gitCreateBranch, gitRevert } from '../api';
import { toast } from '../lib/toastStore';
import type { VcsMenuItem } from '../lib/vcs/vcsActions';

/** A commit as identified by a git-log row for context-menu actions. */
export interface GitLogCommit {
  readonly hash: string;
  readonly short?: string;
}

/** Right-click actions available on a commit row in the git log. */
export type GitLogActionId = 'checkout' | 'cherryPick' | 'revert' | 'reset' | 'branch' | 'copyHash';

/** Menu item for the git-log context menu: reuses the shared VcsMenuItem shape
 *  (label / danger / separatorBefore) with a log-specific action-id union. */
export type GitLogMenuItem = Omit<VcsMenuItem, 'id'> & { readonly id: GitLogActionId };

interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly items: readonly GitLogMenuItem[];
  readonly commit: GitLogCommit;
}

interface Deps {
  /** Refresh git state after a mutating action (parent maps this to a git refresh). */
  onDone: () => void;
  /** Reset is interactive: the parent opens ResetDialog targeting `hash`. */
  onReset: (hash: string) => void;
}

/** Ordered context-menu items for a git-log commit row. Static — availability
 *  does not depend on the commit. */
const LOG_ACTIONS: readonly GitLogMenuItem[] = [
  { id: 'checkout', label: 'Checkout Revision' },
  { id: 'cherryPick', label: 'Cherry-pick' },
  { id: 'revert', label: 'Revert' },
  { id: 'reset', label: 'Reset Current Branch to Here…', danger: true },
  { id: 'branch', label: 'New Branch from Commit…' },
  { id: 'copyHash', label: 'Copy Revision Hash', separatorBefore: true },
];

/** Git-log right-click menu: owns the menu state and dispatches each action to
 *  the git APIs. Mutating actions refresh via `onDone` and toast their result;
 *  a rejection never escapes the handler. Reset is delegated to the parent
 *  (opens ResetDialog). Modeled on useVcsFileMenu. */
export function useGitLogMenu({ onDone, onReset }: Deps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback((e: MouseEvent, commit: GitLogCommit) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: LOG_ACTIONS, commit });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const run = useCallback(
    (id: GitLogActionId, commit: GitLogCommit) => {
      const label = commit.short ?? commit.hash.slice(0, 7);
      // Run a mutating git call, then refresh + toast the result. Wrapped in
      // Promise.resolve so a synchronous throw is caught too — nothing escapes.
      const mutate = (verb: string, fn: () => Promise<unknown>) => {
        void Promise.resolve()
          .then(fn)
          .then(
            () => toast('success', `${verb} ${label}`),
            (err: unknown) => toast('error', err instanceof Error ? err.message : String(err))
          )
          // Refresh even on failure: a conflicting cherry-pick/revert exits
          // non-zero yet DID start (writes CHERRY_PICK_HEAD + conflict markers),
          // so the in-progress banner + conflict list must appear regardless.
          .finally(() => onDone());
      };

      switch (id) {
        case 'checkout':
          mutate('Checked out', () => gitCheckout(commit.hash));
          break;
        case 'cherryPick':
          mutate('Cherry-picked', () => gitCherryPick(commit.hash));
          break;
        case 'revert':
          mutate('Reverted', () => gitRevert(commit.hash));
          break;
        case 'reset':
          // Destructive + needs a mode choice → parent opens the ResetDialog.
          onReset(commit.hash);
          break;
        case 'branch':
          // Branch AT the selected commit (startPoint = commit.hash), not HEAD.
          // A proper name dialog is a follow-up; use a generated default for now.
          mutate('Created branch from', () => gitCreateBranch(`branch-${label}`, true, commit.hash));
          break;
        case 'copyHash':
          navigator.clipboard?.writeText(commit.hash).catch(() => {});
          toast('info', 'Hash copied');
          break;
      }
    },
    [onDone, onReset]
  );

  return { menu, openMenu, closeMenu, run };
}
