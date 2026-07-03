import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useStore } from '../store';
import { xtermTheme, terminalFontFamily } from '../theme';

function safeCloseWs(ws: WebSocket | null) {
  if (!ws) return;
  if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws.close(), { once: true });
  else if (ws.readyState === WebSocket.OPEN) ws.close();
}

/** One terminal session: its own xterm + PTY WebSocket. Defaults to a local
 *  shell session (`shellPath` required); passing `wsPath` instead points the
 *  same xterm/PTY wiring at a different backend session (e.g. `docker exec`)
 *  that doesn't take a `shell` field in its start payload.
 *  Stays mounted when not visible (hidden via CSS) so its session keeps running. */
export function TerminalInstance({
  shellPath,
  wsPath = '/ws/terminal',
  visible,
}: {
  shellPath?: string;
  wsPath?: string;
  visible: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const theme = useStore((s) => s.theme);

  // Create the xterm + connect the PTY once.
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontSize: theme.fontSize,
      fontFamily: terminalFontFamily(theme.fontFamily),
      cursorBlink: true,
      theme: xtermTheme(theme),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
    }
    termRef.current = term;
    fitRef.current = fit;

    term.onData((d) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    });
    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${wsPath}`);
    wsRef.current = ws;
    ws.onopen = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      const start: Record<string, unknown> = { type: 'start', cols: term.cols, rows: term.rows };
      if (shellPath) start.shell = shellPath;
      ws.send(JSON.stringify(start));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'data') term.write(msg.data);
      else if (msg.type === 'exit') {
        const code = msg.code != null && msg.code >= 0 ? ` (${msg.code})` : '';
        term.write(`\r\n\x1b[90m[process exited${code}]\x1b[0m\r\n`);
      }
    };
    ws.onclose = () => {
      if (wsRef.current === ws) term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');
    };

    const refit = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', refit);
    const ro = new ResizeObserver(refit);
    ro.observe(hostRef.current);

    return () => {
      window.removeEventListener('resize', refit);
      ro.disconnect();
      safeCloseWs(wsRef.current);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When this tab becomes visible, refit + focus.
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      termRef.current?.focus();
    }, 0);
    return () => clearTimeout(id);
  }, [visible]);

  // Live theme + font-size sync.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = xtermTheme(theme);
    term.options.fontSize = theme.fontSize;
    term.options.fontFamily = terminalFontFamily(theme.fontFamily);
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [theme]);

  return <div className="xterm-host" style={{ display: visible ? 'block' : 'none' }} ref={hostRef} />;
}
