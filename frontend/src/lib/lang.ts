// Map a file path to a Monaco language id, and a basename helper. Extracted from
// EditorPane so every tab component (file editor, diff, ...) shares one mapping.
const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', py: 'python', go: 'go', php: 'php', phtml: 'php', md: 'markdown', rb: 'ruby',
  css: 'css', scss: 'scss', less: 'less', html: 'html', vue: 'html', svelte: 'html',
  yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell', sql: 'sql', rs: 'rust',
  java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', toml: 'ini', ini: 'ini',
  xml: 'xml', dockerfile: 'dockerfile',
};

export function langFor(path?: string): string {
  if (!path) return 'plaintext';
  const base = path.split('/').pop() ?? '';
  if (base === 'Dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile';
  const ext = base.split('.').pop()?.toLowerCase() ?? '';
  return LANG[ext] ?? 'plaintext';
}

export const basename = (p: string): string => p.split('/').pop() ?? p;
