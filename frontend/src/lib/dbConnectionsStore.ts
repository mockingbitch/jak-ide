import { create } from 'zustand';
import type { DbConnectionProfile } from '../types';

const KEY = 'jakide.db.connections';

function load(): DbConnectionProfile[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

/** Saved connection profiles (Database tool window). Passwords are encrypted
 *  before they ever reach this store (see lib/secretStore.ts) — this file only
 *  persists whatever ciphertext/plaintext it's handed, it never encrypts itself. */
interface DbConnectionsState {
  connections: readonly DbConnectionProfile[];
  addConnection: (c: DbConnectionProfile) => void;
  removeConnection: (id: string) => void;
}

const persist = (connections: readonly DbConnectionProfile[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(connections));
  } catch {
    /* ignore quota / privacy mode */
  }
};

export const useDbConnectionsStore = create<DbConnectionsState>((set) => ({
  connections: load(),
  addConnection: (c) =>
    set((s) => {
      const connections = [...s.connections.filter((x) => x.name !== c.name), c];
      persist(connections);
      return { connections };
    }),
  removeConnection: (id) =>
    set((s) => {
      const connections = s.connections.filter((c) => c.id !== id);
      persist(connections);
      return { connections };
    }),
}));
