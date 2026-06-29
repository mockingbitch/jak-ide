import { useRunStore } from './runStore';

// The /ws/run WebSocket lives at module scope (not in the panel) so a run keeps
// going while the user switches the bottom tool window away and back.
let ws: WebSocket | null = null;

/** Make a socket inert and close it, deferring the close if it's still connecting
 *  (closing a CONNECTING socket throws / is ignored). Used to hard-discard a
 *  superseded run so its handlers can never touch the store again. */
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

/** Start (or restart) a run. Streams output into the run store. */
export function startRun(command: string): void {
  const cmd = command.trim();
  if (!cmd) return;

  // Hard-discard any previous run first (closing the socket makes the server kill
  // its child group on disconnect); its handlers are detached so they can't mutate
  // the new run's state.
  if (ws) {
    detachAndClose(ws);
    ws = null;
  }

  useRunStore.getState().begin(cmd);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws/run`);
  ws = sock;

  sock.onopen = () => {
    if (ws === sock) sock.send(JSON.stringify({ type: 'start', command: cmd }));
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return; // superseded socket — never touch the store
    let m: { type?: string; data?: string; code?: number };
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === 'output') {
      useRunStore.getState().appendOutput(m.data ?? '');
    } else if (m.type === 'exit') {
      useRunStore.getState().finish(m.code ?? null);
      ws = null;
      sock.close();
    }
  };
  sock.onclose = () => {
    // Connection dropped without an exit (server gone / crashed) → mark interrupted.
    if (ws === sock) {
      ws = null;
      useRunStore.getState().interrupt();
    }
  };
}

/** Ask the server to stop the current run. The server kills the child's process
 *  group and replies with an exit, which finishes the run and closes the socket. */
export function stopRun(): void {
  const sock = ws;
  if (!sock) return;
  if (sock.readyState === WebSocket.OPEN) {
    sock.send(JSON.stringify({ type: 'stop' }));
  } else if (sock.readyState === WebSocket.CONNECTING) {
    sock.addEventListener('open', () => {
      try {
        sock.send(JSON.stringify({ type: 'stop' }));
      } catch {
        /* socket already gone */
      }
    }, { once: true });
  }
}
