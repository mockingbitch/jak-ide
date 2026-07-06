// Data model for the 3-way merge conflict editor (PhpStorm-style).
//
// The single source of truth is the RESULT text — the working-tree file, which
// still carries git conflict markers (<<<<<<< / ||||||| / ======= / >>>>>>>)
// until each conflict is resolved. Every derived structure (aligned side panes,
// spacers, decorations) is rebuilt from that text, so applying an edit and
// re-parsing is always consistent. Positions are 1-based inclusive lines.

export type MergeSide = 'base' | 'ours' | 'theirs' | 'result';

export type MergeHunkStatus = 'unresolved' | 'resolved';

/** `equal` = identical in every pane (auto-merged context); `conflict` = a
 *  git-marked region the user must resolve. */
export type MergeHunkType = 'equal' | 'conflict';

/** 1-based inclusive line range. An empty range has `endLine < startLine`. */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface MergeHunk {
  readonly id: string;
  readonly type: MergeHunkType;
  readonly status: MergeHunkStatus;
  /** Range of this hunk in each pane's reconstructed text. */
  readonly resultRange: LineRange;
  readonly oursRange: LineRange;
  readonly theirsRange: LineRange;
  readonly baseRange: LineRange;
  readonly oursLines: string[];
  readonly theirsLines: string[];
  readonly baseLines: string[];
  /** For a conflict: the raw marker block; for equal: the shared lines. */
  readonly resultLines: string[];
}

/** A virtual gap (Monaco view zone) inserted into a pane to keep the three panes
 *  vertically aligned without touching any text model. */
export interface Spacer {
  /** Insert the gap AFTER this 1-based line (0 = above the first line). */
  readonly afterLine: number;
  readonly heightInLines: number;
}

export interface PaneSpacers {
  readonly ours: Spacer[];
  readonly theirs: Spacer[];
  readonly base: Spacer[];
  readonly result: Spacer[];
}

/** The fully-computed model driving the view, derived from the result text. */
export interface MergeModel {
  readonly hunks: MergeHunk[];
  /** Reconstructed pane texts (each conflict shown as that side's lines). */
  readonly oursText: string;
  readonly theirsText: string;
  readonly baseText: string;
  readonly resultText: string;
  readonly spacers: PaneSpacers;
  /** Conflict hunks in document order (for F7 / Shift+F7 navigation). */
  readonly conflictHunks: MergeHunk[];
  readonly unresolvedCount: number;
  /** True when at least one conflict carries a diff3 `|||||||` base section. */
  readonly hasBase: boolean;
}

/** A resolution choice for a single conflict hunk. */
export type HunkAction = 'ours' | 'theirs' | 'both' | 'both-reverse' | 'base';
