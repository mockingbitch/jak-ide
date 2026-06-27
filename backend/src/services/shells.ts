import fs from 'node:fs';

export interface ShellInfo {
  name: string;
  path: string;
}

const CANDIDATES = [
  '/bin/bash', '/usr/bin/bash',
  '/bin/zsh', '/usr/bin/zsh',
  '/usr/bin/fish', '/usr/local/bin/fish',
  '/usr/bin/dash', '/bin/dash',
  '/bin/sh', '/usr/bin/sh',
  '/usr/bin/pwsh', '/usr/local/bin/pwsh',
  '/usr/bin/nu', '/usr/bin/elvish',
];

function baseName(p: string): string {
  return p.split('/').pop() || p;
}

/**
 * Enumerate the shells / CLIs available on the local machine: entries from
 * /etc/shells, a set of common candidates, and the user's $SHELL. Deduped by
 * name so e.g. /bin/bash and /usr/bin/bash collapse to one "bash".
 */
export function listShells(): { shells: ShellInfo[]; default: string } {
  const byName = new Map<string, string>();
  const add = (p: string | undefined) => {
    if (!p) return;
    const name = baseName(p);
    if (byName.has(name)) return;
    try {
      if (fs.existsSync(p)) byName.set(name, p);
    } catch {
      /* ignore */
    }
  };

  // The user's login shell takes priority for the name slot.
  add(process.env.SHELL);

  try {
    const txt = fs.readFileSync('/etc/shells', 'utf8');
    for (const line of txt.split('\n')) {
      const p = line.trim();
      if (p && !p.startsWith('#')) add(p);
    }
  } catch {
    /* /etc/shells not present */
  }

  for (const p of CANDIDATES) add(p);

  const shells: ShellInfo[] = [...byName.entries()]
    .map(([name, path]) => ({ name, path }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const envShell = process.env.SHELL;
  const def =
    envShell && shells.some((s) => s.path === envShell)
      ? envShell
      : shells.find((s) => s.name === 'bash')?.path ?? shells[0]?.path ?? '/bin/sh';

  return { shells, default: def };
}
