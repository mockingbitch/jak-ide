import { useState } from 'react';
import { useDbConnectionsStore } from '../../lib/dbConnectionsStore';
import { DbConnectionForm } from './DbConnectionForm';
import { IconPlus, IconTrash } from '../icons';
import type { DbConnectionProfile } from '../../types';

const ENGINE_LABEL: Record<string, string> = { mysql: 'MySQL', postgres: 'PostgreSQL', sqlite: 'SQLite' };

/** Saved-connections list for the Database tool window, plus the "new
 *  connection" affordance (inline form from DbConnectionForm). */
export function DbConnectionList({ onConnect, connecting }: { onConnect: (c: DbConnectionProfile) => void; connecting: boolean }) {
  const connections = useDbConnectionsStore((s) => s.connections);
  const removeConnection = useDbConnectionsStore((s) => s.removeConnection);
  const [showForm, setShowForm] = useState(connections.length === 0);

  return (
    <div className="db-connections">
      {connections.length === 0 && !showForm && <div className="docker-empty">No saved connections yet.</div>}
      {connections.map((c) => (
        <div className="docker-row" key={c.id}>
          <div className="docker-row-main">
            <span className="docker-row-name">{c.name}</span>
            <span className="docker-row-sub">
              {ENGINE_LABEL[c.engine]} · {c.engine === 'sqlite' ? c.database : `${c.host}:${c.port}/${c.database}`}
            </span>
          </div>
          <div className="docker-row-actions">
            <button className="db-btn" disabled={connecting} onClick={() => onConnect(c)}>
              Connect
            </button>
            <button
              className="icon-btn danger"
              title="Remove"
              onClick={() => confirm(`Remove connection "${c.name}"?`) && removeConnection(c.id)}
            >
              <IconTrash size={14} />
            </button>
          </div>
        </div>
      ))}

      {showForm ? (
        <DbConnectionForm onDone={() => setShowForm(false)} />
      ) : (
        <button className="db-add-btn" onClick={() => setShowForm(true)}>
          <IconPlus size={14} /> New connection
        </button>
      )}
    </div>
  );
}
