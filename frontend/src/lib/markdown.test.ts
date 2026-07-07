import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, bold/italic, and links', () => {
    const h = renderMarkdown('# Title\n\n**bold** and *italic* and [x](https://e.com)');
    expect(h).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>italic</em>');
    expect(h).toContain('href="https://e.com"');
  });

  it('renders lists and GFM tables', () => {
    expect(renderMarkdown('- a\n- b')).toMatch(/<ul>\s*<li>a<\/li>/);
    const t = renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |');
    expect(t).toContain('<table>');
    expect(t).toContain('<td>1</td>');
  });

  it('renders fenced code blocks with a language class', () => {
    const h = renderMarkdown('```ts\nconst x = 1;\n```');
    expect(h).toMatch(/<pre><code class="language-ts">/);
    expect(h).toContain('const x = 1;');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('use `npm run dev`')).toContain('<code>npm run dev</code>');
  });

  it('sanitizes XSS — script tags and event handlers are stripped', () => {
    const h = renderMarkdown('hi <script>alert(1)</script> <img src=x onerror="alert(2)">');
    expect(h).not.toContain('<script>');
    expect(h.toLowerCase()).not.toContain('onerror');
    expect(h.toLowerCase()).not.toContain('alert(2)');
  });

  it('sanitizes javascript: URLs in links', () => {
    const h = renderMarkdown('[click](javascript:alert(1))');
    expect(h.toLowerCase()).not.toContain('javascript:alert');
  });
});
