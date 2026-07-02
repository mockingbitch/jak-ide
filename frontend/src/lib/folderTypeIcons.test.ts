import { describe, it, expect } from 'vitest';
import { folderTypeIcons, DEFAULT_FOLDER } from './folderTypeIcons';

describe('folderTypeIcons', () => {
  it('maps a known folder name to a non-default coloured icon pair', () => {
    const src = folderTypeIcons('src');
    expect(src.closed).not.toBe(DEFAULT_FOLDER.closed);
    expect(src.open).not.toBe(DEFAULT_FOLDER.open);
  });

  it('is case-insensitive and shares one icon across aliases', () => {
    expect(folderTypeIcons('SRC').closed).toBe(folderTypeIcons('source').closed);
    expect(folderTypeIcons('components').closed).toBe(folderTypeIcons('widget').closed);
    expect(folderTypeIcons('utils').closed).toBe(folderTypeIcons('helpers').closed);
  });

  it('distinguishes different categories with different icons', () => {
    const seen = ['src', 'components', 'hooks', 'store', 'config', 'assets', 'test', 'docs'].map(
      (n) => folderTypeIcons(n).closed
    );
    expect(new Set(seen).size).toBe(seen.length); // all distinct
  });

  it('falls back to the default folder for unknown names', () => {
    expect(folderTypeIcons('totally-unknown-folder')).toBe(DEFAULT_FOLDER);
  });

  it('applies shape fallbacks for compound names', () => {
    expect(folderTypeIcons('unit-tests').closed).toBe(folderTypeIcons('test').closed);
    expect(folderTypeIcons('jest.config').closed).toBe(folderTypeIcons('config').closed);
    expect(folderTypeIcons('auth-service').closed).toBe(folderTypeIcons('services').closed);
  });

  it('recognises tooling dot-folders', () => {
    expect(folderTypeIcons('.vscode').closed).not.toBe(DEFAULT_FOLDER.closed);
    expect(folderTypeIcons('.claude').closed).not.toBe(DEFAULT_FOLDER.closed);
  });
});
