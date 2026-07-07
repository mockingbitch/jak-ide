// Map a Markdown fence language (```ts, ```py, …) to a Monaco language id so
// chat code blocks can be colorized with `monaco.editor.colorize` — reusing the
// editor's own tokenizer + active theme instead of adding a highlighter dep.

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  typescriptreact: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  javascriptreact: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  python3: 'python',
  rs: 'rust',
  golang: 'go',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  console: 'shell',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  htm: 'html',
  kt: 'kotlin',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  ps1: 'powershell',
  powershell: 'powershell',
  proto: 'protobuf',
  text: 'plaintext',
  txt: 'plaintext',
  plaintext: 'plaintext',
};

/** Canonical Monaco language id for a fence tag. Returns `null` for an unlabeled
 *  fence (no highlighting attempted — plain text is fine); otherwise the alias
 *  mapping, or the lowercased tag itself (Monaco tolerates unknown ids by
 *  returning escaped, un-highlighted text). */
export function monacoLangForFence(fence: string | null | undefined): string | null {
  if (!fence) return null;
  const key = fence.trim().toLowerCase();
  if (!key) return null;
  return ALIASES[key] ?? key;
}
