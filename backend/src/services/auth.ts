import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// OAuth access tokens from `ant auth login` must be sent as a Bearer token WITH
// this beta header (required for /v1/messages). The SDK handles Bearer via the
// `authToken` option; we add the beta header as a default header.
const OAUTH_BETA = 'oauth-2025-04-20';

// 'claude-code' = drive Claude Code (the `claude` CLI) via `claude -p`, reusing
// the user's existing login. We never read/extract its subscription token —
// Anthropic does not permit reusing a Claude Code subscription login to power a
// third-party app's direct API calls, so we run inference *through* the CLI.
export type AuthMethod = 'apikey' | 'oauth' | 'claude-code' | 'none';

export interface AuthStatus {
  method: AuthMethod;
  hasAuth: boolean;
  antInstalled: boolean;
  claudeInstalled: boolean;
  claudeLoggedIn: boolean;
}

export class AuthError extends Error {}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { env: process.env });
    } catch {
      return resolve({ code: -1, stdout: '', stderr: 'spawn failed' });
    }
    const timer = setTimeout(() => {
      try {
        child!.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || 'command not found' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function isAntInstalled(): Promise<boolean> {
  const r = await run('ant', ['--version'], 5000);
  return r.code === 0;
}

export async function isClaudeInstalled(): Promise<boolean> {
  const r = await run('claude', ['--version'], 5000);
  return r.code === 0;
}

/**
 * Whether the user is logged into Claude Code. We only check for the presence
 * of its credential store (Linux) or token env var — we never read the token.
 */
export function claudeLoggedIn(): boolean {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  try {
    return fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'));
  } catch {
    return false;
  }
}

interface OAuthCred {
  token: string;
  baseURL?: string;
}

/**
 * Get a fresh OAuth credential from the Anthropic CLI. `print-credentials`
 * refreshes the token if needed. Returns null if ant is missing / not logged in.
 * (Always use --env, never the bare form, which would print the whole JSON.)
 */
async function getOAuthCred(): Promise<OAuthCred | null> {
  const r = await run('ant', ['auth', 'print-credentials', '--env'], 15000);
  if (r.code !== 0) return null;
  let token = '';
  let baseURL: string | undefined;
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (m[1] === 'ANTHROPIC_AUTH_TOKEN') token = val;
    else if (m[1] === 'ANTHROPIC_BASE_URL') baseURL = val;
  }
  return token ? { token, baseURL } : null;
}

// A blank/whitespace ANTHROPIC_API_KEY (the documented "use OAuth" default) must
// be treated as absent — otherwise it shadows the OAuth path.
function envApiKey(): string | undefined {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k ? k : undefined;
}

/**
 * Decide which engine to use. Order: explicit API key → Claude Code login →
 * `ant` OAuth → none. (API-key and OAuth both drive our own SDK agent;
 * claude-code drives the `claude` CLI.)
 */
export async function resolveMethod(): Promise<AuthMethod> {
  if (envApiKey()) return 'apikey';
  if ((await isClaudeInstalled()) && claudeLoggedIn()) return 'claude-code';
  if ((await isAntInstalled()) && (await getOAuthCred())) return 'oauth';
  return 'none';
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const apiKey = !!envApiKey();
  const [antInstalled, claudeInstalled] = await Promise.all([isAntInstalled(), isClaudeInstalled()]);
  const ccLoggedIn = claudeLoggedIn();
  let method: AuthMethod = 'none';
  if (apiKey) method = 'apikey';
  else if (claudeInstalled && ccLoggedIn) method = 'claude-code';
  else if (antInstalled && (await getOAuthCred())) method = 'oauth';
  return { method, hasAuth: method !== 'none', antInstalled, claudeInstalled, claudeLoggedIn: ccLoggedIn };
}

/** Build an Anthropic client using whichever credential is available. */
export async function getClient(): Promise<Anthropic> {
  const apiKey = envApiKey();
  if (apiKey) {
    return new Anthropic({ apiKey });
  }
  const cred = await getOAuthCred();
  if (cred) {
    // apiKey: null is load-bearing — without it the SDK reads an empty
    // ANTHROPIC_API_KEY from the env and sends BOTH X-Api-Key and Bearer (401).
    return new Anthropic({
      apiKey: null,
      authToken: cred.token,
      baseURL: cred.baseURL,
      defaultHeaders: { 'anthropic-beta': OAUTH_BETA },
    });
  }
  throw new AuthError(
    'Not connected to Claude. Sign in with Anthropic, or set ANTHROPIC_API_KEY (backend/.env or the desktop "Set API Key" menu).'
  );
}

// Only one interactive login at a time — concurrent callers share the same run
// (two `ant auth login` processes would clobber each other's browser flow).
let loginInFlight: Promise<{ ok: boolean; error?: string }> | null = null;

/** Run the interactive browser login. Blocks until the user finishes (or times out). */
export async function antLogin(timeoutMs = 180000): Promise<{ ok: boolean; error?: string }> {
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    if (!(await isAntInstalled())) {
      return {
        ok: false,
        error:
          'The Anthropic CLI (`ant`) is not installed. Install it (https://github.com/anthropics/anthropic-cli), then click Sign in again. You can also use an API key instead.',
      };
    }
    const r = await run('ant', ['auth', 'login'], timeoutMs);
    if (r.code === 0) return { ok: true };
    return { ok: false, error: (r.stderr || r.stdout || 'Login failed or was cancelled.').trim().slice(0, 600) };
  })();
  try {
    return await loginInFlight;
  } finally {
    loginInFlight = null;
  }
}

export async function antLogout(): Promise<{ ok: boolean }> {
  await run('ant', ['auth', 'logout'], 15000);
  return { ok: true };
}
