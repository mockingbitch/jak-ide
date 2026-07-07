import { describe, it, expect } from 'vitest';
import { monacoLangForFence } from './codeHighlight';

describe('monacoLangForFence', () => {
  it('maps common fence aliases to Monaco language ids', () => {
    expect(monacoLangForFence('ts')).toBe('typescript');
    expect(monacoLangForFence('tsx')).toBe('typescript');
    expect(monacoLangForFence('py')).toBe('python');
    expect(monacoLangForFence('rs')).toBe('rust');
    expect(monacoLangForFence('sh')).toBe('shell');
    expect(monacoLangForFence('bash')).toBe('shell');
    expect(monacoLangForFence('yml')).toBe('yaml');
    expect(monacoLangForFence('c#')).toBe('csharp');
  });

  it('is case-insensitive and trims', () => {
    expect(monacoLangForFence('  TS ')).toBe('typescript');
    expect(monacoLangForFence('Python')).toBe('python');
  });

  it('passes through an unknown but plausible id (Monaco escapes unknowns safely)', () => {
    expect(monacoLangForFence('go')).toBe('go');
    expect(monacoLangForFence('json')).toBe('json');
    expect(monacoLangForFence('elixir')).toBe('elixir');
  });

  it('returns null for an unlabeled fence (no highlight attempted)', () => {
    expect(monacoLangForFence('')).toBeNull();
    expect(monacoLangForFence(null)).toBeNull();
    expect(monacoLangForFence(undefined)).toBeNull();
    expect(monacoLangForFence('   ')).toBeNull();
  });
});
