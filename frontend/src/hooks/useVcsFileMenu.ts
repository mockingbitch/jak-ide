import { useCallback, useState, type MouseEvent } from 'react';
import { useStore } from '../store';
import { gitStage, gitUnstage, gitDiscard, gitLog } from '../api';
import { useGitViewStore } from '../lib/gitViewStore';
import { useOpenFileAt } from './useOpenFileAt';
import { fileActions, type VcsActionId, type VcsMenuItem } from '../lib/vcs/vcsActions';
import type { GitFileEntry } from '../types';

interface MenuState {
  x: number;
  y: number;
  items: VcsMenuItem[];
  file: GitFileEntry;
}

interface Deps {
  /** Run a git call then refresh (GitPanel's `act`). */
  act: (fn: () => Promise<unknown>) => void;
  openDiff: (f: GitFileEntry) => void;
  openMerge: (path: string) => void;
  onError: (msg: string) => void;
}

/** Local Changes right-click menu: owns the menu state and dispatches each
 *  action to the existing git APIs (staging, rollback, diff, history, annotate,
 *  copy path). Dangerous actions confirm first. Extracted from GitPanel to keep
 *  the panel component under the size budget. */
export function useVcsFileMenu({ act, openDiff, openMerge, onError }: Deps) {
  const projectRoot = useStore((s) => s.projectRoot);
  const openGitHistory = useStore((s) => s.openGitHistory);
  const openFileAt = useOpenFileAt();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback((e: MouseEvent, file: GitFileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: fileActions(file), file });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const run = useCallback(
    (id: VcsActionId, f: GitFileEntry) => {
      const paths = f.orig ? [f.path, f.orig] : [f.path];
      switch (id) {
        case 'diff':
          openDiff(f);
          break;
        case 'open':
          // Open the actual working file (a rename opens its NEW path).
          openFileAt(f.path).catch(() => {});
          break;
        case 'stage':
          act(() => gitStage(paths));
          break;
        case 'unstage':
          act(() => gitUnstage(paths));
          break;
        case 'rollback':
          if (confirm(`Rollback changes to ${f.path}? This cannot be undone.`)) act(() => gitDiscard(paths));
          break;
        case 'resolve':
          openMerge(f.path);
          break;
        case 'history':
          gitLog(200, 0, f.path)
            .then((commits) => openGitHistory({ path: f.path, commits }))
            .catch((err) => onError((err as Error).message));
          break;
        case 'annotate':
          openFileAt(f.path)
            .then(() => useGitViewStore.getState().setAnnotate(f.path, true))
            .catch(() => {});
          break;
        case 'copyPath':
          navigator.clipboard?.writeText(projectRoot ? `${projectRoot}/${f.path}` : f.path);
          break;
        case 'copyRelPath':
          navigator.clipboard?.writeText(f.path);
          break;
      }
    },
    [act, openDiff, openMerge, onError, openGitHistory, openFileAt, projectRoot]
  );

  return { menu, openMenu, closeMenu, run };
}
