import { describe, it, expect } from 'vitest';
import { cleanOutput } from './ansi';

describe('cleanOutput', () => {
  it('strips ANSI colour codes', () => {
    expect(cleanOutput('\x1b[31mred\x1b[0m and \x1b[1;32mgreen\x1b[0m')).toBe('red and green');
  });

  it('normalises CRLF and lone CR to LF', () => {
    expect(cleanOutput('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('leaves plain text untouched', () => {
    expect(cleanOutput('compiling...\n  done\n')).toBe('compiling...\n  done\n');
  });

  it('strips cursor-movement / erase sequences', () => {
    expect(cleanOutput('progress\x1b[2K\x1b[1Gdone')).toBe('progressdone');
  });
});
