import type { BlameLine } from '../types';

/** Pure helpers that turn `git blame` output into per-line editor annotations
 *  (PhpStorm-style "Annotate with Git Blame"). No Monaco/React deps → unit-testable. */

export const N_AGE_BUCKETS = 5;
const AUTHOR_W = 13; // fixed author column width (monospace → aligned)
const DATE_W = 10; // 'YYYY-MM-DD'
const ALL_ZERO = /^0+$/;

/** A not-yet-committed line (git reports an all-zero SHA). */
export const isUncommitted = (ln: BlameLine): boolean => !ln.hash || ALL_ZERO.test(ln.hash);

/** Parseable date string → local 'YYYY-MM-DD'; '' when unparseable. */
export function shortDate(date: string): string {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Trim (with ellipsis) or right-pad to exactly `w` chars. */
function fit(s: string, w: number): string {
  if (s.length > w) return s.slice(0, Math.max(0, w - 1)) + '…';
  return s.padEnd(w, ' ');
}

/** Fixed-width gutter label injected before each line: 'YYYY-MM-DD  author'. */
export function annotationLabel(ln: BlameLine): string {
  if (isUncommitted(ln)) return fit('Uncommitted', DATE_W + 2 + AUTHOR_W);
  return `${fit(shortDate(ln.date), DATE_W)}  ${fit(ln.author, AUTHOR_W)}`;
}

/** Per-line age bucket 0..n-1 (0 = oldest commit, n-1 = newest) for the heat colouring. */
export function ageBuckets(lines: readonly BlameLine[], n = N_AGE_BUCKETS): number[] {
  const times = lines.map((l) => Date.parse(l.date));
  let min = Infinity;
  let max = -Infinity;
  for (const t of times) {
    if (Number.isNaN(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const span = max - min;
  return times.map((t) => {
    if (Number.isNaN(t) || !Number.isFinite(min) || span <= 0) return n - 1;
    return Math.max(0, Math.min(n - 1, Math.floor(((t - min) / span) * n)));
  });
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

/** Markdown hover shown over an annotated line (subject, author·date, revision). */
export function hoverMarkdown(ln: BlameLine): string {
  if (isUncommitted(ln)) return '**Uncommitted changes** — not yet committed';
  const subject = ln.summary ? escapeMd(ln.summary) : '_(no commit message)_';
  return [`**${subject}**`, '', `${escapeMd(ln.author)} · ${shortDate(ln.date)}`, '', `\`${ln.short}\``].join('\n');
}

/** Human "3 days ago" relative time; '' when unparseable. */
export function relativeTime(date: string, now: number): string {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  const units: ReadonlyArray<readonly [number, string]> = [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, name] of units) {
    const v = Math.floor(s / secs);
    if (v >= 1) return `${v} ${name}${v > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

/** GitLens-style trailing current-line label: "Ada Lovelace, 3 days ago • Fix bug". */
export function currentLineLabel(ln: BlameLine, now: number): string {
  if (isUncommitted(ln)) return 'You · Uncommitted changes';
  const when = relativeTime(ln.date, now);
  const who = [ln.author, when].filter(Boolean).join(', ');
  const summary = ln.summary ? ` • ${ln.summary}` : '';
  return `${who}${summary}`;
}

export interface AnnotationRow {
  readonly lineNumber: number;
  readonly label: string;
  readonly bucket: number;
  readonly hover: string;
  readonly uncommitted: boolean;
}

/** Build the per-line annotation model from blame output. */
export function annotationRows(lines: readonly BlameLine[], n = N_AGE_BUCKETS): AnnotationRow[] {
  const buckets = ageBuckets(lines, n);
  return lines.map((ln, i) => ({
    lineNumber: ln.line > 0 ? ln.line : i + 1,
    label: annotationLabel(ln),
    bucket: buckets[i],
    hover: hoverMarkdown(ln),
    uncommitted: isUncommitted(ln),
  }));
}
