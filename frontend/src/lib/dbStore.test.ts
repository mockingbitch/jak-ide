import { describe, it, expect, beforeEach } from 'vitest';
import { useDbStore } from './dbStore';
import type { DbConnInfo, DbQueryResult } from '../types';

const st = () => useDbStore.getState();

const conn: DbConnInfo = { engine: 'sqlite', database: '/tmp/test.db' };

const result = (over: Partial<DbQueryResult> = {}): DbQueryResult => ({
  columns: ['id', 'name'],
  rows: [[1, 'Ada']],
  rowCount: 1,
  truncated: false,
  affected: null,
  ...over,
});

beforeEach(() => {
  useDbStore.setState({
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
  });
});

describe('dbStore', () => {
  it('connect stores the id/name/connection info together and clears any prior error', () => {
    st().setError('previous failure');
    st().connect('c1', 'Local SQLite', conn);
    expect(st().activeConnectionId).toBe('c1');
    expect(st().activeName).toBe('Local SQLite');
    expect(st().activeConn).toEqual(conn);
    expect(st().error).toBeNull();
  });

  it('disconnect resets the whole session — connection, tables, query, and results', () => {
    st().connect('c1', 'Local SQLite', conn);
    st().setTables(['users', 'orders']);
    st().setActiveTable('users');
    st().setSql('SELECT * FROM users');
    st().setResult(result());

    st().disconnect();

    expect(st().activeConnectionId).toBeNull();
    expect(st().activeConn).toBeNull();
    expect(st().tables).toEqual([]);
    expect(st().activeTable).toBeNull();
    expect(st().sql).toBe('');
    expect(st().result).toBeNull();
  });

  it('tracks the query result independently of the connecting/running flags', () => {
    st().setRunning(true);
    st().setResult(result({ rowCount: 2, rows: [[1, 'Ada'], [2, 'Grace']] }));
    st().setRunning(false);
    expect(st().result?.rowCount).toBe(2);
    expect(st().running).toBe(false);
  });

  it('surfaces a query error without clobbering the active connection', () => {
    st().connect('c1', 'Local SQLite', conn);
    st().setError('Query failed: no such table: ghosts');
    expect(st().activeConnectionId).toBe('c1'); // still connected — only the query failed
    expect(st().error).toContain('no such table');
  });
});
