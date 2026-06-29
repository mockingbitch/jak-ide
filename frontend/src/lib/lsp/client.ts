import type { LspDiagnostic } from './protocol';

// A thin LSP client over the Rust /ws/lsp bridge. JSON-RPC messages go as bare
// WebSocket text frames (the bridge adds Content-Length for the server's stdio).
// Document ops/requests issued before `initialize` resolves are queued.

export interface LspClient {
  open(uri: string, languageId: string, text: string): void;
  change(uri: string, text: string): void;
  close(uri: string): void;
  request<T>(method: string, params: unknown): Promise<T>;
  dispose(): void;
}

interface LspClientOpts {
  lang: string;
  rootUri: string;
  onDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void;
}

interface LspMessage {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: { uri?: string; diagnostics?: LspDiagnostic[] };
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT = 15000;

export function createLspClient(opts: LspClientOpts): LspClient {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/lsp?lang=${encodeURIComponent(opts.lang)}`);
  let ready = false;
  let closed = false; // socket gone (closed/disposed/init-failed) — no more traffic
  let nextId = 2; // id 1 is reserved for initialize
  const pending = new Map<number, Pending>();
  const queue: Array<() => void> = [];
  const versions = new Map<string, number>();

  const raw = (msg: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const whenReady = (fn: () => void) => {
    if (closed) return;
    if (ready) fn();
    else queue.push(fn);
  };
  const settle = (id: number, fn: (p: Pending) => void) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    fn(p);
  };
  const failAll = (reason: string) => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  };

  ws.onopen = () => {
    raw({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: null,
        rootUri: opts.rootUri,
        workspaceFolders: [{ uri: opts.rootUri, name: 'workspace' }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: false, dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false },
            completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
          },
        },
      },
    });
  };

  ws.onmessage = (e) => {
    if (closed) return; // ignore in-flight frames after the client is torn down
    let m: LspMessage;
    try {
      m = JSON.parse(e.data) as LspMessage;
    } catch {
      return;
    }
    // initialize handshake (sent via raw(), not tracked in `pending`).
    if (m.id === 1) {
      if (m.result !== undefined) {
        raw({ jsonrpc: '2.0', method: 'initialized', params: {} });
        ready = true;
        for (const fn of queue.splice(0)) fn();
      } else if (m.error !== undefined) {
        // Fatal: settle everything so callers don't hang, and stop.
        closed = true;
        failAll('LSP initialize failed: ' + (m.error.message ?? 'unknown'));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    // request response
    if (typeof m.id === 'number' && (m.result !== undefined || m.error !== undefined)) {
      settle(m.id, (p) => (m.error ? p.reject(new Error(m.error.message ?? 'LSP error')) : p.resolve(m.result)));
      return;
    }
    // server → client request (registerCapability, workspace/configuration, …): we
    // don't implement these but MUST reply so the server isn't left waiting.
    if (typeof m.id === 'number' && m.method) {
      const result = m.method === 'workspace/configuration' ? [] : null;
      raw({ jsonrpc: '2.0', id: m.id, result });
      return;
    }
    // notifications
    if (m.method === 'textDocument/publishDiagnostics' && m.params?.uri) {
      opts.onDiagnostics(m.params.uri, m.params.diagnostics ?? []);
    }
  };

  ws.onclose = () => {
    closed = true;
    ready = false;
    failAll('LSP disconnected');
  };
  ws.onerror = () => {};

  return {
    open(uri, languageId, text) {
      versions.set(uri, 1);
      whenReady(() => raw({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId, version: 1, text } } }));
    },
    change(uri, text) {
      const v = (versions.get(uri) ?? 1) + 1;
      versions.set(uri, v);
      // Full-document sync (contentChanges with just {text}) — simplest + correct.
      whenReady(() => raw({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: v }, contentChanges: [{ text }] } }));
    },
    close(uri) {
      versions.delete(uri);
      whenReady(() => raw({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri } } }));
    },
    request<T>(method: string, params: unknown) {
      return new Promise<T>((resolve, reject) => {
        if (closed) {
          reject(new Error('LSP client closed'));
          return;
        }
        const id = nextId++;
        const timer = setTimeout(() => settle(id, (p) => p.reject(new Error('LSP request timed out'))), REQUEST_TIMEOUT);
        pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
        whenReady(() => raw({ jsonrpc: '2.0', id, method, params }));
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      failAll('LSP client disposed');
    },
  };
}
