//! `git clone` — a blocking variant (returns the destination path) and an SSE
//! streaming variant that relays clone progress to the UI, mirroring the Node
//! `/clone` and `/clone-stream` endpoints.

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use axum::response::sse::{Event, KeepAlive, Sse};
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use super::exec::{command, git, GitError};

/// Derive a repo folder name from a clone URL (strips trailing slash + `.git`).
pub fn repo_name_from_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    let tail = trimmed.rsplit('/').next().unwrap_or("repo");
    let name = if tail.to_lowercase().ends_with(".git") { &tail[..tail.len() - 4] } else { tail };
    if name.is_empty() { "repo".to_string() } else { name.to_string() }
}

/// Make `parent` absolute without requiring it to exist (Node `path.resolve`).
fn absolutize(parent: &str) -> PathBuf {
    let p = Path::new(parent);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    }
}

/// Blocking clone into `parent/(name|derived)`; returns the destination path.
pub async fn clone(url: &str, parent: &str, name: Option<&str>) -> Result<String, GitError> {
    let abs_parent = absolutize(parent);
    let folder = name.filter(|s| !s.is_empty()).map(|s| s.to_string()).unwrap_or_else(|| repo_name_from_url(url));
    let target = abs_parent.join(&folder);
    if let Some(p) = target.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let target_str = target.to_string_lossy().to_string();
    git(&abs_parent, &["clone", "--", url, target_str.as_str()]).await?;
    Ok(target_str)
}

fn sse(v: &Value) -> Result<Event, Infallible> {
    Ok(Event::default().data(serde_json::to_string(v).unwrap_or_default()))
}

/// Stream `git clone --progress` output as Server-Sent Events: a `start` event,
/// `progress` events (raw git output, mostly from stderr), then `done`/`error`.
pub fn clone_stream_response(
    url: String,
    parent: String,
    name: Option<String>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(64);
    tokio::spawn(async move {
        let abs_parent = absolutize(&parent);
        let folder = name.filter(|s| !s.is_empty()).unwrap_or_else(|| repo_name_from_url(&url));
        let target = abs_parent.join(&folder);
        let target_str = target.to_string_lossy().to_string();

        if let Some(p) = target.parent() {
            if let Err(e) = std::fs::create_dir_all(p) {
                let _ = tx.send(sse(&json!({ "type": "error", "error": e.to_string() }))).await;
                return;
            }
        }
        let _ = tx.send(sse(&json!({ "type": "start", "target": target_str }))).await;

        let mut cmd = command(&abs_parent, &["clone", "--progress", "--", url.as_str(), target_str.as_str()]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(sse(&json!({ "type": "error", "error": format!("Failed to run git: {e}") }))).await;
                return;
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let t1 = tx.clone();
        let h1 = tokio::spawn(async move {
            if let Some(s) = stdout {
                pump(s, t1).await;
            }
        });
        let t2 = tx.clone();
        let h2 = tokio::spawn(async move {
            if let Some(s) = stderr {
                pump(s, t2).await;
            }
        });
        let _ = h1.await;
        let _ = h2.await;

        match child.wait().await {
            Ok(st) if st.success() => {
                let _ = tx.send(sse(&json!({ "type": "done", "path": target_str }))).await;
            }
            Ok(st) => {
                let _ = tx
                    .send(sse(&json!({ "type": "error", "error": format!("git clone exited {}", st.code().unwrap_or(-1)) })))
                    .await;
            }
            Err(e) => {
                let _ = tx.send(sse(&json!({ "type": "error", "error": e.to_string() }))).await;
            }
        }
    });
    Sse::new(ReceiverStream::new(rx)).keep_alive(KeepAlive::default())
}

#[cfg(test)]
mod tests {
    use super::repo_name_from_url;

    #[test]
    fn derives_repo_name() {
        assert_eq!(repo_name_from_url("https://github.com/foo/bar.git"), "bar");
        assert_eq!(repo_name_from_url("https://github.com/foo/bar"), "bar");
        assert_eq!(repo_name_from_url("git@github.com:foo/Baz.GIT"), "Baz");
        assert_eq!(repo_name_from_url("https://example.com/x/y/"), "y");
        assert_eq!(repo_name_from_url(""), "repo");
    }
}

/// Relay raw chunks from a child pipe as `progress` events (git emits progress
/// with carriage returns, not newlines, so we forward chunks, not lines).
async fn pump<R: AsyncReadExt + Unpin>(mut r: R, tx: mpsc::Sender<Result<Event, Infallible>>) {
    let mut buf = [0u8; 8192];
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                if tx.send(sse(&json!({ "type": "progress", "text": text }))).await.is_err() {
                    break;
                }
            }
        }
    }
}
