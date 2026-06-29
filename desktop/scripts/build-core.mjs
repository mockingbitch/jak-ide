// Build the Rust core in release mode and copy the binary into desktop/app/bin/
// so electron-builder bundles it. The packaged main.js spawns it as the front door.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCargo } from './resolve-cargo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const coreDir = path.join(repoRoot, 'core');
const binName = process.platform === 'win32' ? 'jakide-core.exe' : 'jakide-core';
const builtBin = path.join(coreDir, 'target', 'release', binName);
const outDir = path.join(here, '..', 'app', 'bin');

const cargo = resolveCargo();
if (!cargo) {
  console.error('[build-core] cargo not found on PATH or in ~/.cargo/bin.');
  console.error('[build-core] install the Rust toolchain (https://rustup.rs) or set $CARGO.');
  process.exit(1);
}

console.log(`[build-core] ${cargo} build --release …`);
const r = spawnSync(cargo, ['build', '--release'], { cwd: coreDir, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('[build-core] cargo build failed.');
  process.exit(r.status ?? 1);
}

fs.mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, binName);
fs.copyFileSync(builtBin, dest);
fs.chmodSync(dest, 0o755);
console.log('[build-core] core binary ->', dest);
