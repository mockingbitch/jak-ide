import { describe, it, expect } from 'vitest';
import type { editor } from 'monaco-editor';
import { isInProjectModel, relPathOf, EXTERNAL_SCHEME } from './modelUri';

// A model is identified only by its URI here; mock just that.
const model = (scheme: string, path: string): editor.ITextModel =>
  ({ uri: { scheme, path } }) as unknown as editor.ITextModel;

describe('modelUri.isInProjectModel', () => {
  it('treats file-scheme models as in-project (monaco coerces scheme-less relative parses to file)', () => {
    expect(isInProjectModel(model('file', '/app/Models/User.php'))).toBe(true);
  });

  it('accepts the empty scheme defensively', () => {
    expect(isInProjectModel(model('', '/app/x.php'))).toBe(true);
  });

  it('rejects external (ext:) and aux (inmemory) models', () => {
    expect(isInProjectModel(model(EXTERNAL_SCHEME, '/abs/vendor/X.php'))).toBe(false);
    expect(isInProjectModel(model('inmemory', '/1'))).toBe(false);
  });
});

describe('modelUri.relPathOf', () => {
  it('strips leading slashes to yield a project-relative posix path', () => {
    expect(relPathOf(model('file', '/app/Models/User.php'))).toBe('app/Models/User.php');
    expect(relPathOf(model('file', '///app/x.php'))).toBe('app/x.php');
    expect(relPathOf(model('file', '/README.md'))).toBe('README.md');
  });
});
