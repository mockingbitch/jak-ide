// Classify a git status entry (porcelain-v2 index/work letters) into a
// PhpStorm-style kind + staged/unstaged flags. Pure → unit-testable, and the
// single source of truth for the file's badge, label, and available actions.

import type { GitFileEntry } from '../../types';

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted';

export interface FileClass {
  status: GitFileStatus;
  /** The index (X) carries a staged change. */
  staged: boolean;
  /** The working tree (Y) carries an un-staged change (untracked counts). */
  hasUnstaged: boolean;
  /** Single-letter badge for the row (index letter when staged, else work). */
  badge: string;
  /** Human label ("Modified", "Renamed", …). */
  label: string;
}

const KIND_BY_LETTER: Record<string, GitFileStatus> = {
  M: 'modified',
  T: 'modified', // type change
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
};

const LABEL: Record<GitFileStatus, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Unversioned',
  ignored: 'Ignored',
  conflicted: 'Conflict',
};

const kindOf = (letter: string): GitFileStatus => KIND_BY_LETTER[letter] ?? 'modified';

/** Classify one file. `index`/`work` are the porcelain-v2 X/Y letters
 *  ('.' = unchanged, '?' = untracked, '!' = ignored). */
export function classify(f: GitFileEntry): FileClass {
  if (f.conflicted) {
    return { status: 'conflicted', staged: false, hasUnstaged: true, badge: 'U', label: LABEL.conflicted };
  }
  if (f.index === '?' || f.work === '?') {
    return { status: 'untracked', staged: false, hasUnstaged: true, badge: '?', label: LABEL.untracked };
  }
  if (f.index === '!' || f.work === '!') {
    return { status: 'ignored', staged: false, hasUnstaged: false, badge: '!', label: LABEL.ignored };
  }
  const staged = f.index !== '.' && f.index !== '';
  const hasUnstaged = f.work !== '.' && f.work !== '';
  const primary = staged ? f.index : f.work;
  const status = kindOf(primary);
  return { status, staged, hasUnstaged, badge: primary || 'M', label: LABEL[status] };
}
