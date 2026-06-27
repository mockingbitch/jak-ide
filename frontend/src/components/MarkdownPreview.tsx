import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown';

export function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  // Open links externally instead of navigating the app window away.
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (href) {
      e.preventDefault();
      try {
        window.open(href, '_blank', 'noopener,noreferrer');
      } catch {
        /* ignore */
      }
    }
  };

  return <div className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
