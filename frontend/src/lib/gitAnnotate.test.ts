import { describe, it, expect } from 'vitest';
import {
  isUncommitted,
  shortDate,
  annotationLabel,
  ageBuckets,
  hoverMarkdown,
  annotationRows,
  relativeTime,
  currentLineLabel,
  N_AGE_BUCKETS,
} from './gitAnnotate';
import type { BlameLine } from '../types';

const line = (over: Partial<BlameLine> = {}): BlameLine => ({
  line: 1,
  hash: '1234567890abcdef',
  short: '1234567',
  author: 'Ada Lovelace',
  date: '2023-06-15T10:00:00Z',
  summary: 'Initial commit',
  code: 'const x = 1;',
  ...over,
});

describe('isUncommitted', () => {
  it('detects the all-zero SHA', () => {
    expect(isUncommitted(line({ hash: '0000000000000000' }))).toBe(true);
    expect(isUncommitted(line({ hash: '' }))).toBe(true);
    expect(isUncommitted(line())).toBe(false);
  });
});

describe('shortDate', () => {
  it('formats a parseable date to YYYY-MM-DD', () => {
    expect(shortDate('2023-06-15T10:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('returns empty for an unparseable date', () => {
    expect(shortDate('not-a-date')).toBe('');
  });
});

describe('annotationLabel', () => {
  it('is a fixed width for committed and uncommitted lines (column alignment)', () => {
    const committed = annotationLabel(line());
    const uncommitted = annotationLabel(line({ hash: '0'.repeat(16) }));
    expect(committed.length).toBe(uncommitted.length);
    expect(uncommitted).toContain('Uncommitted');
  });
  it('truncates a long author with an ellipsis', () => {
    expect(annotationLabel(line({ author: 'A-very-long-author-name' }))).toContain('…');
  });
});

describe('ageBuckets', () => {
  it('maps oldest → 0 and newest → last bucket', () => {
    const lines = [
      line({ date: '2020-01-01T00:00:00Z' }),
      line({ date: '2022-01-01T00:00:00Z' }),
      line({ date: '2024-01-01T00:00:00Z' }),
    ];
    const b = ageBuckets(lines);
    expect(b[0]).toBe(0);
    expect(b[2]).toBe(N_AGE_BUCKETS - 1);
    expect(b[1]).toBeGreaterThanOrEqual(0);
    expect(b[1]).toBeLessThan(N_AGE_BUCKETS);
  });
  it('buckets all-unparseable dates as newest (no NaN math)', () => {
    const b = ageBuckets([line({ date: 'x' }), line({ date: 'y' })]);
    expect(b).toEqual([N_AGE_BUCKETS - 1, N_AGE_BUCKETS - 1]);
  });
});

describe('hoverMarkdown', () => {
  it('includes author and short hash for a commit', () => {
    const md = hoverMarkdown(line());
    expect(md).toContain('Ada Lovelace');
    expect(md).toContain('1234567');
  });
  it('shows an uncommitted note', () => {
    expect(hoverMarkdown(line({ hash: '0'.repeat(16) }))).toContain('Uncommitted');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2023-06-15T12:00:00Z');
  it('buckets the elapsed time into a human unit', () => {
    expect(relativeTime('2023-06-15T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2023-06-15T11:00:00Z', now)).toBe('1 hour ago');
    expect(relativeTime('2023-06-12T12:00:00Z', now)).toBe('3 days ago');
    expect(relativeTime('2022-06-15T12:00:00Z', now)).toBe('1 year ago');
  });
  it('returns empty for an unparseable date', () => {
    expect(relativeTime('nope', now)).toBe('');
  });
});

describe('currentLineLabel', () => {
  const now = Date.parse('2023-06-15T12:00:00Z');
  it('formats author, relative time and summary', () => {
    const l = line({ date: '2023-06-12T12:00:00Z', author: 'Ada', summary: 'Fix bug' });
    expect(currentLineLabel(l, now)).toBe('Ada, 3 days ago • Fix bug');
  });
  it('shows an uncommitted marker', () => {
    expect(currentLineLabel(line({ hash: '0'.repeat(16) }), now)).toContain('Uncommitted');
  });
});

describe('annotationRows', () => {
  it('carries the blame line number and flags', () => {
    const rows = annotationRows([line({ line: 7 }), line({ line: 8, hash: '0'.repeat(16) })]);
    expect(rows[0].lineNumber).toBe(7);
    expect(rows[1].uncommitted).toBe(true);
    expect(rows).toHaveLength(2);
  });
});
