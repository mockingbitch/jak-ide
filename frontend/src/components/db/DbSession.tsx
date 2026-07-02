import { useEffect } from 'react';
import { useDbStore } from '../../lib/dbStore';
import { dbTables, dbColumns, dbQuery } from '../../api';
import { IconRun, IconClose } from '../icons';

/** The connected view of the Database tool window: table list, a SQL box, and
 *  a results grid. Reads/writes the ephemeral session in lib/dbStore. */
export function DbSession() {
  const activeConn = useDbStore((s) => s.activeConn);
  const activeName = useDbStore((s) => s.activeName);
  const tables = useDbStore((s) => s.tables);
  const activeTable = useDbStore((s) => s.activeTable);
  const columns = useDbStore((s) => s.columns);
  const sql = useDbStore((s) => s.sql);
  const result = useDbStore((s) => s.result);
  const running = useDbStore((s) => s.running);
  const disconnect = useDbStore((s) => s.disconnect);
  const setTables = useDbStore((s) => s.setTables);
  const setActiveTable = useDbStore((s) => s.setActiveTable);
  const setColumns = useDbStore((s) => s.setColumns);
  const setSql = useDbStore((s) => s.setSql);
  const setResult = useDbStore((s) => s.setResult);
  const setRunning = useDbStore((s) => s.setRunning);
  const setError = useDbStore((s) => s.setError);

  useEffect(() => {
    if (!activeConn) return;
    dbTables(activeConn)
      .then(setTables)
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConn]);

  const pickTable = async (table: string) => {
    if (!activeConn) return;
    setActiveTable(table);
    setSql(`SELECT * FROM ${table} LIMIT 100`);
    try {
      setColumns(await dbColumns(activeConn, table));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const run = async () => {
    if (!activeConn || !sql.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await dbQuery(activeConn, sql));
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  };

  return (
    <div className="db-session">
      <div className="db-session-header">
        <span className="db-active-name">{activeName}</span>
        <button className="icon-btn" title="Disconnect" onClick={disconnect}>
          <IconClose size={14} />
        </button>
      </div>

      {tables.length > 0 && (
        <div className="db-tables">
          {tables.map((t) => (
            <button key={t} className={'db-table-chip' + (t === activeTable ? ' active' : '')} onClick={() => pickTable(t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {activeTable && columns.length > 0 && (
        <div className="db-columns-hint">{columns.map((c) => `${c.name} (${c.dataType}${c.nullable ? '' : ', not null'})`).join(' · ')}</div>
      )}

      <div className="db-query-row">
        <textarea
          className="db-sql-input"
          placeholder="SELECT * FROM …  (Ctrl/Cmd+Enter to run)"
          value={sql}
          spellCheck={false}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="db-run-btn" disabled={!sql.trim() || running} onClick={run} title="Run (Ctrl/Cmd+Enter)">
          <IconRun size={13} /> {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {result && (
        <div className="db-results">
          {result.affected != null ? (
            <div className="db-affected">{result.affected} row(s) affected.</div>
          ) : result.columns.length === 0 ? (
            <div className="docker-empty">No rows.</div>
          ) : (
            <table className="db-grid">
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell === null ? <span className="db-null">NULL</span> : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.truncated && (
            <div className="db-truncated">
              Showing first {result.rows.length} of {result.rowCount} rows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
