import { describe, it, expect, beforeEach } from 'vitest';
import { useDbConnectionsStore } from './dbConnectionsStore';
import type { DbConnectionProfile } from '../types';

const st = () => useDbConnectionsStore.getState();

const profile = (over: Partial<DbConnectionProfile> = {}): DbConnectionProfile => ({
  id: 'c1',
  name: 'Local MySQL',
  engine: 'mysql',
  host: 'localhost',
  port: 3306,
  user: 'root',
  database: 'app',
  password: 'ZW5jcnlwdGVk', // opaque ciphertext/plaintext — this store never inspects it
  encrypted: true,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  useDbConnectionsStore.setState({ connections: [] });
});

describe('dbConnectionsStore', () => {
  it('adds a connection and persists it to localStorage', () => {
    st().addConnection(profile());
    expect(st().connections).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('jakide.db.connections') || '[]')).toHaveLength(1);
  });

  it('replaces an existing connection with the same name instead of duplicating it', () => {
    st().addConnection(profile({ id: 'c1', host: 'localhost' }));
    st().addConnection(profile({ id: 'c2', host: 'other-host' })); // same name, re-saved
    expect(st().connections).toHaveLength(1);
    expect(st().connections[0].id).toBe('c2');
    expect(st().connections[0].host).toBe('other-host');
  });

  it('keeps connections with different names distinct', () => {
    st().addConnection(profile({ id: 'c1', name: 'A' }));
    st().addConnection(profile({ id: 'c2', name: 'B' }));
    expect(st().connections.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('removes a connection by id', () => {
    st().addConnection(profile({ id: 'c1' }));
    st().addConnection(profile({ id: 'c2', name: 'Other' }));
    st().removeConnection('c1');
    expect(st().connections.map((c) => c.id)).toEqual(['c2']);
  });

  it('never touches the password field — it stores whatever ciphertext it is given', () => {
    st().addConnection(profile({ password: 'plaintext-because-no-keychain', encrypted: false }));
    expect(st().connections[0].password).toBe('plaintext-because-no-keychain');
    expect(st().connections[0].encrypted).toBe(false);
  });
});
