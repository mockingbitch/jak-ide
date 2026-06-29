// Locate a usable `cargo`. rustup installs to ~/.cargo/bin and adds it to PATH
// via ~/.cargo/env, but non-login shells (and custom shells that don't source
// that file) leave it off PATH — so a bare `cargo` spawn fails with ENOENT even
// though the toolchain is installed. Fall back to the standard rustup location
// (and an explicit $CARGO override) before giving up.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @returns {string | null} a cargo command/path usable with spawn, or null if none found. */
export function resolveCargo() {
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

  // 1) Explicit override wins.
  if (process.env.CARGO && fs.existsSync(process.env.CARGO)) return process.env.CARGO;

  // 2) Already resolvable on PATH?
  if (spawnSync(exe, ['--version'], { stdio: 'ignore' }).status === 0) return exe;

  // 3) Standard rustup install dir (CARGO_HOME, else ~/.cargo). The rustup shim
  //    locates the toolchain from its own home, so an absolute path works even
  //    when ~/.cargo/bin is not on PATH.
  const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
  const candidate = path.join(cargoHome, 'bin', exe);
  if (fs.existsSync(candidate)) return candidate;

  return null;
}
