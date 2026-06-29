// Dev launcher for the Rust core (front door on :8787). Reads PROJECT_ROOT from
// backend/.env so the core opens the same folder Node does, then runs the core
// (prebuilt debug binary if present, else `cargo run`) pointed at Node on :8788.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCargo } from './resolve-cargo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const backendDir = path.join(repoRoot, 'backend');
const coreDir = path.join(repoRoot, 'core');

// Resolve PROJECT_ROOT the same way backend/config.ts does (relative to backend/).
function projectRoot() {
  if (process.env.PROJECT_ROOT) return path.resolve(process.env.PROJECT_ROOT);
  let raw = './workspace';
  try {
    const env = fs.readFileSync(path.join(backendDir, '.env'), 'utf8');
    const line = env.split('\n').reverse().find((l) => /^\s*PROJECT_ROOT\s*=/.test(l));
    if (line) raw = line.slice(line.indexOf('=') + 1).trim();
  } catch {
    /* no .env — use default */
  }
  return path.isAbsolute(raw) ? raw : path.resolve(backendDir, raw);
}

const env = {
  ...process.env,
  JAKIDE_CORE_PORT: process.env.JAKIDE_CORE_PORT || '8787',
  JAKIDE_NODE_PORT: process.env.JAKIDE_NODE_PORT || '8788',
  PROJECT_ROOT: projectRoot(),
};

const debugBin = path.join(coreDir, 'target', 'debug', 'jakide-core');
const useBin = fs.existsSync(debugBin);
const cargo = useBin ? null : resolveCargo();
if (!useBin && !cargo) {
  console.error('[dev-core] no prebuilt debug binary and cargo not found on PATH or in ~/.cargo/bin.');
  console.error('[dev-core] install the Rust toolchain (https://rustup.rs) or set $CARGO.');
  process.exit(1);
}
const cmd = useBin ? debugBin : cargo;
const args = useBin ? [] : ['run'];
console.log(`[dev-core] ${useBin ? debugBin : `${cargo} run`} | PROJECT_ROOT=${env.PROJECT_ROOT} | core:${env.JAKIDE_CORE_PORT} -> node:${env.JAKIDE_NODE_PORT}`);

const child = spawn(cmd, args, { cwd: coreDir, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
