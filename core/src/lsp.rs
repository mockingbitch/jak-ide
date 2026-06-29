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
use tokio::io::{AsyncReadExt, AsyncWriteExt};
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

/// (program, args) of the language server for a Monaco language id, or None if we
/// don't support it. The program is resolved on PATH (the desktop launcher prepends
/// its node_modules/.bin); an env override allows pinning an explicit binary.
fn server_for(lang: &str) -> Option<(String, Vec<&'static str>)> {
    let env_or = |key: &str, default: &str| std::env::var(key).unwrap_or_else(|_| default.into());
    match lang {
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact" => {
            Some((env_or("JAKIDE_LSP_TYPESCRIPT", "typescript-language-server"), vec!["--stdio"]))
        }
        "python" => Some((env_or("JAKIDE_LSP_PYTHON", "pyright-langserver"), vec!["--stdio"])),
        "go" => Some((env_or("JAKIDE_LSP_GO", "gopls"), vec![])),
        "php" => Some((env_or("JAKIDE_LSP_PHP", "intelephense"), vec!["--stdio"])),
        _ => None,
    }
}

async fn session(mut socket: WebSocket, st: Arc<AppState>, lang: String) {
    let Some((prog, args)) = server_for(&lang) else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };
    let mut child = match Command::new(&prog)
        .args(&args)
        .current_dir(&st.root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            // Surface the spawn failure as an LSP-ish error frame, then close.
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
