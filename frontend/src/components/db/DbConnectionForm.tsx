import { useState } from 'react';
import type { DbEngine, DbConnectionProfile } from '../../types';
import { useDbConnectionsStore } from '../../lib/dbConnectionsStore';
import { encryptSecret } from '../../lib/secretStore';

const DEFAULT_PORT: Record<DbEngine, number> = { mysql: 3306, postgres: 5432, sqlite: 0 };

/** Add-connection form for the Database tool window. Saves an encrypted
 *  profile via dbConnectionsStore (see lib/secretStore.ts for the encryption). */
export function DbConnectionForm({ onDone }: { onDone: () => void }) {
  const addConnection = useDbConnectionsStore((s) => s.addConnection);
  const [name, setName] = useState('');
  const [engine, setEngine] = useState<DbEngine>('mysql');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(String(DEFAULT_PORT.mysql));
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeEngine = (e: DbEngine) => {
    setEngine(e);
    setPort(String(DEFAULT_PORT[e]));
  };

  const canSave = name.trim().length > 0 && database.trim().length > 0 && (engine === 'sqlite' || (host.trim().length > 0 && user.trim().length > 0));

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const enc = await encryptSecret(password);
      if (!enc.ok) throw new Error(enc.error ?? 'Encryption failed');
      const profile: DbConnectionProfile = {
        id: crypto.randomUUID(),
        name: name.trim(),
        engine,
        host: engine === 'sqlite' ? undefined : host.trim(),
        port: engine === 'sqlite' ? undefined : Number(port) || DEFAULT_PORT[engine],
        user: engine === 'sqlite' ? undefined : user.trim(),
        database: database.trim(),
        password: enc.data,
        encrypted: enc.encrypted,
      };
      addConnection(profile);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="db-form">
      <div className="db-form-row">
        <input className="db-input" placeholder="Connection name" value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} autoFocus />
        <select className="db-select" value={engine} onChange={(e) => changeEngine(e.target.value as DbEngine)}>
          <option value="mysql">MySQL</option>
          <option value="postgres">PostgreSQL</option>
          <option value="sqlite">SQLite</option>
        </select>
      </div>

      {engine === 'sqlite' ? (
        <div className="db-form-row">
          <input className="db-input" placeholder="Path to .db file" value={database} spellCheck={false} onChange={(e) => setDatabase(e.target.value)} />
        </div>
      ) : (
        <>
          <div className="db-form-row">
            <input className="db-input" placeholder="Host" value={host} spellCheck={false} onChange={(e) => setHost(e.target.value)} />
            <input className="db-input db-input-port" placeholder="Port" value={port} spellCheck={false} onChange={(e) => setPort(e.target.value)} />
          </div>
          <div className="db-form-row">
            <input className="db-input" placeholder="User" value={user} spellCheck={false} onChange={(e) => setUser(e.target.value)} />
            <input className="db-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="db-form-row">
            <input className="db-input" placeholder="Database name" value={database} spellCheck={false} onChange={(e) => setDatabase(e.target.value)} />
          </div>
        </>
      )}

      {error && <div className="db-form-error">{error}</div>}

      <div className="db-form-actions">
        <button className="db-btn" disabled={!canSave || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save connection'}
        </button>
        <button className="db-btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
