import { create } from 'zustand';
import type { DbColumn, DbConnInfo, DbQueryResult } from '../types';

/** Live Database tool window session — the active connection (with its
 *  DECRYPTED password) lives here in memory only, never persisted; it's cleared
 *  on disconnect. Saved profiles (encrypted) live in dbConnectionsStore instead. */
interface DbState {
  activeConnectionId: string | null;
  activeConn: DbConnInfo | null;
  activeName: string | null;
  connecting: boolean;
  tables: readonly string[];
  activeTable: string | null;
  columns: readonly DbColumn[];
  sql: string;
  result: DbQueryResult | null;
  running: boolean;
  error: string | null;

  connect: (id: string, name: string, conn: DbConnInfo) => void;
  disconnect: () => void;
  setConnecting: (b: boolean) => void;
  setTables: (t: string[]) => void;
  setActiveTable: (t: string | null) => void;
  setColumns: (c: DbColumn[]) => void;
  setSql: (s: string) => void;
  setResult: (r: DbQueryResult | null) => void;
  setRunning: (b: boolean) => void;
  setError: (e: string | null) => void;
}

export const useDbStore = create<DbState>((set) => ({
  activeConnectionId: null,
  activeConn: null,
  activeName: null,
  connecting: false,
  tables: [],
  activeTable: null,
  columns: [],
  sql: '',
  result: null,
  running: false,
  error: null,

  connect: (activeConnectionId, activeName, activeConn) => set({ activeConnectionId, activeName, activeConn, error: null }),
  disconnect: () =>
    set({
      activeConnectionId: null,
      activeConn: null,
      activeName: null,
      tables: [],
      activeTable: null,
      columns: [],
      sql: '',
      result: null,
      error: null,
    }),
  setConnecting: (connecting) => set({ connecting }),
  setTables: (tables) => set({ tables }),
  setActiveTable: (activeTable) => set({ activeTable }),
  setColumns: (columns) => set({ columns }),
  setSql: (sql) => set({ sql }),
  setResult: (result) => set({ result }),
  setRunning: (running) => set({ running }),
  setError: (error) => set({ error }),
}));
