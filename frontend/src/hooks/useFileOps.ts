import { useState } from 'react';
import { useStore } from '../store';
import { createFileApi, getFile, mkdirApi, renameFileApi, copyFileApi, deleteFileApi } from '../api';
import { basename } from '../lib/lang';

export interface Clipboard {
  path: string;
  op: 'copy' | 'cut';
}

const dirOf = (p: string) => {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const report = (e: unknown) => alert((e as Error).message);

/** File-tree operations (create/rename/move/copy/delete + a cut/copy/paste clipboard),
 *  each reconciling open editor tabs and refreshing the tree. UI lives in FileExplorer. */
export function useFileOps(refresh: () => Promise<unknown> | void) {
  const openTab = useStore((s) => s.openTab);
  const renameTab = useStore((s) => s.renameTab);
  const closeTabsUnder = useStore((s) => s.closeTabsUnder);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);

  const newFile = async (dir: string) => {
    const name = prompt('New file name:')?.trim();
    if (!name) return;
    const path = join(dir, name);
    try {
      await createFileApi(path);
      await refresh();
      const f = await getFile(path);
      openTab({ path: f.path, content: f.content, dirty: false });
    } catch (e) {
      report(e);
    }
  };

  const newFolder = async (dir: string) => {
    const name = prompt('New folder name:')?.trim();
    if (!name) return;
    try {
      await mkdirApi(join(dir, name));
      await refresh();
    } catch (e) {
      report(e);
    }
  };

  const rename = async (path: string, nextName: string) => {
    const name = nextName.trim();
    if (!name || name === basename(path)) return;
    const newPath = join(dirOf(path), name);
    try {
      await renameFileApi(path, newPath);
      renameTab(path, newPath);
      await refresh();
    } catch (e) {
      report(e);
    }
  };

  const move = async (src: string, destDir: string) => {
    if (src === destDir || dirOf(src) === destDir) return;
    if (destDir === src || destDir.startsWith(src + '/')) return; // don't move into self/descendant
    const newPath = join(destDir, basename(src));
    try {
      await renameFileApi(src, newPath);
      renameTab(src, newPath);
      await refresh();
    } catch (e) {
      report(e);
    }
  };

  const del = async (path: string) => {
    if (!confirm('Delete ' + path + '?')) return;
    try {
      await deleteFileApi(path);
      closeTabsUnder(path);
      await refresh();
    } catch (e) {
      report(e);
    }
  };

  const paste = async (destDir: string) => {
    if (!clipboard) return;
    // A cut into its own location/descendant is a no-op the backend would 409 on.
    if (clipboard.op === 'cut' && (destDir === clipboard.path || destDir === dirOf(clipboard.path) || destDir.startsWith(clipboard.path + '/'))) {
      return;
    }
    const dest = join(destDir, basename(clipboard.path));
    try {
      if (clipboard.op === 'copy') {
        await copyFileApi(clipboard.path, dest);
      } else {
        await renameFileApi(clipboard.path, dest);
        renameTab(clipboard.path, dest);
        setClipboard(null);
      }
      await refresh();
    } catch (e) {
      report(e);
    }
  };

  return { clipboard, setClipboard, newFile, newFolder, rename, move, del, paste };
}
