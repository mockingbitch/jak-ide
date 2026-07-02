import { describe, it, expect, beforeEach } from 'vitest';
import { useDockerStore } from './dockerStore';
import type { DockerContainer, DockerImage } from '../types';

const st = () => useDockerStore.getState();

const container = (over: Partial<DockerContainer> = {}): DockerContainer => ({
  id: 'c1',
  name: 'web-1',
  image: 'nginx:1.27',
  state: 'running',
  status: 'Up 2 days',
  ports: '0.0.0.0:8080->80/tcp',
  createdAt: '2026-06-30 10:00:00',
  ...over,
});

const image = (over: Partial<DockerImage> = {}): DockerImage => ({
  id: 'sha256:abc',
  repository: 'nginx',
  tag: '1.27',
  size: '187MB',
  createdSince: '2 weeks ago',
  ...over,
});

beforeEach(() => {
  useDockerStore.setState({
    view: 'containers',
    status: null,
    containers: [],
    images: [],
    loading: false,
    error: null,
    busyId: null,
    logsContainerId: null,
    logs: '',
    logsStreaming: false,
    inspectContainerId: null,
    inspectDetail: null,
    inspectLoading: false,
    inspectError: null,
    execContainerId: null,
  });
});

describe('dockerStore', () => {
  it('switches between the containers and images tabs', () => {
    expect(st().view).toBe('containers');
    st().setView('images');
    expect(st().view).toBe('images');
  });

  it('stores fetched containers and images', () => {
    st().setContainers([container(), container({ id: 'c2', name: 'db-1', state: 'exited' })]);
    st().setImages([image()]);
    expect(st().containers).toHaveLength(2);
    expect(st().containers[1].state).toBe('exited');
    expect(st().images[0].repository).toBe('nginx');
  });

  it('tracks the busy id for an in-flight action independently per row', () => {
    st().setBusy('c1');
    expect(st().busyId).toBe('c1');
    st().setBusy(null);
    expect(st().busyId).toBeNull();
  });

  it('opening logs resets any previous log buffer/stream flag; closing clears it', () => {
    st().appendLog('stale output');
    st().setLogsStreaming(true);
    st().openLogs('c1');
    expect(st().logsContainerId).toBe('c1');
    expect(st().logs).toBe('');
    expect(st().logsStreaming).toBe(false);

    st().appendLog('fresh line\n');
    expect(st().logs).toBe('fresh line\n');
    st().closeLogs();
    expect(st().logsContainerId).toBeNull();
    expect(st().logs).toBe('');
  });

  it('appendLog concatenates and caps the buffer so a runaway stream cannot grow forever', () => {
    st().appendLog('a'.repeat(10));
    st().appendLog('b'.repeat(10));
    expect(st().logs).toBe('a'.repeat(10) + 'b'.repeat(10));

    // Exceed the cap with one huge chunk — should truncate, keeping only the tail.
    st().appendLog('c'.repeat(2_000_000));
    expect(st().logs.length).toBeLessThan(2_000_000);
    expect(st().logs.startsWith('…(truncated)…\n')).toBe(true);
    expect(st().logs.endsWith('c')).toBe(true);
  });

  it('surfaces and clears a fetch error', () => {
    st().setError('Docker daemon is not running.');
    expect(st().error).toBe('Docker daemon is not running.');
    st().setError(null);
    expect(st().error).toBeNull();
  });

  it('opening inspect starts a fresh load and closes any other detail view', () => {
    st().openLogs('c1');
    st().openInspect('c2');
    expect(st().inspectContainerId).toBe('c2');
    expect(st().inspectLoading).toBe(true);
    expect(st().inspectDetail).toBeNull();
    expect(st().logsContainerId).toBeNull(); // logs view closed by opening inspect

    st().setInspectDetail({
      id: 'c2',
      name: 'web-1',
      image: 'nginx:1.27',
      command: 'nginx -g daemon off;',
      created: '2026-06-30T10:00:00Z',
      state: 'running',
      startedAt: '2026-06-30T10:00:05Z',
      finishedAt: '0001-01-01T00:00:00Z',
      restartCount: 0,
      platform: 'linux',
      ipAddress: '172.17.0.2',
      ports: [],
      mounts: [],
      env: [],
      labels: [],
      networks: [],
    });
    expect(st().inspectLoading).toBe(false);
    expect(st().inspectDetail?.image).toBe('nginx:1.27');

    st().closeInspect();
    expect(st().inspectContainerId).toBeNull();
    expect(st().inspectDetail).toBeNull();
  });

  it('a failed inspect load surfaces the error and clears the loading flag', () => {
    st().openInspect('c1');
    st().setInspectError('Container not found');
    expect(st().inspectError).toBe('Container not found');
    expect(st().inspectLoading).toBe(false);
  });

  it('opening exec closes any other detail view; opening logs/inspect closes exec', () => {
    st().openExec('c1');
    expect(st().execContainerId).toBe('c1');

    st().openLogs('c2');
    expect(st().execContainerId).toBeNull();

    st().openExec('c1');
    st().openInspect('c2');
    expect(st().execContainerId).toBeNull();

    st().openExec('c1');
    st().closeExec();
    expect(st().execContainerId).toBeNull();
  });
});
