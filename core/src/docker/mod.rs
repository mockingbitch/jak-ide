//! Docker tool window backend. Shells out to the `docker` CLI directly (no SDK
//! dependency) — the same pattern this app already uses for git, run configs, and
//! the Claude Code integration. Lists/controls containers and images, and streams
//! `docker logs -f <id>` over WebSocket (mirrors runner.rs's stream-and-exit shape).

use std::process::Stdio;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::mpsc::{self, Sender};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

mod exec;
mod inspect;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/docker/status", get(status))
        .route("/api/docker/containers", get(list_containers))
        .route("/api/docker/containers/:id/start", post(start_container))
        .route("/api/docker/containers/:id/stop", post(stop_container))
        .route("/api/docker/containers/:id/restart", post(restart_container))
        .route("/api/docker/containers/:id", delete(remove_container))
        .route("/api/docker/containers/:id/inspect", get(inspect::inspect_container))
        .route("/api/docker/images", get(list_images))
        .route("/api/docker/images/:id", delete(remove_image))
        .route("/ws/docker/logs/:id", get(ws_logs))
        .route("/ws/docker/exec/:id", get(exec::ws_exec))
}

// ---- shared `docker` CLI runner ----

struct DockerOutput {
    ok: bool,
    stdout: String,
    stderr: String,
}

async fn run(args: &[&str]) -> Result<DockerOutput, ApiError> {
    let out = Command::new("docker")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| ApiError::code(StatusCode::SERVICE_UNAVAILABLE, format!("Failed to run docker: {e}. Is Docker installed and on PATH?")))?;
    Ok(DockerOutput {
        ok: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

async fn action(args: &[&str]) -> ApiResult<Json<Value>> {
    let out = run(args).await?;
    if !out.ok {
        let msg = out.stderr.trim();
        return Err(ApiError::bad(if msg.is_empty() { format!("docker {} failed", args.join(" ")) } else { msg.to_string() }));
    }
    Ok(Json(json!({ "ok": true })))
}

fn parse_ndjson<T: serde::de::DeserializeOwned>(s: &str) -> Vec<T> {
    s.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str(l).ok()).collect()
}

// ---- status ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DockerStatus {
    installed: bool,
    running: bool,
}

async fn status() -> Json<DockerStatus> {
    let installed = run(&["--version"]).await.map(|o| o.ok).unwrap_or(false);
    let running = installed && run(&["info"]).await.map(|o| o.ok).unwrap_or(false);
    Json(DockerStatus { installed, running })
}

// ---- containers ----

#[derive(Deserialize)]
struct RawContainer {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    names: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "State")]
    state: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Ports")]
    ports: String,
    #[serde(rename = "CreatedAt")]
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Container {
    id: String,
    name: String,
    image: String,
    state: String,
    status: String,
    ports: String,
    created_at: String,
}

impl From<RawContainer> for Container {
    fn from(r: RawContainer) -> Self {
        Container { id: r.id, name: r.names, image: r.image, state: r.state, status: r.status, ports: r.ports, created_at: r.created_at }
    }
}

async fn list_containers() -> ApiResult<Json<Vec<Container>>> {
    let out = run(&["ps", "-a", "--format", "{{json .}}"]).await?;
    if !out.ok {
        let msg = out.stderr.trim();
        return Err(ApiError::code(StatusCode::SERVICE_UNAVAILABLE, if msg.is_empty() { "Docker daemon is not running.".to_string() } else { msg.to_string() }));
    }
    let raw: Vec<RawContainer> = parse_ndjson(&out.stdout);
    Ok(Json(raw.into_iter().map(Container::from).collect()))
}

async fn start_container(Path(id): Path<String>) -> ApiResult<Json<Value>> {
    action(&["start", &id]).await
}
async fn stop_container(Path(id): Path<String>) -> ApiResult<Json<Value>> {
    action(&["stop", &id]).await
}
async fn restart_container(Path(id): Path<String>) -> ApiResult<Json<Value>> {
    action(&["restart", &id]).await
}
async fn remove_container(Path(id): Path<String>) -> ApiResult<Json<Value>> {
    action(&["rm", "-f", &id]).await
}

// ---- images ----

