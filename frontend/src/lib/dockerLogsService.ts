import { useDockerStore } from './dockerStore';
import { cleanOutput } from './ansi';

// The /ws/docker/logs/:id socket lives at module scope (not the panel) so a
// container switch always tears down the previous stream cleanly, mirroring
// runnerService's superseded-socket handling.
let ws: WebSocket | null = null;

function detachAndClose(sock: WebSocket): void {
  sock.onopen = null;
  sock.onmessage = null;
  sock.onclose = null;
  sock.onerror = null;
  if (sock.readyState === WebSocket.CONNECTING) {
    sock.addEventListener('open', () => sock.close(), { once: true });
  } else if (sock.readyState === WebSocket.OPEN) {
    sock.close();
  }
}

/** Start streaming `docker logs -f` for a container. Replaces any prior stream. */
export function startDockerLogs(id: string): void {
  if (ws) {
    detachAndClose(ws);
    ws = null;
  }

  useDockerStore.getState().setLogsStreaming(true);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws/docker/logs/${encodeURIComponent(id)}`);
  ws = sock;

  sock.onmessage = (e) => {
    if (ws !== sock) return; // superseded socket — never touch the store
    let m: { type?: string; data?: string };
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === 'output') {
      useDockerStore.getState().appendLog(cleanOutput(m.data ?? ''));
    } else if (m.type === 'exit') {
      useDockerStore.getState().setLogsStreaming(false);
      ws = null;
      sock.close();
    }
  };
  sock.onclose = () => {
    if (ws === sock) {
      ws = null;
      useDockerStore.getState().setLogsStreaming(false);
    }
  };
}

/** Stop the current log stream (e.g. the logs view was closed). */
export function stopDockerLogs(): void {
  if (ws) {
    detachAndClose(ws);
    ws = null;
  }
  useDockerStore.getState().setLogsStreaming(false);
}
