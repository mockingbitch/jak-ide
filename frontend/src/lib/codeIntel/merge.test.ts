import { describe, it, expect } from 'vitest';
import { mergeEntries, type MergeEntry } from './merge';

const native = (key: string, payload = 'n:' + key, confidence = 0.9): MergeEntry<string> => ({
  key,
  source: 'native',
  confidence,
  payload,
});
const lsp = (key: string, payload = 'l:' + key): MergeEntry<string> => ({
  key,
  source: 'lsp',
  confidence: 1,
  payload,
});

describe('mergeEntries', () => {
  it('puts native results before lsp results', () => {
    const out = mergeEntries([native('a.php:10')], [lsp('b.php:5')]);
    expect(out.map((e) => e.source)).toEqual(['native', 'lsp']);
    expect(out.map((e) => e.key)).toEqual(['a.php:10', 'b.php:5']);
  });

  it('drops an lsp entry when a native entry has the same key (native payload wins)', () => {
    const out = mergeEntries([native('a.php:10')], [lsp('a.php:10'), lsp('c.php:2')]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: 'native', key: 'a.php:10', payload: 'n:a.php:10' });
    expect(out[1]).toMatchObject({ source: 'lsp', key: 'c.php:2' });
  });

  it('keys match on file+line only, so differing keys survive', () => {
    const out = mergeEntries([native('a.php:10')], [lsp('a.php:11')]);
    expect(out).toHaveLength(2);
  });

  it('dedupes within a leg (first occurrence wins)', () => {
    const out = mergeEntries(
      [native('a.php:10', 'first'), native('a.php:10', 'second')],
      [lsp('b.php:1'), lsp('b.php:1')]
    );
    expect(out).toHaveLength(2);
    expect(out[0].payload).toBe('first');
    expect(out[1].source).toBe('lsp');
  });

  it('handles an empty native leg (lsp results pass through in order)', () => {
    const out = mergeEntries<string>([], [lsp('a.php:1'), lsp('b.php:2')]);
    expect(out.map((e) => e.key)).toEqual(['a.php:1', 'b.php:2']);
  });

  it('handles an empty lsp leg and both legs empty', () => {
    expect(mergeEntries([native('a.php:1')], []).map((e) => e.key)).toEqual(['a.php:1']);
    expect(mergeEntries<string>([], [])).toEqual([]);
  });

  it('preserves native input order and does not mutate inputs', () => {
    const n = [native('z.php:9'), native('a.php:1')];
    const l = [lsp('z.php:9')];
    const out = mergeEntries(n, l);
    expect(out.map((e) => e.key)).toEqual(['z.php:9', 'a.php:1']);
    expect(n).toHaveLength(2);
    expect(l).toHaveLength(1);
  });
});
