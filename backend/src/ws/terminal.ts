import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROJECT_ROOT } from '../config';
import { listShells } from '../services/shells';

/**
 * Lazily load the native node-pty module once. Returns the module (with `spawn`)
 * or null if it can't be loaded (e.g. not rebuilt for the current ABI).
 */
let ptyPromise: Promise<any | null> | null = null;
function loadPty(): Promise<any | null> {
  if (!ptyPromise) {
    ptyPromise = import('node-pty')
      .then((m: any) => (typeof m?.spawn === 'function' ? m : m?.default ?? null))
      .catch(() => null);
  }
  return ptyPromise;
}

const HIGH_WATER = 2_000_000; // bytes buffered on the socket before we pause the PTY
const LOW_WATER = 256_000;

/**
 * Real interactive terminal over WebSocket, backed by a PTY running the local
 * shell the user picked. The browser sends raw keystrokes; the shell handles
 * echo, line editing, colours, and full-screen TUIs.
 */
export function attachTerminal(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });
  wss.on('connection', (ws: WebSocket) => new TerminalSession(ws));
}

class TerminalSession {
  private ws: WebSocket;
  private proc: any = null;
  private gen = 0; // increments on every start(); guards against interleaved/stale sessions
  private paused = false;
  private resumeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw) => this.onMessage(raw));
    ws.on('close', () => this.dispose());
    ws.on('error', () => this.dispose());
  }

  private send(msg: unknown): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(raw: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'start') {
      void this.start(msg);
    } else if (msg.type === 'input' && this.proc) {
      try {
        this.proc.write(String(msg.data ?? ''));
      } catch {
        /* process gone */
      }
    } else if (msg.type === 'resize' && this.proc?.resize) {
      const cols = Math.max(2, Number(msg.cols) || 80);
      const rows = Math.max(1, Number(msg.rows) || 24);
      try {
        this.proc.resize(cols, rows);
      } catch {
        /* ignore */
      }
    }
  }

  private async start(msg: any): Promise<void> {
    const myGen = ++this.gen;
    this.dispose();

    const { shells, default: def } = listShells();
    // Only allow shells we actually enumerated — never exec an arbitrary path.
    const requested = typeof msg.shell === 'string' ? msg.shell : '';
    const shell = shells.some((s) => s.path === requested) ? requested : def;
    const cols = Math.max(2, Number(msg.cols) || 80);
    const rows = Math.max(1, Number(msg.rows) || 24);

    const pty = await loadPty();
    if (this.gen !== myGen) return; // a newer start() superseded this one while loading

    if (!pty) {
      this.send({
        type: 'data',
        data:
          '\r\n\x1b[31mThe terminal requires the native "node-pty" module, which failed to load.\x1b[0m\r\n' +
          'Packaged builds rebuild it automatically. From source, run:  cd backend && npm rebuild node-pty\r\n',
      });
      this.send({ type: 'exit', code: -1 });
      return;
    }

    let proc: any;
    try {
      proc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: PROJECT_ROOT,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (e: any) {
      this.send({ type: 'data', data: `\r\n\x1b[31mFailed to start ${shell}: ${e?.message ?? e}\x1b[0m\r\n` });
      this.send({ type: 'exit', code: -1 });
      return;
    }

    if (this.gen !== myGen) {
      // Superseded between spawn and assignment — don't leak this PTY.
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      return;
    }

    this.proc = proc;
    this.paused = false;
    this.send({ type: 'started', shell });

    proc.onData((d: string) => {
      this.send({ type: 'data', data: d });
      this.applyBackpressure(proc);
    });
    proc.onExit(({ exitCode }: { exitCode: number }) => {
      if (this.proc !== proc) return; // a stale process exiting after a new one started — ignore
      this.send({ type: 'exit', code: exitCode });
      this.clearResumeTimer();
      this.proc = null;
    });
  }

  /** Pause the PTY when the socket's send buffer is backing up; resume once drained. */
  private applyBackpressure(proc: any): void {
    const buffered = (this.ws as any).bufferedAmount ?? 0;
    if (this.paused || buffered <= HIGH_WATER || typeof proc.pause !== 'function') return;
    this.paused = true;
    try {
      proc.pause();
    } catch {
      /* ignore */
    }
    if (this.resumeTimer) return;
    this.resumeTimer = setInterval(() => {
      if (this.proc !== proc) {
        this.clearResumeTimer();
        return;
      }
      if (((this.ws as any).bufferedAmount ?? 0) < LOW_WATER) {
        this.paused = false;
        try {
          proc.resume?.();
        } catch {
          /* ignore */
        }
        this.clearResumeTimer();
      }
    }, 50);
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer) {
      clearInterval(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private dispose(): void {
    this.clearResumeTimer();
    this.paused = false;
    if (this.proc) {
      const p = this.proc;
      this.proc = null; // clear first so the stale onExit guard short-circuits
      try {
        p.kill();
      } catch {
        /* already gone */
      }
    }
  }
}
