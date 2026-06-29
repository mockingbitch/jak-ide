//! Streaming command runner over WebSocket — backs the Run tool window (U14/U15).
//! Unlike the interactive terminal (PTY), a run config just executes one command
//! and streams its captured stdout/stderr until it exits.
//!   client → server: {type:"start", command} | {type:"stop"}
//!   server → client: {type:"started", command} | {type:"output", stream, data} | {type:"exit", code}
//! Disconnecting (or a new "start") kills the current child.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::mpsc::{self, Sender};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/ws/run", get(ws_upgrade))
}

async fn ws_upgrade(ws: WebSocketUpgrade, State(st): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| session_loop(socket, st))
}

fn text_msg(v: Value) -> Message {
    Message::Text(v.to_string())
}

async fn session_loop(mut socket: WebSocket, st: Arc<AppState>) {
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
    // Signals the in-flight run to stop; replaced on each start, dropped on disconnect.
    let mut stop_tx: Option<mpsc::Sender<()>> = None;

    loop {
        tokio::select! {
            Some(msg) = out_rx.recv() => {
                if socket.send(msg).await.is_err() {
                    break;
                }
            }
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(t))) => handle_client(&t, &st, &out_tx, &mut stop_tx),
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    if let Some(tx) = stop_tx.take() {
        let _ = tx.try_send(()); // kill the child on disconnect
    }
}

fn handle_client(text: &str, st: &Arc<AppState>, out_tx: &Sender<Message>, stop_tx: &mut Option<Sender<()>>) {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return };
    match v.get("type").and_then(Value::as_str) {
        Some("start") => {
            let command = v.get("command").and_then(Value::as_str).unwrap_or("").trim().to_string();
            if command.is_empty() {
                let _ = out_tx.try_send(text_msg(json!({ "type": "exit", "code": -1 })));
                return;
            }
            // Kill any previous run on this socket first.
            if let Some(tx) = stop_tx.take() {
                let _ = tx.try_send(());
            }
            let (s_tx, s_rx) = mpsc::channel::<()>(1);
            *stop_tx = Some(s_tx);
            let _ = out_tx.try_send(text_msg(json!({ "type": "started", "command": command })));
            tokio::spawn(run_once(command, st.root(), out_tx.clone(), s_rx));
        }
        Some("stop") => {
            if let Some(tx) = stop_tx.take() {
                let _ = tx.try_send(());
            }
        }
        _ => {}
    }
}

/// Spawn `sh -c <command>` in the project root, stream stdout/stderr, and send a
/// final exit code. `stop_rx` (or being dropped — `kill_on_drop`) terminates it.
async fn run_once(command: String, root: PathBuf, out_tx: Sender<Message>, mut stop_rx: mpsc::Receiver<()>) {
    let mut child = match Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0) // own process group so we can kill the command AND its children
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = out_tx.send(text_msg(json!({ "type": "output", "stream": "stderr", "data": format!("Failed to start: {e}\n") }))).await;
            let _ = out_tx.send(text_msg(json!({ "type": "exit", "code": -1 }))).await;
            return;
        }
    };

    // Captured before reaping: `process_group(0)` makes pgid == child pid. Used to
    // kill the whole group; while a grandchild is alive the pgid stays allocated, so
    // this can't hit a reused pid.
    let pgid = child.id();
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let h_out = tokio::spawn(drain(stdout, "stdout", out_tx.clone()));
    let h_err = tokio::spawn(drain(stderr, "stderr", out_tx.clone()));

    let code: i64 = tokio::select! {
        status = child.wait() => exit_code(status),
        _ = stop_rx.recv() => {
            // the child.wait() future is dropped here, releasing its &mut borrow.
            kill_group(pgid);
            let _ = child.start_kill();
            exit_code(child.wait().await)
        }
    };

    // Flush buffered output before announcing exit. `sh -c` can background a grandchild
    // that keeps the stdout/stderr pipe open even after `sh` exits, so the drains would
    // never EOF — bound the wait, then kill the group (still alive ⇒ pgid valid) so the
    // pipes close, and announce exit regardless. abort_handle()s are taken first so the
    // JoinHandles can move into the flush future.
    let (abort_out, abort_err) = (h_out.abort_handle(), h_err.abort_handle());
    tokio::select! {
        _ = async move { let _ = h_out.await; let _ = h_err.await; } => {}
        _ = tokio::time::sleep(Duration::from_millis(300)) => {
            kill_group(pgid);
            abort_out.abort();
            abort_err.abort();
        }
    }
    let _ = out_tx.send(text_msg(json!({ "type": "exit", "code": code }))).await;
}

fn exit_code(status: std::io::Result<std::process::ExitStatus>) -> i64 {
    status.map(|s| s.code().map(|c| c as i64).unwrap_or(-1)).unwrap_or(-1)
}

/// SIGKILL a process group by its leader pid (the child leads its own group via
/// `process_group(0)`, so pgid == child pid). Negative pid targets the whole group.
fn kill_group(pgid: Option<u32>) {
    if let Some(pid) = pgid {
        if pid > 1 {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
}

async fn drain<R: AsyncReadExt + Unpin>(mut r: R, stream: &'static str, out_tx: Sender<Message>) {
    let mut buf = [0u8; 8192];
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                if out_tx.send(text_msg(json!({ "type": "output", "stream": stream, "data": data }))).await.is_err() {
                    break;
                }
            }
        }
    }
}
