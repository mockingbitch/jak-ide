import { useEffect, useMemo, useRef } from 'react';
import { useMonaco } from '@monaco-editor/react';
import { renderMarkdown } from '../../lib/markdown';
import { monacoLangForFence } from '../../lib/codeHighlight';
import { getEditor } from '../../lib/editorRegistry';
import { useStore } from '../../store';
import { toast } from '../../lib/toastStore';

/** Renders assistant text as sanitized Markdown, then upgrades each fenced code
 *  block with a language label, Copy + Insert buttons, syntax highlighting (via
 *  Monaco's own colorizer — theme-consistent, no extra dep), and a
 *  horizontal-scroll container so wide code never widens the narrow panel.
 *  Links open externally. */
export function ChatMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const monaco = useMonaco();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      const lang = code?.className.match(/language-([\w+#-]+)/)?.[1] ?? '';
      // `source` is plain text here: colorize (which replaces newlines with <br>)
      // only runs once, guarded by data-hl below, so this is always accurate.
      const source = code?.textContent ?? pre.textContent ?? '';

      // (a) Wrap each fence once with a header (language + Insert + Copy).
      if (!pre.parentElement?.classList.contains('chat-code-block')) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-code-block';
        const head = document.createElement('div');
        head.className = 'chat-code-head';
        const langEl = document.createElement('span');
        langEl.className = 'chat-code-lang';
        langEl.textContent = lang || 'code';

        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.className = 'chat-code-insert';
        insertBtn.textContent = 'Insert';
        insertBtn.title = 'Insert into the active editor at the cursor';
        insertBtn.addEventListener('click', () => insertIntoEditor(source));

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'chat-code-copy';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard
            ?.writeText(source)
            .then(() => {
              copyBtn.textContent = 'Copied';
              setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
            })
            .catch(() => {});
        });

        head.append(langEl, insertBtn, copyBtn);
        pre.parentElement?.insertBefore(wrap, pre);
        wrap.append(head, pre);
      }

      // (b) Syntax-highlight once, only after streaming completes — re-colorizing
      // partial code on every token would be wasteful and flicker. Monaco's
      // colorizer matches the active editor theme (no extra highlighter dep).
      const monacoLang = monacoLangForFence(lang);
      if (!streaming && monaco && code && monacoLang && !code.dataset.hl) {
        code.dataset.hl = '1';
        monaco.editor
          .colorize(source, monacoLang, {})
          .then((colored) => {
            if (code.isConnected) code.innerHTML = colored;
          })
          .catch(() => {});
      }
    });
  }, [html, monaco, streaming]);

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

/** Insert a code snippet into the active editor at the cursor/selection. */
function insertIntoEditor(code: string): void {
  const ed = getEditor(useStore.getState().activeGroupId);
  if (!ed) {
    toast('info', 'Open a file to insert code into');
    return;
  }
  const selection = ed.getSelection();
  if (!selection) return;
  ed.executeEdits('chat-insert', [{ range: selection, text: code, forceMoveMarkers: true }]);
  ed.focus();
}
