export interface ConflictBlock {
  startLine: number;
  endLine: number; // index of the >>>>>>> line
  ours: string[];
  base: string[];
  theirs: string[];
}

/** Parse `<<<<<<< / ||||||| / ======= / >>>>>>>` conflict blocks from text. */
export function parseConflicts(text: string): ConflictBlock[] {
  const lines = text.split('\n');
  const blocks: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      i++;
      continue;
    }
    const startLine = i;
    i++;
    const ours: string[] = [];
    while (i < lines.length && !lines[i].startsWith('|||||||') && !lines[i].startsWith('=======')) ours.push(lines[i++]);
    const base: string[] = [];
    if (i < lines.length && lines[i].startsWith('|||||||')) {
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) base.push(lines[i++]);
    }
    const theirs: string[] = [];
    if (i < lines.length && lines[i].startsWith('=======')) {
      i++;
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) theirs.push(lines[i++]);
    }
    if (i < lines.length && lines[i].startsWith('>>>>>>>')) {
      blocks.push({ startLine, endLine: i, ours, base, theirs });
      i++;
    } else {
      i++; // malformed; skip
    }
  }
  return blocks;
}
