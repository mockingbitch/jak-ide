import { spawn } from 'node:child_process';

// Shown when the OS has no fontconfig (`fc-list`) — e.g. macOS/Windows.
const FALLBACK = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Source Code Pro',
  'Hack',
  'IBM Plex Mono',
  'Menlo',
  'Consolas',
  'DejaVu Sans Mono',
  'Ubuntu Mono',
  'Courier New',
];

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let child;
    try {
      child = spawn(cmd, args, { env: process.env });
    } catch {
      return resolve({ code: -1, stdout: '' });
    }
    const timer = setTimeout(() => {
      try {
        child!.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

/**
 * List monospaced font families installed on the OS (via fontconfig). Falls back
 * to a curated list if `fc-list` isn't available.
 */
export async function listFonts(): Promise<{ fonts: string[]; source: 'fontconfig' | 'fallback' }> {
  const r = await run('fc-list', [':spacing=100', 'family'], 8000);
  if (r.code === 0 && r.stdout.trim()) {
    const set = new Set<string>();
    for (const line of r.stdout.split('\n')) {
      // A line may carry comma-separated localized aliases; take the primary name.
      const fam = line.split(',')[0].trim();
      if (fam) set.add(fam);
    }
    const fonts = [...set].sort((a, b) => a.localeCompare(b));
    if (fonts.length) return { fonts, source: 'fontconfig' };
  }
  return { fonts: [...FALLBACK].sort((a, b) => a.localeCompare(b)), source: 'fallback' };
}
