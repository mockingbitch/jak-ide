import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { PROJECT_ROOT, setProjectRoot } from '../config';

export interface RecentProject {
  path: string;
  name: string;
}

// Recent projects persist in the user's home so the switcher remembers folders
// across restarts (independent of the desktop app's own config.json).
const STORE_DIR = path.join(os.homedir(), '.jakide');
const STORE_FILE = path.join(STORE_DIR, 'projects.json');
const MAX_RECENTS = 12;

interface Store {
  recents: string[];
}

function load(): Store {
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return { recents: Array.isArray(data?.recents) ? data.recents : [] };
  } catch {
    return { recents: [] };
  }
}

function save(store: Store): void {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch {
    /* best-effort; a read-only home shouldn't break the app */
  }
}

/** Push a folder to the front of the recents list (deduped, capped). */
export function recordOpen(absDir: string): void {
  const abs = path.resolve(absDir);
  const store = load();
  store.recents = [abs, ...store.recents.filter((p) => p !== abs)].slice(0, MAX_RECENTS);
  save(store);
}

/** Recent projects that still exist on disk. */
export function getRecents(): RecentProject[] {
  return load()
    .recents.filter((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .map((p) => ({ path: p, name: path.basename(p) || p }));
}

/** Switch the IDE to a folder (validates), record it, and return the new root. */
export function openProject(dir: string): { current: string; name: string } {
  const abs = setProjectRoot(dir);
  recordOpen(abs);
  return { current: abs, name: path.basename(abs) || abs };
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  entries: { name: string; path: string }[];
}

/**
 * List the sub-directories of a folder so the UI can offer a folder picker.
 * This intentionally reads outside PROJECT_ROOT — it is the project chooser for
 * a local, single-user IDE (the terminal already has full local access).
 */
export function browse(input?: string): BrowseResult {
  const home = os.homedir();
  const target = input ? path.resolve(input) : home;
  const stat = fs.statSync(target); // throws if missing
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${target}`);

  let entries: { name: string; path: string }[] = [];
  try {
    entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    entries = []; // unreadable dir (permissions) — show it as empty rather than error
  }

  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    home,
    entries,
  };
}

/** Record whatever root the server booted with, so it shows up in recents. */
export function recordInitialRoot(): void {
  recordOpen(PROJECT_ROOT);
}
