import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from '../../lib/markdown';

/** Renders assistant text as sanitized Markdown, then upgrades each fenced code
 *  block with a language label + Copy button and a horizontal-scroll container
 *  (so wide code never widens the narrow panel). Links open externally. */
export function ChatMarkdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement?.classList.contains('chat-code-block')) return;
      const code = pre.querySelector('code');
      const lang = code?.className.match(/language-([\w-]+)/)?.[1] ?? '';
      const wrap = document.createElement('div');
      wrap.className = 'chat-code-block';
      const head = document.createElement('div');
      head.className = 'chat-code-head';
      const langEl = document.createElement('span');
      langEl.className = 'chat-code-lang';
      langEl.textContent = lang || 'code';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-code-copy';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        navigator.clipboard
          ?.writeText(code?.textContent ?? pre.textContent ?? '')
          .then(() => {
            btn.textContent = 'Copied';
            setTimeout(() => (btn.textContent = 'Copy'), 1200);
          })
          .catch(() => {});
      });
      head.append(langEl, btn);
      pre.parentElement?.insertBefore(wrap, pre);
      wrap.append(head, pre);
    });
  }, [html]);

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

  return <div className="chat-markdown" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
