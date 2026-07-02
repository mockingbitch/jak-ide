// Encrypts secrets (DB/SSH passwords) at rest via Electron's `safeStorage`,
// which ties the ciphertext to the OS user account — never written to disk in
// plaintext. Outside Electron (pure browser dev preview, no `window.jakide`)
// there's no OS-level keychain to reach, so this degrades to a plain passthrough;
// callers that persist the result should treat that case as "unencrypted".

/** Encrypt a secret for storage. Returns the ciphertext (base64) on success. */
export async function encryptSecret(plain: string): Promise<{ ok: boolean; data: string; encrypted: boolean; error?: string }> {
  const jak = window.jakide;
  if (!jak?.isDesktop || !jak.encryptSecret) {
    return { ok: true, data: plain, encrypted: false };
  }
  const r = await jak.encryptSecret(plain);
  if (!r.ok || r.data == null) {
    return { ok: false, data: '', encrypted: false, error: r.error ?? 'Encryption failed' };
  }
  return { ok: true, data: r.data, encrypted: true };
}

/** Decrypt a secret previously produced by encryptSecret. `encrypted` must
 *  match what encryptSecret reported, so a plaintext fallback value round-trips. */
export async function decryptSecret(data: string, encrypted: boolean): Promise<string> {
  if (!encrypted) return data;
  const jak = window.jakide;
  if (!jak?.isDesktop || !jak.decryptSecret) return data;
  const r = await jak.decryptSecret(data);
  return r.ok && r.data != null ? r.data : '';
}
