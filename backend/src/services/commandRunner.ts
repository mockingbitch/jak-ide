import { exec } from 'node:child_process';
import { PROJECT_ROOT, ALLOWED_COMMANDS } from '../config';

/** Reject anything that chains/redirects/substitutes — keeps the MVP runner to a single command. */
const SHELL_META = /[;&|`$<>(){}\n\r]|&&|\|\|/;

export interface RunResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export function runCommand(command: string, timeoutMs = 20000): Promise<RunResult> {
  return new Promise((resolve) => {
    const trimmed = String(command ?? '').trim();
    const fail = (error: string): RunResult => ({
      ok: false,
      command: trimmed,
      stdout: '',
      stderr: '',
      exitCode: null,
      error,
    });

    if (!trimmed) return resolve(fail('Empty command'));
    if (SHELL_META.test(trimmed)) {
      return resolve(
        fail('Command contains disallowed shell operators (; & | \\` $ < > ...). Run a single command at a time.')
      );
    }
    const bin = trimmed.split(/\s+/)[0];
    if (!ALLOWED_COMMANDS.includes(bin)) {
      return resolve(fail(`Command "${bin}" is not in the allowlist. Allowed: ${ALLOWED_COMMANDS.join(', ')}`));
    }

    exec(
      trimmed,
      { cwd: PROJECT_ROOT, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error: any, stdout, stderr) => {
        resolve({
          ok: !error,
          command: trimmed,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          error: error?.killed ? 'Command timed out' : undefined,
        });
      }
    );
  });
}
