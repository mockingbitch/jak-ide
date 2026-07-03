//! Language Server bridge (U18). `GET /ws/lsp?lang=<id>` spawns the matching LSP
//! server and bridges JSON-RPC between it and the WebSocket:
//!   - server stdio is Content-Length framed (the LSP base protocol);
//!   - the WebSocket carries one bare JSON-RPC message per text frame
//!     (the `vscode-ws-jsonrpc` convention the frontend client uses).
//! The server runs with cwd = project root; disconnecting kills it.

use std::process::Stdio;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdout;
use tokio::process::Command;
use tokio::sync::mpsc::{self, Sender};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/ws/lsp", get(ws_upgrade))
}

#[derive(Deserialize)]
struct LspQuery {
    lang: Option<String>,
}

async fn ws_upgrade(ws: WebSocketUpgrade, Query(q): Query<LspQuery>, State(st): State<Arc<AppState>>) -> Response {
    let lang = q.lang.unwrap_or_default();
    ws.on_upgrade(move |socket| session(socket, st, lang))
}

/// How to launch the language server for a Monaco language id.
struct ServerCmd {
    prog: String,
    args: Vec<String>,
    /// Run `prog` as Node (Electron via ELECTRON_RUN_AS_NODE) — set when we launch a
    /// bundled `.js`/`.mjs` server entry through the app's own runtime.
    as_node: bool,
}

/// The language server for a Monaco language id, or None if unsupported. Resolution
/// order per language:
///  1. `JAKIDE_LSP_<LANG>` — an explicit server binary (a name on PATH or an absolute path).
///  2. `JAKIDE_LSP_NODE` + `JAKIDE_LSP_<LANG>_MODULE` — run the bundled JS server entry
///     via the app's Node-capable runtime. This is how the packaged desktop app finds
///     its servers without relying on `node_modules/.bin` symlinks (electron-builder
///     does not recreate them, so a bare-name PATH lookup fails there).
///  3. A bare program name resolved on PATH (the dev default, where `.bin` exists).
fn server_for(lang: &str) -> Option<ServerCmd> {
    let var = |key: &str| std::env::var(key).ok().filter(|s| !s.is_empty());
    let (bin_key, module_key, default_prog, args): (&str, &str, &str, &[&str]) = match lang {
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact" => {
            ("JAKIDE_LSP_TYPESCRIPT", "JAKIDE_LSP_TYPESCRIPT_MODULE", "typescript-language-server", &["--stdio"])
        }
        "python" => ("JAKIDE_LSP_PYTHON", "JAKIDE_LSP_PYTHON_MODULE", "pyright-langserver", &["--stdio"]),
        "go" => ("JAKIDE_LSP_GO", "JAKIDE_LSP_GO_MODULE", "gopls", &[]),
        "php" => ("JAKIDE_LSP_PHP", "JAKIDE_LSP_PHP_MODULE", "intelephense", &["--stdio"]),
        _ => return None,
    };
    let str_args = || args.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();

    // 1. Explicit binary override.
    if let Some(bin) = var(bin_key) {
        return Some(ServerCmd { prog: bin, args: str_args(), as_node: false });
    }
    // 2. Bundled JS module run via the app's Node runtime (packaged app).
    if let (Some(rt), Some(module)) = (var("JAKIDE_LSP_NODE"), var(module_key)) {
        let mut a = vec![module];
        a.extend(str_args());
        return Some(ServerCmd { prog: rt, args: a, as_node: true });
    }
    // 3. Bare program name resolved on PATH (dev).
    Some(ServerCmd { prog: default_prog.to_string(), args: str_args(), as_node: false })
}

async fn session(mut socket: WebSocket, st: Arc<AppState>, lang: String) {
    let Some(cmd) = server_for(&lang) else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };
    let mut command = Command::new(&cmd.prog);
    command
        .args(&cmd.args)
        .current_dir(&st.root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if cmd.as_node {
        // Make the bundled Electron binary behave like Node for the server entry.
        command.env("ELECTRON_RUN_AS_NODE", "1");
    }
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            // Surface the spawn failure as an LSP-ish error frame, then close.
            let prog = &cmd.prog;
            let _ = socket
                .send(Message::Text(format!(
                    r#"{{"jsonrpc":"2.0","method":"window/logMessage","params":{{"type":1,"message":"Failed to start {prog}: {e}"}}}}"#
                )))
                .await;
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    // Forward the server's stderr to our own logs, line by line, so diagnostics from
    // intelephense/pyright/etc. are visible (was previously discarded).
    if let Some(stderr) = child.stderr.take() {
        let lang = lang.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[lsp:{lang}] {line}");
            }
        });
    }
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
    tokio::spawn(read_server(stdout, out_tx));

    loop {
        tokio::select! {
            msg = out_rx.recv() => {
                match msg {
                    Some(msg) => {
                        if socket.send(msg).await.is_err() {
                            break;
                        }
                    }
                    None => break, // the server's reader task ended (server exited) → close the WS
                }
            }
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(t))) => {
                        // Frame the bare JSON-RPC message for the server's stdio.
                        let frame = format!("Content-Length: {}\r\n\r\n{}", t.len(), t);
                        if stdin.write_all(frame.as_bytes()).await.is_err() {
                            break;
                        }
                        let _ = stdin.flush().await;
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    let _ = child.start_kill();
}

/// Read the server's Content-Length-framed stdout and forward each JSON-RPC body
/// as one WebSocket text frame.
async fn read_server(mut stdout: ChildStdout, out_tx: Sender<Message>) {
    let mut buf: Vec<u8> = Vec::with_capacity(8192);
    let mut tmp = [0u8; 8192];
    loop {
        match stdout.read(&mut tmp).await {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
        // Drain every complete message currently in the buffer.
        loop {
            let Some(sep) = find(&buf, b"\r\n\r\n") else { break };
            let Some(len) = content_length(&buf[..sep]) else {
                buf.drain(..sep + 4); // malformed header — resync past it
                continue;
            };
            let body_start = sep + 4;
            if buf.len() < body_start + len {
                break; // body not fully arrived yet
            }
            let body: Vec<u8> = buf[body_start..body_start + len].to_vec();
            buf.drain(..body_start + len);
            if let Ok(s) = String::from_utf8(body) {
                if out_tx.send(Message::Text(s)).await.is_err() {
                    return;
                }
            }
        }
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn content_length(header: &[u8]) -> Option<usize> {
    let s = std::str::from_utf8(header).ok()?;
    for line in s.split("\r\n") {
        if let Some(v) = line.strip_prefix("Content-Length:") {
            return v.trim().parse().ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_length_among_headers() {
        assert_eq!(content_length(b"Content-Length: 42"), Some(42));
        assert_eq!(content_length(b"Content-Type: x\r\nContent-Length: 7"), Some(7));
        assert_eq!(content_length(b"X-Other: 1"), None);
    }

    #[test]
    fn finds_header_separator() {
        assert_eq!(find(b"abc\r\n\r\nbody", b"\r\n\r\n"), Some(3));
        assert_eq!(find(b"no-sep", b"\r\n\r\n"), None);
    }

    #[test]
    fn known_languages_resolve_a_server() {
        assert!(server_for("typescript").is_some());
        assert!(server_for("javascriptreact").is_some());
        assert!(server_for("ruby").is_none());
    }
}
