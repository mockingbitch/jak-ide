//! Interactive terminal over WebSocket, backed by a real PTY (`portable-pty`).
//! Mirrors the Node `/ws/terminal` protocol exactly:
//!   client → server: {type:"start", shell?, cols?, rows?} | {type:"input", data}
//!                     | {type:"resize", cols, rows}
//!   server → client: {type:"started", shell} | {type:"data", data} | {type:"exit", code}
//! Plus `GET /api/terminal/shells` → { shells:[{name,path}], default }.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use tokio::sync::mpsc::{self, Sender};

use crate::shells::list_shells;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/terminal/shells", get(shells))
        .route("/ws/terminal", get(ws_upgrade))
}

async fn shells() -> Json<Value> {
    let s = list_shells();
    Json(json!({ "shells": s.shells, "default": s.default }))
}

async fn ws_upgrade(ws: WebSocketUpgrade, State(st): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| session_loop(socket, st))
}

/// One PTY-backed shell, owned entirely by the connection's task.
struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

fn clamp_size(cols: Option<&Value>, rows: Option<&Value>) -> (u16, u16) {
    let c = cols.and_then(Value::as_u64).unwrap_or(80).max(2) as u16;
    let r = rows.and_then(Value::as_u64).unwrap_or(24).max(1) as u16;
    (c, r)
}

async fn session_loop(mut socket: WebSocket, st: Arc<AppState>) {
    // Bounded: when the client is slow the channel fills, the reader thread's
    // blocking_send parks, the PTY's own buffer backs up, and the shell throttles
    // itself — bounded memory without explicit pause/resume.
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
    let gen = Arc::new(AtomicU64::new(0));
    let mut session: Option<Session> = None;

    loop {
        tokio::select! {
            // Outbound: PTY data / exit produced by the reader & wait threads.
            Some(msg) = out_rx.recv() => {
                if socket.send(msg).await.is_err() {
                    break;
                }
            }
            // Inbound: client control messages.
            inbound = socket.recv() => {
                let Some(Ok(msg)) = inbound else { break };
                match msg {
                    Message::Text(t) => handle_client(&t, &st, &gen, &out_tx, &mut session),
                    Message::Close(_) => break,
                    _ => {} // ignore binary/ping/pong
                }
            }
        }
    }

    if let Some(mut s) = session.take() {
        let _ = s.killer.kill();
    }
}

fn handle_client(
    text: &str,
    st: &Arc<AppState>,
    gen: &Arc<AtomicU64>,
    out_tx: &Sender<Message>,
    session: &mut Option<Session>,
) {
    let Ok(msg) = serde_json::from_str::<Value>(text) else { return };
    match msg.get("type").and_then(Value::as_str) {
        Some("start") => start(&msg, st, gen, out_tx, session),
        Some("input") => {
            if let (Some(s), Some(data)) = (session.as_mut(), msg.get("data").and_then(Value::as_str)) {
                let _ = s.writer.write_all(data.as_bytes());
                let _ = s.writer.flush();
            }
        }
        Some("resize") => {
            if let Some(s) = session.as_ref() {
                let (cols, rows) = clamp_size(msg.get("cols"), msg.get("rows"));
                let _ = s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
            }
        }
        _ => {}
    }
}

fn start(
    msg: &Value,
    st: &Arc<AppState>,
    gen: &Arc<AtomicU64>,
    out_tx: &Sender<Message>,
    session: &mut Option<Session>,
) {
    let my_gen = gen.fetch_add(1, Ordering::SeqCst) + 1;
    // Kill any prior shell on this socket before starting a new one.
    if let Some(mut prev) = session.take() {
        let _ = prev.killer.kill();
    }

    // Only exec a shell we actually enumerated — never an arbitrary path.
    let enumerated = list_shells();
    let requested = msg.get("shell").and_then(Value::as_str).unwrap_or("");
    let shell = if enumerated.shells.iter().any(|s| s.path == requested) {
        requested.to_string()
    } else {
        enumerated.default
    };
    let (cols, rows) = clamp_size(msg.get("cols"), msg.get("rows"));

    match spawn_pty(&shell, cols, rows, &st.root(), my_gen, gen.clone(), out_tx.clone()) {
        Ok(s) => {
            *session = Some(s);
            // try_send is safe here: these control messages are emitted while the
            // channel has room (right after a start, before bulk output).
            let _ = out_tx.try_send(text_msg(json!({ "type": "started", "shell": shell })));
        }
        Err(e) => {
            let _ = out_tx.try_send(text_msg(json!({
                "type": "data",
                "data": format!("\r\n\x1b[31mFailed to start {shell}: {e}\x1b[0m\r\n"),
            })));
            let _ = out_tx.try_send(text_msg(json!({ "type": "exit", "code": -1 })));
        }
    }
}

/// Open a PTY, spawn the shell, and wire up reader + wait threads that forward
/// `data`/`exit` to `out_tx`. Both threads no-op if a newer start superseded
/// this one (generation guard), matching the Node stale-session behavior.
fn spawn_pty(
    shell: &str,
    cols: u16,
    rows: u16,
    cwd: &std::path::Path,
    my_gen: u64,
    gen: Arc<AtomicU64>,
    out_tx: Sender<Message>,
) -> Result<Session, String> {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    cmd.env("TERM", "xterm-256color");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Reader thread: blocking PTY reads → {type:"data"} (UTF-8 lossy, like Node's string path).
    let r_tx = out_tx.clone();
    let r_gen = gen.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if r_gen.load(Ordering::SeqCst) != my_gen {
                        break; // superseded by a newer start
                    }
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    // blocking_send parks this thread when the client is slow → PTY backpressure.
                    if r_tx.blocking_send(text_msg(json!({ "type": "data", "data": data }))).is_err() {
                        break; // connection gone
                    }
                }
            }
        }
    });

    // Wait thread: block on child exit → {type:"exit"} (unless superseded).
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code() as i64).unwrap_or(-1);
        if gen.load(Ordering::SeqCst) == my_gen {
            let _ = out_tx.blocking_send(text_msg(json!({ "type": "exit", "code": code })));
        }
    });

    Ok(Session { writer, master: pair.master, killer })
}

fn text_msg(v: Value) -> Message {
    Message::Text(v.to_string())
}
