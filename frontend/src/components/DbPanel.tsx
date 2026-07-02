import { useDbStore } from '../lib/dbStore';
import { dbTest } from '../api';
import { decryptSecret } from '../lib/secretStore';
import { DbConnectionList } from './db/DbConnectionList';
import { DbSession } from './db/DbSession';
import type { DbConnectionProfile, DbConnInfo } from '../types';

/** Database tool window: connect to a saved MySQL/PostgreSQL/SQLite profile,
 *  browse its tables, and run queries. See core/src/db.rs for the backend. */
export function DbPanel() {
  const activeConnectionId = useDbStore((s) => s.activeConnectionId);
  const connecting = useDbStore((s) => s.connecting);
  const error = useDbStore((s) => s.error);
  const setConnecting = useDbStore((s) => s.setConnecting);
  const setError = useDbStore((s) => s.setError);
  const connect = useDbStore((s) => s.connect);

  const handleConnect = async (profile: DbConnectionProfile) => {
    setConnecting(true);
    setError(null);
    try {
      const password = await decryptSecret(profile.password, profile.encrypted);
      const info: DbConnInfo = { engine: profile.engine, host: profile.host, port: profile.port, user: profile.user, password, database: profile.database };
      await dbTest(info);
      connect(profile.id, profile.name, info);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="db-panel">
      <div className="tw-header">
        <span className="tw-title">Database</span>
      </div>
      {error && <div className="docker-banner error">{error}</div>}
      {activeConnectionId ? <DbSession /> : <DbConnectionList onConnect={handleConnect} connecting={connecting} />}
    </div>
  );
}
