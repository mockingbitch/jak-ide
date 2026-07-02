//! Interactive `docker exec -it <id> ...` session over WebSocket. Same
//! PTY-backed wire protocol as terminal.rs (start/input/resize →
//! started/data/exit), just scoped to a container instead of a local shell —
//! kept as its own small session type rather than generalizing terminal.rs,
//! since the two have different targets (local shell vs. remote container)
//! and no shared state.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Path;
use axum::response::Response;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use tokio::sync::mpsc::{self, Sender};

pub async fn ws_exec(ws: WebSocketUpgrade, Path(id): Path<String>) -> Response {
    ws.on_upgrade(move |socket| session_loop(socket, id))
}

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

async fn session_loop(mut socket: WebSocket, id: String) {
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(256);
    let gen = Arc::new(AtomicU64::new(0));
    let mut session: Option<Session> = None;

    loop {
        tokio::select! {
            Some(msg) = out_rx.recv() => {
                if socket.send(msg).await.is_err() {
                    break;
                }
            }
            inbound = socket.recv() => {
                let Some(Ok(msg)) = inbound else { break };
                match msg {
                    Message::Text(t) => handle_client(&t, &id, &gen, &out_tx, &mut session),
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    if let Some(mut s) = session.take() {
        graceful_shutdown(&mut s).await;
    }
}

/// `docker exec -it` has no "kill the remote process when the client
/// disconnects" primitive — killing our local `docker` client process (via
/// `killer.kill()`) leaves the container-side shell running as an orphan
/// indefinitely (verified against a real container: it was still there
/// several seconds after the client died). Best effort: interrupt whatever's
/// running in the foreground (Ctrl-C) and ask the shell itself to `exit`,
/// giving the container-side process a real chance to end on its own before
/// falling back to killing the local client either way.
async fn graceful_shutdown(s: &mut Session) {
    let _ = s.writer.write_all(b"\x03\nexit\n");
    let _ = s.writer.flush();
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    let _ = s.killer.kill();
}

fn handle_client(text: &str, id: &str, gen: &Arc<AtomicU64>, out_tx: &Sender<Message>, session: &mut Option<Session>) {
    let Ok(msg) = serde_json::from_str::<Value>(text) else { return };
    match msg.get("type").and_then(Value::as_str) {
        Some("start") => start(&msg, id, gen, out_tx, session),
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

fn start(msg: &Value, id: &str, gen: &Arc<AtomicU64>, out_tx: &Sender<Message>, session: &mut Option<Session>) {
    let my_gen = gen.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(mut prev) = session.take() {
        let _ = prev.killer.kill();
    }
    let (cols, rows) = clamp_size(msg.get("cols"), msg.get("rows"));

    match spawn_pty(id, cols, rows, my_gen, gen.clone(), out_tx.clone()) {
        Ok(s) => {
            *session = Some(s);
            let _ = out_tx.try_send(text_msg(json!({ "type": "started", "id": id })));
        }
        Err(e) => {
            let _ = out_tx.try_send(text_msg(json!({
                "type": "data",
                "data": format!("\r\n\x1b[31mFailed to exec into {id}: {e}\x1b[0m\r\n"),
            })));
            let _ = out_tx.try_send(text_msg(json!({ "type": "exit", "code": -1 })));
        }
    }
}

/// Prefer bash when the image has it, fall back to the always-present `sh`
/// for minimal images (alpine, distroless-ish). Checking with `command -v`
/// before `exec`ing matters: POSIX shells terminate immediately when `exec`
/// can't find its target, so a bare `exec bash || exec sh` never reaches the
/// fallback — confirmed against a real alpine-based container.
const SHELL_FALLBACK: &str = "command -v bash >/dev/null 2>&1 && exec bash || exec sh";

fn spawn_pty(id: &str, cols: u16, rows: u16, my_gen: u64, gen: Arc<AtomicU64>, out_tx: Sender<Message>) -> Result<Session, String> {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("docker");
    cmd.args(["exec", "-it", id, "sh", "-c", SHELL_FALLBACK]);
    cmd.env("TERM", "xterm-256color");

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

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
                    if r_tx.blocking_send(text_msg(json!({ "type": "data", "data": data }))).is_err() {
                        break; // connection gone
                    }
                }
            }
        }
    });

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