#[derive(Deserialize)]
struct RawImage {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Repository")]
    repository: String,
    #[serde(rename = "Tag")]
    tag: String,
    #[serde(rename = "Size")]
    size: String,
    #[serde(rename = "CreatedSince")]
    created_since: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Image {
    id: String,
    repository: String,
    tag: String,
    size: String,
    created_since: String,
}

impl From<RawImage> for Image {
    fn from(r: RawImage) -> Self {
        Image { id: r.id, repository: r.repository, tag: r.tag, size: r.size, created_since: r.created_since }
    }
}

async fn list_images() -> ApiResult<Json<Vec<Image>>> {
    let out = run(&["images", "--format", "{{json .}}"]).await?;
    if !out.ok {
        let msg = out.stderr.trim();
        return Err(ApiError::code(StatusCode::SERVICE_UNAVAILABLE, if msg.is_empty() { "Docker daemon is not running.".to_string() } else { msg.to_string() }));
    }
    let raw: Vec<RawImage> = parse_ndjson(&out.stdout);
    Ok(Json(raw.into_iter().map(Image::from).collect()))
}

async fn remove_image(Path(id): Path<String>) -> ApiResult<Json<Value>> {
    action(&["rmi", "-f", &id]).await
}

// ---- container logs (WebSocket, streamed) ----

async fn ws_logs(ws: WebSocketUpgrade, Path(id): Path<String>, State(_st): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| logs_session(socket, id))
}

fn text_msg(v: Value) -> Message {
    Message::Text(v.to_string())
}

async fn logs_session(mut socket: WebSocket, id: String) {
    let mut child = match Command::new("docker")
        .args(["logs", "-f", "--tail", "300", &id])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = socket.send(text_msg(json!({ "type": "output", "stream": "stderr", "data": format!("Failed to start `docker logs`: {e}\n") }))).await;
            let _ = socket.send(text_msg(json!({ "type": "exit", "code": -1 }))).await;
            return;
        }
    };

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let (tx, mut rx) = mpsc::channel::<Message>(256);
    tokio::spawn(drain(stdout, "stdout", tx.clone()));
    tokio::spawn(drain(stderr, "stderr", tx.clone()));

    loop {
        tokio::select! {
            Some(msg) = rx.recv() => {
                if socket.send(msg).await.is_err() {
                    break;
                }
            }
            status = child.wait() => {
                let code = status.ok().and_then(|s| s.code()).unwrap_or(-1) as i64;
                let _ = socket.send(text_msg(json!({ "type": "exit", "code": code }))).await;
                break;
            }
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
    let _ = child.start_kill();
}

async fn drain<R: AsyncReadExt + Unpin>(mut r: R, stream: &'static str, tx: Sender<Message>) {
    let mut buf = [0u8; 8192];
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                if tx.send(text_msg(json!({ "type": "output", "stream": stream, "data": data }))).await.is_err() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_docker_ps_ndjson() {
        let sample = concat!(
            r#"{"ID":"abc123","Names":"web-1","Image":"nginx:1.27","State":"running","Status":"Up 2 days","Ports":"0.0.0.0:8080->80/tcp","CreatedAt":"2026-06-30 10:00:00"}"#,
            "\n",
            r#"{"ID":"def456","Names":"db-1","Image":"mysql:8.4","State":"exited","Status":"Exited (0) 1 hour ago","Ports":"","CreatedAt":"2026-06-29 09:00:00"}"#,
        );
        let raw: Vec<RawContainer> = parse_ndjson(sample);
        assert_eq!(raw.len(), 2);
        let containers: Vec<Container> = raw.into_iter().map(Container::from).collect();
        assert_eq!(containers[0].name, "web-1");
        assert_eq!(containers[0].state, "running");
        assert_eq!(containers[1].image, "mysql:8.4");
        assert_eq!(containers[1].state, "exited");
    }

    #[test]
    fn parses_docker_images_ndjson() {
        let sample = r#"{"ID":"sha256:1","Repository":"nginx","Tag":"1.27","Size":"187MB","CreatedSince":"2 weeks ago"}"#;
        let raw: Vec<RawImage> = parse_ndjson(sample);
        assert_eq!(raw.len(), 1);
        let images: Vec<Image> = raw.into_iter().map(Image::from).collect();
        assert_eq!(images[0].repository, "nginx");
        assert_eq!(images[0].tag, "1.27");
    }

    #[test]
    fn ndjson_skips_blank_lines_and_bad_json() {
        let sample = "\n\nnot json\n\n";
        let raw: Vec<RawContainer> = parse_ndjson(sample);
        assert!(raw.is_empty());
    }
}
